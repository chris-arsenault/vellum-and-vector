use super::{
    placement::cover_column,
    transport::{transform_layer, HeldRock, TransferObservation, TransferOperation, TransferPhase},
    Ground, GroundField as F,
};
use crate::{
    rock::{columns::Column, material::MaterialLayer},
    settlement::{removal::Facet, stage::Pool},
};
use std::io;
pub struct Accretion {
    pub target: usize,
    pub source: usize,
    pub amount: f64,
    pub deformation: [f64; 4],
    pub source_depth: Option<f64>,
}
impl Ground {
    fn bury_under_package(&mut self, cell: usize, incoming: &[MaterialLayer]) -> io::Result<()> {
        let mut buried = 0.0;
        for facet in Facet::ALL {
            let share = self.share(cell, facet)?;
            if share <= 0.0 {
                continue;
            }
            let cover = cover_column(facet);
            let mut layers = incoming.to_vec();
            let mut depth = 0.0;
            for slot in 0..cover.size() {
                if self.columns.depth(cell, cover, slot)? <= 0.0 {
                    break;
                }
                let mut layer = self.columns.read_layer(cell, cover, slot)?;
                depth += layer.depth;
                layer.damage = layer.damage.max(0.5);
                layer.altered = self.epoch;
                layer.consolidation = 0.0;
                layers.push(layer);
                let mut empty = self.columns.read_raw_layer(cell, cover, slot)?;
                empty.depth = 0.0;
                empty.cargo = None;
                self.columns.set_layer(cell, cover, slot, &empty)?;
            }
            self.insert_material(cell, super::placement::rock_column(facet), &layers)?;
            buried += depth * share;
            self.add(
                F::GroundCutDepth,
                cell,
                if facet == Facet::Land { depth } else { -depth },
            )?;
        }
        if buried > 0.0 {
            self.add(F::BedrockElevation, cell, buried)?;
            self.add(F::SurfaceRockLoad, cell, buried)?;
            self.record_flow("burial", Pool::Loose, Pool::Rock, self.volume(cell, buried));
        }
        Ok(())
    }
    pub fn accrete_rock(&mut self, held: &HeldRock, work: &Accretion) -> io::Result<f64> {
        let event = |phase, accepted| TransferObservation {
            operation: TransferOperation::RockAccretion,
            phase,
            source: work.source,
            target: work.target,
            accepted,
            retained_area_share: None,
        };
        self.observe_transfer(held, event(TransferPhase::Before, None))?;
        let admitted = work.amount.max(0.0);
        if admitted > 0.0 {
            let layers = collision_beds(held, work, admitted)?
                .into_iter()
                .map(|layer| self.identities.released_material(layer))
                .collect::<Vec<_>>();
            self.bury_under_package(work.target, &layers)?;
            self.add(F::BedrockElevation, work.target, admitted)?;
            self.add(F::SurfaceRockLoad, work.target, admitted)?;
            self.record_flow(
                "plates",
                Pool::Rock,
                Pool::Rock,
                self.volume(work.target, admitted),
            );
            self.project(work.target)?;
        }
        self.observe_transfer(held, event(TransferPhase::After, Some(admitted)))?;
        Ok(admitted)
    }
    pub fn accrete_cover(
        &mut self,
        held: &HeldRock,
        target: usize,
        source: usize,
        area_ratio: f64,
        deformation: [f64; 4],
    ) -> io::Result<()> {
        let event = |phase, accepted| TransferObservation {
            operation: TransferOperation::CoverAccretion,
            phase,
            source,
            target,
            accepted,
            retained_area_share: None,
        };
        self.observe_transfer(held, event(TransferPhase::Before, None))?;
        let share = held.get(F::GroundCutShare, source)?;
        let mut arriving = Vec::new();
        for column in [Column::CutLoose, Column::Loose] {
            let part = if column == Column::Loose {
                1.0 - share
            } else {
                share
            };
            if part <= 0.0 {
                continue;
            }
            for mut layer in held.collision_layers(source, column)?.iter().cloned() {
                layer.depth *= part * area_ratio;
                if layer.depth <= 0.0 {
                    continue;
                }
                arriving.push(transform_layer(
                    self.identities.released_material(layer),
                    deformation,
                ));
            }
        }
        let accepted = self.deposit_package(target, &arriving, "plates", Pool::Loose, None)?;
        self.observe_transfer(held, event(TransferPhase::After, Some(accepted)))
    }
    pub fn land_collision(
        &mut self,
        held: &HeldRock,
        target: usize,
        source: usize,
        area_ratio: f64,
        deformation: [f64; 4],
    ) -> io::Result<()> {
        let rock = held.get(F::SurfaceRockLoad, source)?.max(0.0);
        self.accrete_rock(
            held,
            &Accretion {
                target,
                source,
                amount: rock * area_ratio,
                deformation,
                source_depth: Some(rock),
            },
        )?;
        self.accrete_cover(held, target, source, area_ratio, deformation)
    }
}
fn collision_beds(
    held: &HeldRock,
    work: &Accretion,
    admitted: f64,
) -> io::Result<Vec<MaterialLayer>> {
    let source_depth = work.source_depth.unwrap_or(admitted);
    let share = held.get(F::GroundCutShare, work.source)?;
    let mut result = Vec::new();
    for column in [Column::Cut, Column::Land] {
        let part = if column == Column::Land {
            1.0 - share
        } else {
            share
        };
        if part <= 0.0 {
            continue;
        }
        let layers = held.collision_layers(work.source, column)?;
        let mut last = 0;
        while last + 1 < layers.len() && layers[last + 1].depth > 0.0 {
            last += 1;
        }
        let mut left = source_depth;
        for (slot, layer) in layers.iter().enumerate().take(last + 1) {
            if left <= 0.0 {
                break;
            }
            let depth = left.min(if slot == last { left } else { layer.depth });
            if depth > 0.0 {
                let mut layer = transform_layer(
                    layer.finite_slice(depth, slot == last, 0.0),
                    work.deformation,
                );
                layer.depth *= part * admitted / source_depth;
                result.push(layer);
            }
            left -= depth;
        }
    }
    Ok(result)
}
