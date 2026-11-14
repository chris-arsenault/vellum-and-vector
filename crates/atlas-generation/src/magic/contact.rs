use super::{
    channels::Channel, configuration::Propagation, sources::Environment, state::MagicField,
};
use crate::{
    processes::coast::frame::{self, Frame, FrameInput},
    storage::{Band, Coverage, ReadBand},
};
use std::io;
pub struct Contact {
    intensity: ReadBand<f64>,
    coverage: ReadBand<f64>,
    kind: ReadBand<u8>,
    coast: Option<Frame>,
}
impl Contact {
    pub fn new(
        env: &Environment<'_>,
        field: &MagicField,
        coverage: &mut Coverage,
    ) -> io::Result<Self> {
        let intensity = field.channel(Channel::Intensity);
        let coast = if field
            .definition
            .origins
            .iter()
            .any(|origin| origin.propagation == Propagation::OceanRays)
        {
            Some(frame::build(
                &mut FrameInput {
                    mesh: env.mesh,
                    kind: &env.water.column.kind,
                    coverage,
                },
                field.definition.parameters.beam_width,
                &intensity,
                None,
            )?)
        } else {
            None
        };
        Ok(Self {
            intensity,
            coverage: field.coverage(),
            kind: env.water.column.kind.clone(),
            coast,
        })
    }
    pub fn intensity(&self, cell: usize) -> io::Result<f64> {
        let own = self.intensity.get(cell)?;
        if let Some(frame) = &self.coast {
            if self.kind.get(cell)? == 0 {
                return Ok(own.max(frame.strength.get(cell)? * frame.coverage.get(cell)?));
            }
        }
        Ok(own)
    }
    pub fn coverage(&self, cell: usize) -> io::Result<f64> {
        let own = self.coverage.get(cell)?;
        if let Some(frame) = &self.coast {
            if self.kind.get(cell)? == 0 {
                return Ok(own.max(frame.coverage.get(cell)? * frame.strength.get(cell)? / 1000.0));
            }
        }
        Ok(own)
    }
}
pub fn receive_coastal_action(
    env: &Environment<'_>,
    offshore: &ReadBand<f64>,
    strength: f64,
    width: f64,
    received: &mut Band<f64>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    if strength == 0.0 {
        return Ok(());
    }
    let mut forcing = coverage.scratch(env.mesh.len(), 0.0);
    for cell in 0..env.mesh.len() {
        forcing.set(cell, offshore.get(cell)? * strength)?;
    }
    let frame = frame::build(
        &mut FrameInput {
            mesh: env.mesh,
            kind: &env.water.column.kind,
            coverage,
        },
        width,
        &forcing.read_only(),
        None,
    )?;
    for cell in 0..env.mesh.len() {
        let share = frame.coverage.get(cell)?;
        if share > 0.0 {
            received.set(
                cell,
                (received.get(cell)? + frame.strength.get(cell)? * share).min(1000.0),
            )?;
        }
    }
    Ok(())
}
