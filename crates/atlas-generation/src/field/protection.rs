//! Existing authored inputs are retained as native samples; child boundaries are never fixed.
use super::{
    inheritance::resources::Resource,
    projection::channels,
    schema::NumericBand,
    shared::{CellCode, Flag, FloatField, Scalar},
    Field,
};
use crate::{
    execution::{Command, CommandKind},
    reconstruction::Interpolator,
    spatial::SpatialKernel,
    storage::{Coverage, ReadBand, SharedCache},
};
use atlas_map::{Geometry, Position};
use std::{io, rc::Rc};

#[derive(Clone)]
pub struct Input {
    pub source: Rc<Resource>,
    pub space: Option<String>,
    pub footprint: Geometry,
    pub source_footprint: Geometry,
    pub channels: Vec<String>,
}
pub struct Fixed {
    pub name: String,
    pub values: ReadBand<f64>,
}
pub struct Protection {
    pub fixed: Vec<Fixed>,
    pub inputs: Vec<Input>,
    _coverage: Coverage,
}
impl Protection {
    pub fn ecology_fixed(&self) -> Vec<crate::ecology::lifecycle::Fixed> {
        let channels = channels::physical();
        self.fixed
            .iter()
            .filter_map(|fixed| {
                channels
                    .iter()
                    .find(|c| c.name == fixed.name && c.layer == "ecology")?;
                Some(crate::ecology::lifecycle::Fixed {
                    name: Scalar::named(&fixed.name)?,
                    values: fixed.values.clone(),
                })
            })
            .collect()
    }
    pub fn capture(
        field: &Field,
        space: &str,
        inputs: &[Input],
        spatial: &dyn SpatialKernel,
        cache: SharedCache,
    ) -> io::Result<Self> {
        let mesh = &field.mesh;
        let mut coverage = Coverage::new(mesh.clone(), cache);
        if inputs.is_empty() {
            return Ok(Self {
                fixed: Vec::new(),
                inputs: Vec::new(),
                _coverage: coverage,
            });
        }
        let [ox, oy] = mesh.origin();
        let positions = (0..mesh.len())
            .map(|cell| {
                let [x, y] = mesh.position(cell);
                Position::xy(ox + x, oy + y)
            })
            .collect::<Vec<_>>();
        let bindings = channels::physical();
        let mut fixed = Vec::new();
        for input in inputs {
            if input.space.as_ref().is_some_and(|s| s != space) {
                continue;
            }
            let covers = spatial
                .covers_points(&input.footprint, &positions)
                .map_err(io::Error::other)?;
            let source_covers = spatial
                .covers_points(&input.source_footprint, &positions)
                .map_err(io::Error::other)?;
            for binding in bindings.iter().filter(|b| input.channels.contains(&b.name)) {
                let Some(channel) = input.source.channels.get(&binding.name) else {
                    continue;
                };
                if channel.unit != binding.unit {
                    return Err(io::Error::other(format!(
                        "Authored {} must retain its units",
                        binding.name
                    )));
                }
                let integer = matches!(channel.values, NumericBand::I32(_));
                let mut values = coverage.allocate(f64::NAN);
                let mut sampler = Interpolator::new(
                    &input.source.grid,
                    binding.unit == "category" || binding.discrete,
                    &mut coverage,
                );
                for (cell, position) in positions.iter().enumerate() {
                    if !covers[cell] || !source_covers[cell] {
                        continue;
                    }
                    let [x, y, _] = position.coordinates();
                    let value = sampler.sample([x, y], &|at| channel.values.get(at))?;
                    values.set(
                        cell,
                        if integer {
                            (value + 0.5).floor()
                        } else {
                            value
                        },
                    )?;
                }
                fixed.push(Fixed {
                    name: binding.name.clone(),
                    values: values.read_only(),
                });
            }
        }
        Ok(Self {
            fixed,
            inputs: inputs.to_vec(),
            _coverage: coverage,
        })
    }
}
impl Field {
    fn restore_sample(&mut self, name: &str, cell: usize, value: f64) -> io::Result<()> {
        if self
            .ground
            .borrow_mut()
            .restore_authored(name, cell, value, &mut self.ground_load)?
        {
            return Ok(());
        }
        if let Some(name) = Scalar::named(name) {
            self.shared.scalar_mut(name).set(cell, value)?;
        } else if let Some(name) = CellCode::named(name) {
            self.shared
                .code_mut(name)
                .set(cell, (value + 0.5).floor() as i32)?;
        } else if let Some(name) = FloatField::named(name) {
            self.shared.float_mut(name).set(cell, value as f32)?;
        } else if let Some(name) = Flag::named(name) {
            self.shared.flag_mut(name).set(cell, value as u8)?;
        } else if !self
            .water
            .borrow_mut()
            .restore_authored(name, cell, value)?
            && !self.people.restore_authored(name, cell, value)?
        {
            return Err(io::Error::other(format!(
                "Authored ground field {name} needs a material operation"
            )));
        }
        Ok(())
    }
}
pub struct Restore<'a> {
    pub protection: &'a Protection,
    pub grounding: Option<&'a super::glaciers::Settings>,
}
pub fn restore<'a>() -> Command<Field, Restore<'a>> {
    Command::with_inputs(
        "atlas.restore-authored",
        CommandKind::Event,
        vec![],
        |scope, input: &Restore<'_>| {
            let field = scope.state_mut();
            for fixed in &input.protection.fixed {
                for cell in 0..fixed.values.len() {
                    let value = fixed.values.get(cell)?;
                    if value.is_finite() {
                        field.restore_sample(&fixed.name, cell, value)?;
                    }
                }
            }
            if let Some(settings) = input.grounding {
                for fixed in input
                    .protection
                    .fixed
                    .iter()
                    .filter(|f| f.name == "Elevation")
                {
                    for cell in 0..fixed.values.len() {
                        if fixed.values.get(cell)?.is_finite() {
                            field.water.borrow_mut().reconcile_ground(cell)?;
                        }
                    }
                }
                super::glaciers::surface::refresh(field, settings)?;
            }
            Ok(())
        },
    )
}
