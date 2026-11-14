//! The captured network reads current material and the water owner's channel passage.
use super::{
    character::Cone,
    network::{Captured, Forcing, Network},
};
use crate::{
    field::Field,
    rock::{catalogue, columns::Column, ground::GroundField, ModeId, ModeMix},
    settlement::removal::Facet,
    storage::ReadBand,
    water::{column::Store, passage::PassageInputs, substrate},
};
use std::io;

pub struct Proposal<'a> {
    pub captured: Captured<'a>,
    pub cones: &'a [Cone],
    pub costs: &'a [f64],
    pub closed: &'a [u8],
    pub withdrawal: ReadBand<f64>,
    pub transmission: ReadBand<f64>,
    pub open_bed_seepage: f64,
    pub root_hold: ReadBand<f64>,
}
impl Field {
    pub fn captured_network(&self, base: Vec<f64>, proposal: Proposal<'_>) -> io::Result<Network> {
        self.ground.borrow_mut().root_hold(Some(proposal.root_hold));
        let ground = self.ground();
        let water = self.water();
        let mix = catalogue::compile(
            ModeMix::default()
                .with(ModeId::Abrasion, 0.6)
                .with(ModeId::Plucking, 0.4),
        );
        self.water.borrow_mut().with_passage(
            PassageInputs {
                mesh: &self.mesh,
                water_kind: &water.column.kind,
                cut_share: &ground.view(GroundField::GroundCutShare),
                permeability: &|cell, column| {
                    substrate::permeability(
                        &ground,
                        cell,
                        column.map(|c| {
                            if c == Column::Cut {
                                Facet::Cut
                            } else {
                                Facet::Land
                            }
                        }),
                    )
                },
                filled: &|cell| {
                    let store = water.column.store(Store::Ground);
                    let capacity = store.capacity(cell)?;
                    Ok(if capacity > 0.0 {
                        (store.held(cell)? / capacity).clamp(0.0, 1.0)
                    } else {
                        1.0
                    })
                },
                withdrawal: proposal.withdrawal,
                transmission: proposal.transmission,
                open_bed_seepage: proposal.open_bed_seepage,
            },
            |passage| {
                Network::grow(
                    &self.mesh,
                    base,
                    proposal.captured,
                    Forcing {
                        closed_basin: &|cell| Ok(proposal.closed[cell] != 0),
                        influence: &|costs| {
                            for (cost, factor) in costs.iter_mut().zip(proposal.costs) {
                                *cost *= factor;
                            }
                            Ok(())
                        },
                        cones: proposal.cones,
                        resistance: &|from, to| {
                            let response = ground.face_gives_from(from, &mix)?.at(to)?;
                            Ok(if response > 0.0 {
                                1.0 / response
                            } else {
                                f64::INFINITY
                            })
                        },
                        runoff_mm: &|cell| water.runoff.mean.get(cell),
                        passage: &|cell, amount| Ok(passage.parts(cell, amount)?.passed),
                    },
                )
            },
        )
    }
}
