//! A map owns the systems, their meetings and present contributions; current reads do not supply history.
use super::{
    carriers::Costs,
    channels::Channel as C,
    classification,
    configuration::{validate_systems, Phase, System},
    confluences::{
        self,
        configuration::{self as meeting, Confluence},
    },
    feedback::{self, Forcing},
    hallowed::{rims::Rims, Seats},
    material,
    propagation::run as propagation,
    regions, salt,
    sources::{
        placed::PlacedSource,
        run::{self as sources, Locate, People, Supply},
        Environment,
    },
    state::{system_seed, MagicField},
    surface::Surfaces,
    veil, weather,
};
use crate::{
    rock::{ground::Ground, load::MaterialLoad},
    scale::MapScale,
    spatial::SpatialKernel,
    storage::{Coverage, ReadBand},
    water::{network::RiverReader, Water},
};
use std::io;
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Configuration {
    pub enabled: bool,
    pub systems: Vec<System>,
    pub confluences: Vec<Confluence>,
}
pub struct Workspace {
    pub fields: Vec<MagicField>,
    pub meetings: confluences::Workspace,
    pub forcing: Forcing,
    pub surfaces: Surfaces,
    pub rims: Rims,
    pub carrier_costs: Costs,
}
pub struct Activity {
    pub system: String,
    pub multiplier: f64,
}
pub struct Evaluation<'a> {
    pub seed: i32,
    pub epoch: i32,
    pub activity: &'a [Activity],
    pub phase: Option<Phase>,
    pub placed: &'a [PlacedSource],
    pub space_id: &'a str,
    pub people: People<'a>,
    pub rivers: &'a RiverReader<'a>,
    pub kernel: &'a dyn SpatialKernel,
}
impl Workspace {
    pub fn begin_epoch(&mut self) -> io::Result<()> {
        for band in [
            &mut self.forcing.heat,
            &mut self.forcing.melt,
            &mut self.forcing.coastal,
        ] {
            for cell in 0..band.len() {
                band.set(cell, 0.0)?;
            }
        }
        Ok(())
    }
    pub fn inherit(
        &mut self,
        parent: &super::inheritance::Inheritance<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        for field in &mut self.fields {
            parent.field(field, coverage)?;
        }
        Ok(())
    }
    pub fn new(
        config: Configuration,
        scale: &MapScale,
        coverage: &mut Coverage,
        ground: &mut Ground,
    ) -> io::Result<Self> {
        validate_systems(&config.systems).map_err(io::Error::other)?;
        let mut fields = Vec::new();
        let mut definitions = Vec::new();
        if config.enabled {
            for system in config.systems {
                fields.push(MagicField::new(
                    system.resolve(scale).map_err(io::Error::other)?,
                    coverage,
                    ground,
                )?);
            }
            definitions =
                meeting::resolve_all(config.confluences, scale).map_err(io::Error::other)?;
        }
        Ok(Self {
            fields,
            meetings: confluences::Workspace::new(definitions, coverage),
            forcing: Forcing::new(coverage),
            surfaces: Surfaces::new(coverage),
            rims: Rims::new(coverage),
            carrier_costs: Costs::default(),
        })
    }
    pub fn refresh(
        &mut self,
        env: &mut Environment<'_>,
        evaluation: &Evaluation<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let selected = self
            .fields
            .iter()
            .enumerate()
            .filter(|(_, field)| {
                evaluation.phase.is_none_or(|phase| {
                    field.definition.phase == phase || field.definition.effects.warding > 0.0
                })
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        for &index in &selected {
            if self.fields[index].definition.effects.warding > 0.0 {
                self.evaluate_field(env, index, evaluation, coverage)?;
            }
        }
        feedback::living(
            env,
            &self.fields,
            evaluation.rivers,
            false,
            &mut self.rims,
            coverage,
        )?;
        for &index in &selected {
            let e = &self.fields[index].definition.effects;
            if e.warding == 0.0 && e.tearing == 0.0 {
                self.evaluate_field(env, index, evaluation, coverage)?;
            }
        }
        feedback::living(
            env,
            &self.fields,
            evaluation.rivers,
            false,
            &mut self.rims,
            coverage,
        )?;
        regions::cover_systems(env, &mut self.fields, evaluation.seed, coverage)?;
        self.meetings
            .evaluate(env, &mut self.fields, evaluation.seed, coverage)?;
        for &index in &selected {
            if self.fields[index].definition.effects.tearing > 0.0 {
                self.evaluate_field(env, index, evaluation, coverage)?;
            }
        }
        Ok(())
    }
    fn evaluate_field(
        &mut self,
        env: &Environment<'_>,
        index: usize,
        evaluation: &Evaluation<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        if !self.fields[index].definition.enabled {
            return clear_current(&mut self.fields[index], env.mesh.len());
        }
        let local = system_seed(evaluation.seed, &self.fields[index].definition.id);
        let activity = activity(&self.fields[index], evaluation.activity);
        let still = first_effect(
            &self.fields,
            |field| field.definition.effects.stillness,
            C::Stored,
        );
        let fire = first_effect(
            &self.fields,
            |field| field.definition.effects.quickening,
            C::Source,
        );
        let doors = veil::doors::Conditions::for_field(&self.fields, &self.fields[index]);
        let others: Vec<_> = self
            .fields
            .iter()
            .filter(|field| field.definition.enabled && field.definition.effects.tearing == 0.0)
            .map(|field| field.channel(C::Intensity))
            .collect();
        let meetings = self
            .meetings
            .states
            .iter()
            .map(|state| state.coverage.read_only())
            .collect::<Vec<_>>();
        sources::locate(
            env,
            &mut self.fields[index],
            &Locate {
                seed: local,
                epoch: evaluation.epoch,
                activity,
                placed: evaluation.placed,
                space_id: evaluation.space_id,
                people: People {
                    seats: Seats {
                        living: evaluation.people.seats.living,
                        ways: evaluation.people.seats.ways,
                        tenure: evaluation.people.seats.tenure,
                    },
                    kept: evaluation.people.kept,
                    walked: evaluation.people.walked,
                },
                other_systems: &others,
                meetings: &meetings,
                doors: &doors,
                kernel: evaluation.kernel,
            },
            coverage,
        )?;
        let wards = self
            .fields
            .iter()
            .any(|field| field.definition.enabled && field.definition.effects.warding > 0.0);
        propagation::propagate(
            env,
            &mut self.fields[index],
            propagation::Run {
                seed: local,
                activity,
                forcing: propagation::Forcing {
                    costs: &self.carrier_costs,
                    rims: wards.then_some(&self.rims),
                    still,
                    fire,
                },
            },
            coverage,
        )
    }
    pub fn shared_forcing(
        &mut self,
        env: &mut Environment<'_>,
        water: &mut Water,
        exposure: f64,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        feedback::thermal(env, water, &mut self.fields, &mut self.forcing, exposure)?;
        feedback::living(
            env,
            &self.fields,
            &water.river_reader(),
            exposure > 0.0,
            &mut self.rims,
            coverage,
        )?;
        feedback::ocean::feedback(env, &self.fields, &mut self.forcing, coverage)?;
        feedback::refresh_ice(env, &self.fields)
    }
    pub fn classify(
        &mut self,
        env: &Environment<'_>,
        rivers: &RiverReader<'_>,
        ecology_initialized: bool,
        seed: i32,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.surfaces.classify(env, rivers, ecology_initialized)?;
        regions::cover_systems(env, &mut self.fields, seed, coverage)?;
        self.meetings
            .evaluate(env, &mut self.fields, seed, coverage)?;
        classification::paint(&mut self.surfaces, &self.fields, &self.meetings, coverage)
    }
    pub fn supply_phase(
        &mut self,
        env: &mut Environment<'_>,
        input: &mut Supply<'_>,
        phase: Phase,
        activities: &[Activity],
    ) -> io::Result<()> {
        for field in &mut self.fields {
            if field.definition.phase == phase {
                input.activity = activity(field, activities);
                sources::supply(env, field, input)?;
            } else if field.definition.enabled && phase == Phase::Climate {
                for cell in 0..env.mesh.len() {
                    field.fresh.set(cell, 0.0)?;
                    let value = (field.channels.band(C::Stored).get(cell)? + 0.5)
                        .floor()
                        .min(1000.0);
                    field.channels.band_mut(C::Intensity).set(cell, value)?;
                }
            }
        }
        Ok(())
    }
    pub fn supply_society_events(
        &mut self,
        env: &mut Environment<'_>,
        input: &mut Supply<'_>,
        activities: &[Activity],
    ) -> io::Result<()> {
        for field in &mut self.fields {
            input.activity = activity(field, activities);
            sources::supply_society_events(env, field, input)?;
        }
        Ok(())
    }
}
pub struct Reaction<'a> {
    pub seed: i32,
    pub phase: i32,
    pub span: f64,
    pub weather: &'a weather::Settings,
    pub load: &'a mut MaterialLoad,
    pub sea: &'a mut MaterialLoad,
}
pub struct Loads<'a> {
    pub ground: &'a mut MaterialLoad,
    pub sea: &'a mut MaterialLoad,
}
impl Workspace {
    pub fn retain_history(
        &mut self,
        env: &mut Environment<'_>,
        water: &mut Water,
        epoch: i32,
        loads: Loads<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<Vec<feedback::history::Record>> {
        water.remember_lakes()?;
        let rivers = water.river_reader();
        let mut carriage = super::stocks::run::Carriage {
            transport: super::stocks::Transport {
                coverage,
                sea: loads.sea,
                costs: &self.carrier_costs,
            },
            rivers: &rivers,
            load: loads.ground,
        };
        feedback::history::retain(
            env,
            &mut self.fields,
            &mut self.forcing,
            epoch,
            &mut carriage,
        )
    }
    pub fn react(
        &mut self,
        env: &mut Environment<'_>,
        water: &mut Water,
        input: &mut Reaction<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        if input.span <= 0.0 {
            return Ok(());
        }
        feedback::thermal(env, water, &mut self.fields, &mut self.forcing, input.span)?;
        self.meetings
            .evaluate(env, &mut self.fields, input.seed, coverage)?;
        confluences::actions::apply(
            env,
            water,
            &mut self.fields,
            &self.meetings,
            input.seed,
            input.span,
        )?;
        weather::write(
            env,
            water,
            input.weather,
            &mut weather::Carriers {
                load: input.load,
                sea: input.sea,
                wind: self.carrier_costs.wind.as_ref(),
            },
        )?;
        salt::write(env, &mut self.fields)?;
        self.hallowed_response(env, coverage)?;
        for field in self
            .fields
            .iter()
            .filter(|field| field.definition.enabled && field.definition.effects.tearing > 0.0)
        {
            veil::write(env, field, coverage, input.phase)?;
        }
        material::on_column(env, &mut self.fields, input.load, input.seed, input.span)
    }
    fn hallowed_response(
        &self,
        env: &mut Environment<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        if !self
            .fields
            .iter()
            .any(|field| field.definition.enabled && field.definition.effects.warding > 0.0)
        {
            return Ok(());
        }
        self.rims.redirect_storm(env, coverage)?;
        for field in self
            .fields
            .iter()
            .filter(|field| field.definition.enabled && field.definition.effects.warding > 0.0)
        {
            super::hallowed::rims::spill_below(env, field)?;
        }
        Ok(())
    }
}
fn activity(field: &MagicField, activities: &[Activity]) -> f64 {
    if field.definition.enabled {
        field.definition.strength
            * activities
                .iter()
                .find(|activity| activity.system == field.definition.id)
                .map_or(1.0, |activity| activity.multiplier)
    } else {
        0.0
    }
}
fn first_effect(
    fields: &[MagicField],
    effect: impl Fn(&MagicField) -> f64,
    channel: C,
) -> Option<ReadBand<f64>> {
    fields
        .iter()
        .find(|field| field.definition.enabled && effect(field) > 0.0)
        .map(|field| field.channel(channel))
}
fn clear_current(field: &mut MagicField, count: usize) -> io::Result<()> {
    for cell in 0..count {
        field.fresh.set(cell, 0.0)?;
        for channel in [
            C::Intensity,
            C::Source,
            C::Wake,
            C::Rogue,
            C::Retained,
            C::Releasing,
            C::Radii,
            C::Wild,
        ] {
            field.channels.band_mut(channel).set(cell, 0.0)?;
        }
        for origin in &mut field.origins {
            origin.source.set(cell, 0.0)?;
        }
    }
    field.located.clear();
    field.doors.clear();
    Ok(())
}
