//! Widen a retained cut by excavating a slice of its intact neighbor before deepening it.
use super::{Ground, GroundField as F, MaterialReceiver};
use crate::{
    rock::{
        coarsening::coarsen_one,
        columns::Column,
        material::{blend_layers, MaterialLayer},
    },
    scale::{LengthUnit, MapScale},
    settlement::{removal::*, stage::Pool},
};
use std::io;
struct Widened {
    amount: f64,
    rock: f64,
    loose: f64,
    soil: f64,
    cut_skin: f64,
    share: f64,
}
struct Widening {
    old: f64,
    added: f64,
    gap: f64,
    skin: f64,
}
impl Ground {
    pub(super) fn cut_ground(
        &mut self,
        action: Cut<'_>,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<CutReceipt> {
        if action.depth <= 0.0 || action.share <= 0.0 {
            return Ok(CutReceipt {
                amount: 0.0,
                depth: 0.0,
            });
        }
        let cell = action.cell;
        let budget = action.depth * action.share.clamp(0.0, 1.0);
        let widened = self.widen(cell, action.share, budget, action.floor, receive)?;
        if widened.share <= 0.0 {
            return Ok(CutReceipt {
                amount: 0.0,
                depth: 0.0,
            });
        }
        if widened.rock > 0.0 {
            self.lower_rock(cell, widened.rock)?;
        }
        self.set(
            F::SoilDepth,
            cell,
            (self.get(F::SoilDepth, cell)? - widened.soil).max(0.0),
        )?;
        self.record_flow(
            action.cause,
            Pool::Loose,
            Pool::Load,
            self.volume(cell, widened.loose),
        );
        self.record_flow(
            action.cause,
            Pool::Rock,
            Pool::Load,
            self.volume(cell, widened.rock),
        );
        let room = (self.surface(cell, Facet::Cut)? - action.floor).max(0.0);
        let local = ((budget - widened.amount).max(0.0) / widened.share).min(room);
        let deepened = self.remove_facet(
            Withdrawal {
                cell,
                facet: Facet::Cut,
                pool: MaterialPool::Rock,
                amount: local,
                cause: action.cause,
                soil: widened.cut_skin,
            },
            GroundSource::Surface,
            receive,
        )?;
        self.project(cell)?;
        Ok(CutReceipt {
            amount: widened.amount + deepened,
            depth: deepened / widened.share,
        })
    }
    fn widen(
        &mut self,
        cell: usize,
        wanted: f64,
        budget: f64,
        floor: f64,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<Widened> {
        let old = self.share(cell, Facet::Cut)?;
        let wanted = wanted.clamp(0.0, 1.0);
        let skin = self.get(F::SoilDepth, cell)?;
        let empty = Widened {
            amount: 0.0,
            rock: 0.0,
            loose: 0.0,
            soil: 0.0,
            cut_skin: skin,
            share: old,
        };
        let surface = self.surface(cell, Facet::Land)?;
        if budget <= 0.0 || wanted <= old || surface <= floor {
            return Ok(empty);
        }
        let old_surface = if old > 0.0 {
            self.surface(cell, Facet::Cut)?
        } else {
            surface
        };
        let gap = (surface - old_surface.max(floor)).max(0.0);
        let added = if gap > 0.0 {
            (wanted - old).min(budget / gap)
        } else {
            wanted - old
        };
        if added <= 0.0 {
            return Ok(empty);
        }
        self.widen_slice(
            cell,
            Widening {
                old,
                added,
                gap,
                skin,
            },
            receive,
        )
    }
    fn package(&self, cell: usize, column: Column) -> io::Result<Vec<MaterialLayer>> {
        let mut layers = Vec::new();
        for slot in 0..=self.columns.deepest(cell, column)? {
            let layer = self.columns.read_layer(cell, column, slot)?;
            if layer.depth > 0.0 || !column.finite() {
                layers.push(layer);
            }
        }
        Ok(layers)
    }
    fn install(
        &mut self,
        cell: usize,
        column: Column,
        mut layers: Vec<MaterialLayer>,
    ) -> io::Result<()> {
        while layers.len() > column.size() {
            coarsen_one(&mut layers, !column.finite(), &mut |fold| {
                self.events.folded(cell, column, &fold)
            })?;
        }
        for slot in 0..column.size() {
            self.columns.set_layer(
                cell,
                column,
                slot,
                layers.get(slot).unwrap_or(&MaterialLayer::default()),
            )?;
        }
        Ok(())
    }
    fn widen_slice(
        &mut self,
        cell: usize,
        work: Widening,
        receive: &mut MaterialReceiver<'_>,
    ) -> io::Result<Widened> {
        let Widening {
            old,
            added,
            gap,
            skin,
        } = work;
        let share = old + added;
        let land_rock = self.rock_surface(cell, Facet::Land)?;
        let old_rock = if old > 0.0 {
            self.rock_surface(cell, Facet::Cut)?
        } else {
            land_rock
        };
        let mut rock = self.package(cell, Column::Land)?;
        let mut loose = self.package(cell, Column::Loose)?;
        let mut accept = |layer: MaterialLayer| {
            let mut parcel = self.identities.released_material(layer);
            parcel.depth *= added;
            receive(parcel)
        };
        let loose_removed = withdraw_slice(&mut loose, gap, false, &mut accept)?;
        let rock_removed = withdraw_slice(&mut rock, gap - loose_removed, true, &mut accept)?;
        let fraction = added / share;
        if old > 0.0 {
            rock = combine(self.package(cell, Column::Cut)?, rock, fraction, true);
            loose = combine(
                self.package(cell, Column::CutLoose)?,
                loose,
                fraction,
                false,
            );
        }
        self.install(cell, Column::Cut, rock)?;
        self.install(cell, Column::CutLoose, loose)?;
        let next_rock = (old * old_rock + added * (land_rock - rock_removed)) / share;
        let gap_metres = MapScale::metres(gap, LengthUnit::Native);
        self.set(F::GroundCutShare, cell, share)?;
        self.set(F::GroundCutDepth, cell, land_rock - next_rock)?;
        Ok(Widened {
            amount: gap * added,
            rock: rock_removed * added,
            loose: loose_removed * added,
            soil: skin.min(gap_metres) * added,
            cut_skin: (skin * old + (skin - gap_metres).max(0.0) * added) / share,
            share,
        })
    }
}
fn withdraw_slice(
    layers: &mut Vec<MaterialLayer>,
    amount: f64,
    solid: bool,
    receive: &mut MaterialReceiver<'_>,
) -> io::Result<f64> {
    let mut left = amount;
    while !layers.is_empty() && left > 0.0 {
        let top = &layers[0];
        let basement = solid && layers.len() == 1;
        let taken = left.min(if basement { left } else { top.depth });
        if taken > 0.0 {
            receive(MaterialLayer {
                depth: taken,
                ..top.clone()
            })?;
        }
        left -= taken;
        if basement || top.depth > taken {
            layers[0].depth = (top.depth - taken).max(if basement { 1.0 } else { 0.0 });
            break;
        }
        layers.remove(0);
    }
    Ok(amount - left)
}
fn combine(
    old: Vec<MaterialLayer>,
    incoming: Vec<MaterialLayer>,
    share: f64,
    solid: bool,
) -> Vec<MaterialLayer> {
    let old_count = old.len() - usize::from(solid);
    let new_count = incoming.len() - usize::from(solid);
    let mut layers: Vec<_> = old[..old_count]
        .iter()
        .map(|layer| MaterialLayer {
            depth: layer.depth * (1.0 - share),
            ..layer.clone()
        })
        .chain(incoming[..new_count].iter().map(|layer| MaterialLayer {
            depth: layer.depth * share,
            ..layer.clone()
        }))
        .filter(|layer| layer.depth > 0.0)
        .collect();
    if solid {
        let a = &old[old_count];
        let b = &incoming[new_count];
        let mut basement = blend_layers(a, b, 1.0 - share, share);
        basement.depth = (a.depth * (1.0 - share) + b.depth * share).max(1.0);
        layers.push(basement);
    }
    layers
}
