use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::{
        shared::Scalar,
        surface_media::{Melt, Spoil},
        Field,
    },
    rock::{
        catalogue,
        ground::{alteration::Alteration, GroundField},
        material::MaterialLayer,
    },
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::{
        removal::{Facet, MaterialPool, RemovalGround, Withdrawal},
        stage::Pool,
    },
};
use std::io;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Band {
    Elevation,
    SedimentThickness,
    RockResistance,
    IceThickness,
    SoilDepth,
}
impl Band {
    fn read(self, field: &Field, cell: usize) -> io::Result<f64> {
        let name = match self {
            Self::IceThickness => return field.shared.scalar(Scalar::IceThickness).get(cell),
            Self::Elevation => GroundField::Elevation,
            Self::SedimentThickness => GroundField::SedimentThickness,
            Self::RockResistance => GroundField::RockResistance,
            Self::SoilDepth => GroundField::SoilDepth,
        };
        field.ground().view(name).get(cell)
    }
}
#[derive(Clone, Copy)]
pub struct Target {
    pub add: f64,
    pub at_most: f64,
    pub at_least: f64,
}
impl Default for Target {
    fn default() -> Self {
        Self {
            add: 0.0,
            at_most: f64::INFINITY,
            at_least: f64::NEG_INFINITY,
        }
    }
}
impl Target {
    pub fn next(self, current: f64) -> f64 {
        (current + self.add).max(self.at_least).min(self.at_most)
    }
    pub fn take(&mut self, change: super::values::Change) {
        match change {
            super::values::Change::Add(v) => self.add += v,
            super::values::Change::AtMost(v) => self.at_most = self.at_most.min(v),
            super::values::Change::AtLeast(v) => self.at_least = self.at_least.max(v),
        }
    }
}
pub struct Request {
    pub band: Band,
    pub cell: usize,
    pub target: Target,
}
pub fn unsettled_addition(request: f64, previous: f64) -> f64 {
    if request > 0.0 {
        (request - previous.max(0.0)).max(0.0)
    } else {
        (request - previous.min(0.0)).min(0.0)
    }
}
fn land_available(field: &mut Field, cell: usize, depth: f64, cause: &str) -> io::Result<()> {
    let area = field.mesh.area(cell);
    if area <= 0.0 {
        return Ok(());
    }
    let mut material = field
        .ground_load
        .take(cell, MapScale::metres(depth, LengthUnit::Native) * area)?;
    if material.depth > 0.0 {
        material.depth = MapScale::native(material.depth / area);
        field
            .ground
            .borrow_mut()
            .deposit_package(cell, &[material], cause, Pool::Load, None)?;
    }
    Ok(())
}
fn remove(field: &mut Field, cell: usize, depth: f64, cause: &str, loose: bool) -> io::Result<()> {
    let mut ground = field.ground.borrow_mut();
    let area = field.mesh.area(cell);
    let load = &mut field.ground_load;
    let mut receive = |mut material: MaterialLayer| {
        material.depth = MapScale::metres(material.depth, LengthUnit::Native) * area;
        load.add(cell, &material)
    };
    if loose {
        let soil = ground.view(GroundField::SoilDepth).get(cell)?;
        for facet in Facet::ALL {
            if ground.share(cell, facet)? > 0.0 {
                ground.withdraw(
                    Withdrawal {
                        cell,
                        facet,
                        pool: MaterialPool::Loose,
                        amount: depth,
                        cause,
                        soil,
                    },
                    &mut receive,
                )?;
            }
        }
    } else {
        ground.erode_facets(cell, [depth, depth], cause, Pool::Load, &mut receive)?;
    }
    Ok(())
}
fn alter(field: &mut Field, cell: usize, delta: f64) -> io::Result<()> {
    let depth = MapScale::native(
        field
            .scale
            .resolve(RelativeMeasure::length(0.000035).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value(),
    );
    let mut ground = field.ground.borrow_mut();
    let epoch = ground.completed_epochs();
    ground.alter(
        cell,
        &Alteration {
            depth,
            offset: 0.0,
            from_rock: false,
            retained_only: false,
            facet: None,
            transform: &|layer| {
                Some(MaterialLayer {
                    strength: (layer.strength + delta)
                        .clamp(catalogue::SOFTEST_ROCK, catalogue::HARDEST_ROCK),
                    altered: epoch,
                    ..layer.clone()
                })
            },
        },
    )
}
struct Owners {
    melt: Command<Field, Melt>,
    spoil: Command<Field, Spoil>,
}
impl Owners {
    fn settle(
        &self,
        context: &mut CommandContext<'_, Field>,
        input: &Request,
        delta: f64,
        cause: &str,
    ) -> ExecutionResult<()> {
        let cell = input.cell;
        match input.band {
            Band::IceThickness | Band::SoilDepth => {
                if delta > 0.0 {
                    return Err(io::Error::other(
                        "A place can remove existing ice or soil skin; it cannot manufacture it",
                    )
                    .into());
                }
                if matches!(input.band, Band::IceThickness) {
                    context.run(
                        &self.melt,
                        &Melt {
                            cell,
                            amount: -delta,
                            cause: cause.into(),
                            beneath: true,
                            exposure: 1.0,
                        },
                    )?;
                } else {
                    let share = -delta / Band::SoilDepth.read(context.state(), cell)?;
                    context.run(
                        &self.spoil,
                        &Spoil {
                            cell,
                            share,
                            cause: cause.into(),
                        },
                    )?;
                }
            }
            Band::SedimentThickness if delta < 0.0 => {
                remove(context.state_mut(), cell, -delta, cause, true)?
            }
            Band::SedimentThickness => land_available(context.state_mut(), cell, delta, cause)?,
            Band::RockResistance => alter(context.state_mut(), cell, delta)?,
            Band::Elevation if delta < 0.0 => {
                remove(context.state_mut(), cell, -delta, cause, false)?
            }
            Band::Elevation => context
                .state_mut()
                .ground
                .borrow_mut()
                .displace(cell, delta, cause)?,
        }
        Ok(())
    }
}
pub struct Operations {
    pub execute: Command<Field, Request>,
    pub realize: Command<Field, Request>,
}
impl Operations {
    pub fn new() -> Self {
        let direct = Owners {
            melt: Field::melt_ice(),
            spoil: Field::spoil_soil(),
        };
        let maintained = Owners {
            melt: Field::melt_ice(),
            spoil: Field::spoil_soil(),
        };
        Self {
            execute: Command::with_inputs(
                "place-event.ground-target",
                CommandKind::Work,
                vec![],
                move |context, input: &Request| {
                    let current = input.band.read(context.state(), input.cell)?;
                    let delta = input.target.next(current) - current;
                    if delta != 0.0 {
                        direct.settle(context, input, delta, "place-event")?;
                    }
                    Ok(())
                },
            ),
            realize: Command::with_inputs(
                "places.ground-target",
                CommandKind::Work,
                vec![],
                move |context, input: &Request| {
                    let field = context.state_mut();
                    let index = input.band as usize;
                    let applied = field.settled_place_targets[index]
                        .get_or_insert_with(|| field.coverage.get_mut().allocate(0.0));
                    let mut previous = applied.get(input.cell)?;
                    if input.target.add * previous < 0.0 {
                        previous = 0.0;
                        applied.set(input.cell, 0.0)?;
                    }
                    let current = input.band.read(field, input.cell)?;
                    let pending = unsettled_addition(input.target.add, previous);
                    let delta = Target {
                        add: pending,
                        ..input.target
                    }
                    .next(current)
                        - current;
                    if delta == 0.0 {
                        return Ok(());
                    }
                    maintained.settle(context, input, delta, "places")?;
                    let field = context.state_mut();
                    let changed = input.band.read(field, input.cell)? - current;
                    if changed * pending > 0.0 {
                        field.settled_place_targets[index].as_mut().unwrap().set(
                            input.cell,
                            previous + pending.signum() * changed.abs().min(pending.abs()),
                        )?;
                    }
                    Ok(())
                },
            ),
        }
    }
}
impl Default for Operations {
    fn default() -> Self {
        Self::new()
    }
}
