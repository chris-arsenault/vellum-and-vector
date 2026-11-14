use super::{
    placement::{cover_column, rock_column},
    Ground, GroundField as F,
};
use crate::{
    rock::{
        material::{blend_layers, MaterialLayer},
        transforms::burial_response,
    },
    settlement::{removal::Facet, stage::Pool},
};
use std::io;
fn entombed(mut layer: MaterialLayer, epoch: f64) -> MaterialLayer {
    layer.damage = layer.damage.max(0.5);
    layer.altered = epoch;
    layer.consolidation = 0.0;
    layer
}
fn partially_consolidated(
    layer: MaterialLayer,
    response: MaterialLayer,
    fraction: f64,
) -> MaterialLayer {
    if fraction >= 1.0 {
        return response;
    }
    if layer.kind != response.kind || layer.secondary_kind != response.secondary_kind {
        return MaterialLayer {
            depth: layer.depth,
            ..blend_layers(&layer, &response, 1.0 - fraction, fraction)
        };
    }
    MaterialLayer {
        damage: layer.damage + (response.damage - layer.damage) * fraction,
        consolidation: layer.consolidation
            + (response.consolidation - layer.consolidation) * fraction,
        altered: response.altered,
        ..layer
    }
}
impl Ground {
    pub fn lithify(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<f64> {
        let epoch = self.epoch;
        self.consolidate_cover(
            cell,
            |_| amount,
            cause,
            |layer| burial_response(&layer, epoch),
            None,
        )
    }
    pub fn lithify_buried(
        &mut self,
        cell: usize,
        threshold: f64,
        hardened: f64,
        cause: &str,
    ) -> io::Result<f64> {
        let fraction = hardened.clamp(0.0, 1.0);
        if fraction <= 0.0 {
            return Ok(0.0);
        }
        let mut changed = false;
        for facet in Facet::ALL {
            if self.share(cell, facet)? > 0.0 {
                changed = self.consolidate_beds(cell, facet, threshold, fraction)? || changed;
            }
        }
        let epoch = self.epoch;
        let converted = self.consolidate_cover(
            cell,
            |cover| (cover - threshold).max(0.0) * fraction,
            cause,
            |layer| burial_response(&layer, epoch),
            None,
        )?;
        if changed {
            self.project(cell)?;
        }
        Ok(converted)
    }
    fn consolidate_beds(
        &mut self,
        cell: usize,
        facet: Facet,
        threshold: f64,
        fraction: f64,
    ) -> io::Result<bool> {
        let mut above = self.cover_depth(cell, facet)?;
        let mut changed = false;
        let column = rock_column(facet);
        for slot in 0..column.size() {
            let layer = self.columns.read_layer(cell, column, slot)?;
            if layer.depth <= 0.0 {
                break;
            }
            let eligible = ((above + layer.depth - threshold) / layer.depth).clamp(0.0, 1.0);
            above += layer.depth;
            if eligible <= 0.0 || layer.consolidation >= 1.0 {
                continue;
            }
            let response = burial_response(&layer, self.epoch);
            if layer.consolidation >= response.consolidation {
                continue;
            }
            let material = partially_consolidated(layer, response, fraction * eligible);
            self.columns.set_layer(cell, column, slot, &material)?;
            changed = true;
        }
        Ok(changed)
    }
    pub fn bury_cover(&mut self, cell: usize, facet: Option<Facet>) -> io::Result<f64> {
        let epoch = self.epoch;
        self.consolidate_cover(
            cell,
            |_| f64::INFINITY,
            "burial",
            |layer| entombed(layer, epoch),
            facet,
        )
    }
    fn consolidate_cover(
        &mut self,
        cell: usize,
        amount: impl Fn(f64) -> f64,
        cause: &str,
        response: impl Fn(MaterialLayer) -> MaterialLayer,
        only: Option<Facet>,
    ) -> io::Result<f64> {
        let mut hardened = 0.0;
        for facet in Facet::ALL {
            let share = self.share(cell, facet)?;
            if share <= 0.0 || only.is_some_and(|only| only != facet) {
                continue;
            }
            let cover = self.cover_depth(cell, facet)?;
            let wanted = amount(cover).min(cover);
            if wanted <= 0.0 {
                continue;
            }
            let mut layers = Vec::new();
            let actual =
                self.columns
                    .withdraw_buried(cell, cover_column(facet), wanted, &mut |layer| {
                        layers.push(response(layer));
                        Ok(())
                    })?;
            if actual <= 0.0 {
                continue;
            }
            layers.reverse();
            self.insert_material(cell, rock_column(facet), &layers)?;
            hardened += actual * share;
            self.add(
                F::GroundCutDepth,
                cell,
                if facet == Facet::Land {
                    actual
                } else {
                    -actual
                },
            )?;
        }
        if hardened > 0.0 {
            self.add(F::BedrockElevation, cell, hardened)?;
            self.add(F::SurfaceRockLoad, cell, hardened)?;
            self.record_flow(cause, Pool::Loose, Pool::Rock, self.volume(cell, hardened));
            self.project(cell)?;
        }
        Ok(hardened)
    }
}
