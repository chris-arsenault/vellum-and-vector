//! Restore captured authored ground through material operations, preserving its loose cover.
use super::{placement::rock_column, Ground, GroundField as F};
use crate::{
    rock::{catalogue, load::MaterialLoad},
    settlement::{removal::Facet, stage::Pool},
};
use std::io;

impl Ground {
    pub(crate) fn restore_authored(
        &mut self,
        name: &str,
        cell: usize,
        value: f64,
        load: &mut MaterialLoad,
    ) -> io::Result<bool> {
        match name {
            "Elevation" | "BedrockElevation" => {
                let current = self.get(F::BedrockElevation, cell)?
                    + if name == "Elevation" {
                        self.get(F::SedimentThickness, cell)?
                    } else {
                        0.0
                    };
                self.displace(cell, value - current, "authored")?;
            }
            "RockResistance" => {
                for facet in Facet::ALL {
                    if self.share(cell, facet)? <= 0.0 {
                        continue;
                    }
                    let column = rock_column(facet);
                    let mut layer = self.columns.read_layer(cell, column, 0)?;
                    layer.strength = value.clamp(catalogue::SOFTEST_ROCK, catalogue::HARDEST_ROCK);
                    layer.altered = self.epoch;
                    self.columns.set_layer(cell, column, 0, &layer)?;
                }
                self.project(cell)?;
            }
            "SedimentThickness" => {
                let change = value.max(0.0) - self.get(F::SedimentThickness, cell)?;
                if change > 0.0 {
                    self.deposit_package(
                        cell,
                        &[catalogue::material(catalogue::ALLUVIUM, change, 0.0)],
                        "authored",
                        Pool::Load,
                        None,
                    )?;
                } else if change < 0.0 {
                    let area = self.volume(cell, 1.0);
                    self.erode_facets(
                        cell,
                        [-change; 2],
                        "authored",
                        Pool::Load,
                        &mut |mut layer| {
                            layer.depth *= area;
                            load.add(cell, &layer)
                        },
                    )?;
                }
            }
            _ => return Ok(false),
        }
        Ok(true)
    }
}
