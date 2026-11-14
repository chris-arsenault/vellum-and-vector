use super::{
    placement::{cover_column, rock_column},
    Ground,
};
use crate::{
    rock::{coarsening::coarsen_package, columns::Column, material::MaterialLayer},
    settlement::removal::Facet,
};
use std::io;
/// None preserves the input interval unchanged, matching the source's retained object identity.
pub type MaterialTransform<'a> = dyn Fn(&MaterialLayer) -> Option<MaterialLayer> + 'a;
pub struct Alteration<'a> {
    pub depth: f64,
    pub offset: f64,
    pub from_rock: bool,
    pub retained_only: bool,
    pub transform: &'a MaterialTransform<'a>,
    pub facet: Option<Facet>,
}
pub fn alter_interval(
    layers: &[MaterialLayer],
    start: f64,
    end: f64,
    transform: &MaterialTransform<'_>,
    basement: bool,
    retained_only: bool,
) -> Option<Vec<MaterialLayer>> {
    let mut result = Vec::new();
    let mut changed = false;
    let mut top = 0.0;
    for (index, layer) in layers.iter().enumerate() {
        let unbounded = basement && index == layers.len() - 1;
        let bottom = if unbounded {
            f64::INFINITY
        } else {
            top + layer.depth
        };
        let first = top.max(start);
        let last = if retained_only && unbounded {
            top + (layer.depth - 1.0).max(0.0)
        } else {
            bottom
        }
        .min(end);
        if last <= first {
            result.push(layer.clone());
        } else {
            changed = split_altered(
                &mut result,
                layer,
                [first - top, last - first],
                transform,
                unbounded,
            ) || changed;
        }
        top = bottom;
    }
    changed.then_some(result)
}
fn split_altered(
    result: &mut Vec<MaterialLayer>,
    layer: &MaterialLayer,
    interval: [f64; 2],
    transform: &MaterialTransform<'_>,
    basement: bool,
) -> bool {
    let [before, depth] = interval;
    let reached = layer.finite_slice(depth, basement, before);
    let Some(mut changed) = transform(&reached) else {
        result.push(layer.clone());
        return false;
    };
    if before > 0.0 {
        result.push(layer.finite_slice(before, basement, 0.0));
    }
    changed.depth = depth;
    result.push(changed);
    let remaining = layer.depth - before - depth;
    let remaining = if basement {
        remaining.max(1.0)
    } else {
        remaining
    };
    if remaining > 0.0 {
        result.push(layer.finite_slice(remaining, basement, before + depth));
    }
    true
}
impl Ground {
    pub fn harden_rock(&mut self, cell: usize, kind: usize, resistance: f64) -> io::Result<()> {
        use crate::{
            rock::catalogue,
            scale::{MapScale, RelativeMeasure},
        };
        let value = resistance.clamp(catalogue::SOFTEST_ROCK, catalogue::HARDEST_ROCK);
        let epoch = self.epoch;
        let depth = MapScale::native(
            self.scale
                .resolve(RelativeMeasure::length(0.000035).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
                .value(),
        );
        self.alter(
            cell,
            &Alteration {
                depth,
                offset: 0.0,
                from_rock: false,
                retained_only: false,
                facet: None,
                transform: &|old| {
                    (value > old.strength).then(|| MaterialLayer {
                        kind,
                        secondary_kind: kind,
                        secondary_share: 0.0,
                        strength: value,
                        altered: epoch,
                        ..old.clone()
                    })
                },
            },
        )
    }
    pub fn alter(&mut self, cell: usize, action: &Alteration<'_>) -> io::Result<()> {
        let start = action.offset.max(0.0);
        let end = start + action.depth;
        if action.depth <= 0.0 || !end.is_finite() {
            return Ok(());
        }
        for facet in Facet::ALL {
            if self.share(cell, facet)? <= 0.0 || action.facet.is_some_and(|only| only != facet) {
                continue;
            }
            let overburden = if action.from_rock {
                0.0
            } else {
                self.cover_depth(cell, facet)?
            };
            if !action.from_rock {
                self.alter_column(cell, cover_column(facet), [start, end], action)?;
            }
            if end > overburden {
                self.alter_column(
                    cell,
                    rock_column(facet),
                    [(start - overburden).max(0.0), end - overburden],
                    action,
                )?;
            }
        }
        self.project(cell)
    }
    fn alter_column(
        &mut self,
        cell: usize,
        column: Column,
        interval: [f64; 2],
        action: &Alteration<'_>,
    ) -> io::Result<()> {
        let mut layers = Vec::new();
        for slot in 0..=self.columns.deepest(cell, column)? {
            let layer = self.columns.read_layer(cell, column, slot)?;
            if layer.depth > 0.0 {
                layers.push(layer);
            }
        }
        let Some(mut altered) = alter_interval(
            &layers,
            interval[0],
            interval[1],
            action.transform,
            !column.finite(),
            action.retained_only,
        ) else {
            return Ok(());
        };
        coarsen_package(&mut altered, column.size(), !column.finite(), &mut |fold| {
            self.events.folded(cell, column, &fold)
        })?;
        self.columns.write_column(cell, column, &altered)
    }
}
