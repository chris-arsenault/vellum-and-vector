//! External forcing sampled from the map's surface, separate from generated material.
use super::{projection::Surface, shared::Scalar, Field};
use crate::{
    execution::{Command, CommandKind},
    reconstruction::Interpolator,
    storage::{Band, ReadBand},
};
use std::io;

pub(super) fn sampled(
    field: &Field,
    surface: &Surface,
    name: &str,
) -> io::Result<Option<Band<f64>>> {
    let Some(channel) = surface.channels().get(name) else {
        return Ok(None);
    };
    let values = channel.values();
    let mut coverage = field.coverage.borrow_mut();
    let mut output = coverage.scratch(field.mesh.len(), 0.0);
    let mut sampler = Interpolator::new(surface.grid(), false, &mut coverage);
    let [ox, oy] = field.mesh.origin();
    for cell in 0..field.mesh.len() {
        let [x, y] = field.mesh.position(cell);
        output.set(
            cell,
            sampler.sample([x + ox, y + oy], &|at| values.get(at))?,
        )?;
    }
    Ok(Some(output))
}
pub struct Heat<'a> {
    pub surface: &'a Surface,
    pub include_standalone: bool,
    pub magic: Option<ReadBand<f64>>,
}
pub struct Material<'a> {
    pub surface: &'a Surface,
    pub channel: &'a str,
}
pub fn alter_source_ground<'a>() -> Command<Field, Material<'a>> {
    Command::with_inputs(
        "magic.alter-source-ground",
        CommandKind::Event,
        vec![],
        |scope, input: &Material<'_>| {
            use crate::{
                rock::{catalogue, ground::alteration::Alteration},
                scale::{MapScale, RelativeMeasure},
            };
            let field = scope.state_mut();
            let values = sampled(field, input.surface, input.channel)?
                .ok_or_else(|| io::Error::other("Material response requires its source forcing"))?;
            let depth = MapScale::native(
                field
                    .scale
                    .resolve(RelativeMeasure::length(0.000035).map_err(io::Error::other)?)
                    .map_err(io::Error::other)?
                    .value(),
            );
            let mut ground = field.ground.borrow_mut();
            let epoch = ground.completed_epochs();
            for cell in 0..field.mesh.len() {
                let change = values.get(cell)?;
                if change == 0.0 {
                    continue;
                }
                ground.alter(
                    cell,
                    &Alteration {
                        depth,
                        offset: 0.0,
                        from_rock: false,
                        retained_only: false,
                        facet: None,
                        transform: &|layer| {
                            Some(crate::rock::material::MaterialLayer {
                                strength: (layer.strength + change)
                                    .clamp(catalogue::SOFTEST_ROCK, catalogue::HARDEST_ROCK),
                                altered: epoch,
                                ..layer.clone()
                            })
                        },
                    },
                )?;
            }
            Ok(())
        },
    )
}
pub fn replace_heat<'a>() -> Command<Field, Heat<'a>> {
    Command::with_inputs(
        "atlas.external-forcing",
        CommandKind::Event,
        vec![],
        |scope, input: &Heat<'_>| {
            let field = scope.state_mut();
            let standalone = if input.include_standalone {
                sampled(field, input.surface, "Heat")?
            } else {
                None
            };
            for cell in 0..field.mesh.len() {
                let heat = standalone
                    .as_ref()
                    .map(|b| b.get(cell).map(|v| (v * 10.0 + 0.5).floor()))
                    .transpose()?
                    .unwrap_or(0.0);
                let magic = input
                    .magic
                    .as_ref()
                    .map(|b| b.get(cell))
                    .transpose()?
                    .unwrap_or(0.0);
                field
                    .shared
                    .scalar_mut(Scalar::ExternalHeatForcing)
                    .set(cell, heat + magic)?;
            }
            Ok(())
        },
    )
}
impl Field {
    pub fn captured_height(&self) -> io::Result<ReadBand<f64>> {
        let heights = self
            .ground()
            .view(crate::rock::ground::GroundField::Elevation);
        let mut copy = self.coverage.borrow_mut().allocate(0.0);
        for cell in 0..self.mesh.len() {
            copy.set(cell, heights.get(cell)?)?;
        }
        Ok(copy.read_only())
    }
    pub fn captured_ocean_distance(&self, captured: &ReadBand<f64>) -> io::Result<()> {
        self.measure_ocean_distance(Some(&|cell| {
            if self.mesh.boundary(cell) {
                captured.get(cell)
            } else {
                Ok(-1.0)
            }
        }))
    }
    pub fn external_coastal_pressure(&self, surface: &Surface) -> io::Result<()> {
        let pressure = sampled(self, surface, "CoastalPressure")?;
        let water = self.water().column.kind;
        let mut forcing = self.shared.derive_scalar(Scalar::ExternalCoastalForcing);
        for cell in 0..self.mesh.len() {
            let mut received = 0.0_f64;
            if water.get(cell)? == 0 {
                if let Some(pressure) = &pressure {
                    for edge in 0..3 {
                        if let Some(next) = self.mesh.neighbor(cell, edge) {
                            if water.get(next)? == 1 {
                                received = received.max(pressure.get(next)?);
                            }
                        }
                    }
                }
            }
            forcing.set(cell, ((received * 1000.0).clamp(0.0, 1000.0) + 0.5).floor())?;
        }
        Ok(())
    }
}
