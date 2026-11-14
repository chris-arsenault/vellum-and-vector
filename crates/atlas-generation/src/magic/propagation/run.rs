//! Each origin owns its propagation; their present outputs merge before retained charge and wards.
use super::{
    channels::{self, Network, Route},
    cold::{self, Fallout},
    ocean,
};
use crate::{
    magic::{
        carriers::Costs,
        channels::Channel as C,
        configuration::Propagation,
        hallowed::{self, rims::Rims},
        sources::{propagation_activity, Context, Environment},
        state::MagicField,
    },
    storage::{Band, Coverage, ReadBand},
};
use std::io;
pub struct Forcing<'a> {
    pub costs: &'a Costs,
    pub rims: Option<&'a Rims>,
    pub still: Option<ReadBand<f64>>,
    pub fire: Option<ReadBand<f64>>,
}
pub struct Run<'a> {
    pub seed: i32,
    pub activity: f64,
    pub forcing: Forcing<'a>,
}
struct Merge {
    intensity: Band<f64>,
    wake: Band<f64>,
    rogue: Band<f64>,
    retained: Band<f64>,
    parents: Option<Band<i32>>,
    paths: Vec<Vec<[f64; 2]>>,
}
impl Merge {
    fn new(coverage: &mut Coverage) -> Self {
        let length = coverage.len();
        Self {
            intensity: coverage.scratch(length, 0.0),
            wake: coverage.scratch(length, 0.0),
            rogue: coverage.scratch(length, 0.0),
            retained: coverage.scratch(length, 0.0),
            parents: None,
            paths: vec![],
        }
    }
    fn take(&mut self, field: &mut MagicField, scalar: f64) -> io::Result<()> {
        for cell in 0..self.intensity.len() {
            self.intensity.set(
                cell,
                self.intensity
                    .get(cell)?
                    .max(field.channels.band(C::Intensity).get(cell)? * scalar),
            )?;
            self.wake.set(
                cell,
                self.wake
                    .get(cell)?
                    .max(field.channels.band(C::Wake).get(cell)?),
            )?;
            self.rogue.set(
                cell,
                self.rogue
                    .get(cell)?
                    .max(field.channels.band(C::Rogue).get(cell)?),
            )?;
            self.retained.set(
                cell,
                self.retained.get(cell)? + field.channels.band(C::Retained).get(cell)? * scalar,
            )?;
        }
        if self.parents.is_none() {
            self.parents = field.parents.take();
        } else {
            field.parents = None;
        }
        self.paths.append(&mut field.wake_paths);
        Ok(())
    }
    fn install(self, env: &Environment<'_>, field: &mut MagicField) -> io::Result<()> {
        let ground = field
            .definition
            .origins
            .iter()
            .enumerate()
            .find_map(|(i, origin)| {
                origin
                    .stocks
                    .iter()
                    .position(|stock| stock.reservoir == "ground")
                    .map(|j| (i, j))
            });
        for cell in 0..self.intensity.len() {
            if let Some((origin, stock)) = ground {
                let stored = field.origins[origin].stocks[stock].get(env.ground, cell)?
                    / env.mesh.area(cell);
                field.channels.band_mut(C::Stored).set(cell, stored)?;
            }
            let stored = field.channels.band(C::Stored).get(cell)?;
            let intensity = (self.intensity.get(cell)? + stored).clamp(0.0, 1000.0);
            field.channels.band_mut(C::Intensity).set(cell, intensity)?;
            field.fresh.set(cell, (intensity - stored).max(0.0))?;
            field
                .channels
                .band_mut(C::Wake)
                .set(cell, self.wake.get(cell)? * f64::from(intensity > 0.0))?;
            field
                .channels
                .band_mut(C::Rogue)
                .set(cell, self.rogue.get(cell)?)?;
            field
                .channels
                .band_mut(C::Retained)
                .set(cell, self.retained.get(cell)?)?;
        }
        field.parents = self.parents;
        field.wake_paths = self.paths;
        Ok(())
    }
}
pub fn propagate(
    env: &Environment<'_>,
    field: &mut MagicField,
    run: Run<'_>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    clear(field, env.mesh.len())?;
    for cell in 0..env.mesh.len() {
        field.fresh.set(cell, 0.0)?;
    }
    if !field.definition.enabled {
        for cell in 0..env.mesh.len() {
            field.channels.band_mut(C::Source).set(cell, 0.0)?;
            field.channels.band_mut(C::Radii).set(cell, 0.0)?;
        }
        field.located.clear();
        return Ok(());
    }
    let external = source_set_directly(field, env.mesh.len())?;
    let mut merged = Merge::new(coverage);
    for origin in 0..field.definition.origins.len() {
        let source = field.definition.origins[origin].source;
        let activity = propagation_activity(source, run.activity);
        let shared = field.definition.origins.len() == 1 || (external && origin == 0);
        clear(field, env.mesh.len())?;
        let saved_source = if shared {
            None
        } else {
            let values = field.origins[origin].source.snapshot()?;
            Some(field.channels.replace(C::Source, values))
        };
        let saved_points = if shared {
            None
        } else {
            let all = std::mem::take(&mut field.located);
            field.located = all
                .iter()
                .filter(|point| point.origin == field.definition.origins[origin].id)
                .cloned()
                .collect();
            Some(all)
        };
        let context = Context {
            origin,
            epoch: 0,
            activity,
        };
        let result = propagate_origin(env, field, context, &run, coverage);
        if let Some(source) = saved_source {
            field.channels.replace(C::Source, source);
        }
        if let Some(points) = saved_points {
            field.located = points;
        }
        result?;
        let scalar = if matches!(
            field.definition.origins[origin].propagation,
            Propagation::Radial | Propagation::Local | Propagation::Brine | Propagation::Ward
        ) {
            activity
        } else {
            1.0
        };
        merged.take(field, scalar)?;
    }
    merged.install(env, field)?;
    apply_wards(env, field, run.forcing.rims, coverage)
}
fn apply_wards(
    env: &Environment<'_>,
    field: &mut MagicField,
    rims: Option<&Rims>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    if let Some(rims) = rims {
        rims.apply(env, field, coverage)?;
        std::mem::swap(&mut field.fresh, field.channels.band_mut(C::Intensity));
        let result = rims.apply(env, field, coverage);
        std::mem::swap(&mut field.fresh, field.channels.band_mut(C::Intensity));
        result?;
    }
    Ok(())
}
fn propagate_origin(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    run: &Run<'_>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let source = field.channels.view(C::Source);
    match field.definition.origins[context.origin].propagation {
        Propagation::Fracture => channels::propagate(
            env,
            field,
            Route {
                network: Network::Fractures,
                context,
                source: &source,
                placed_cost: run.forcing.costs.crust.as_ref(),
            },
            coverage,
        ),
        Propagation::Roots => channels::propagate(
            env,
            field,
            Route {
                network: Network::Roots,
                context,
                source: &source,
                placed_cost: run.forcing.costs.roots.as_ref(),
            },
            coverage,
        ),
        Propagation::ColdDrainage => cold::propagate(
            env,
            field,
            Fallout {
                context,
                seed: run.seed,
                source: &source,
                placed_cost: run.forcing.costs.ice.as_ref(),
            },
            coverage,
        ),
        Propagation::OceanRays => {
            ocean::propagate(env, field, context, &source, run.seed, coverage)
        }
        Propagation::Local => super::local(env, field, &source),
        Propagation::Radial => super::radial(env, field, context, true),
        Propagation::Brine => super::brine(env, field, context),
        Propagation::Ward => hallowed::propagate(
            env,
            field,
            context,
            run.forcing.still.as_ref(),
            run.forcing.fire.as_ref(),
        ),
    }
}
fn clear(field: &mut MagicField, count: usize) -> io::Result<()> {
    for channel in [C::Intensity, C::Wake, C::Rogue, C::Retained] {
        for cell in 0..count {
            field.channels.band_mut(channel).set(cell, 0.0)?;
        }
    }
    field.parents = None;
    field.wake_paths.clear();
    Ok(())
}
fn source_set_directly(field: &MagicField, count: usize) -> io::Result<bool> {
    for cell in 0..count {
        let strength = field.channels.band(C::Source).get(cell)?;
        if strength <= 0.0 {
            continue;
        }
        let mut direct = true;
        for origin in &field.origins {
            if origin.source.get(cell)? >= strength {
                direct = false;
                break;
            }
        }
        if direct {
            return Ok(true);
        }
    }
    Ok(false)
}
