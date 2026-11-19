use super::{cold, fallen, geothermal, greenwood, ocean, placed, salt, Context, Environment};
use crate::{
    magic::{
        channels::Channel as C,
        configuration::Source,
        hallowed::{self, Seats},
        state::{system_seed, MagicField},
        veil::{self, doors},
    },
    spatial::SpatialKernel,
    storage::{Band, Coverage, ReadBand},
    water::Water,
};
use std::io;
pub struct People<'a> {
    pub seats: Seats<'a>,
    pub kept: &'a ReadBand<f64>,
    pub walked: &'a ReadBand<f64>,
}
pub struct Locate<'a> {
    pub seed: i32,
    pub epoch: i32,
    pub activity: f64,
    pub placed: &'a [placed::PlacedSource],
    pub space_id: atlas_map::Id,
    pub people: People<'a>,
    pub other_systems: &'a [ReadBand<f64>],
    pub meetings: &'a [ReadBand<f64>],
    pub doors: &'a doors::Conditions,
    pub kernel: &'a dyn SpatialKernel,
}
pub fn locate(
    env: &Environment<'_>,
    field: &mut MagicField,
    input: &Locate<'_>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        field.channels.band_mut(C::Source).set(cell, 0.0)?;
        field.channels.band_mut(C::Radii).set(cell, 0.0)?;
        for origin in &mut field.origins {
            origin.source.set(cell, 0.0)?;
        }
    }
    field.located.clear();
    if !field.definition.enabled {
        return Ok(());
    }
    let mut merged = coverage.scratch(env.mesh.len(), 0.0);
    let mut radii = coverage.scratch(env.mesh.len(), 0.0);
    for origin in 0..field.origins.len() {
        for cell in 0..env.mesh.len() {
            field.channels.band_mut(C::Source).set(cell, 0.0)?;
            field.channels.band_mut(C::Radii).set(cell, 0.0)?;
        }
        let context = Context {
            origin,
            epoch: input.epoch,
            activity: input.activity,
        };
        let seed = if origin == 0 {
            input.seed
        } else {
            system_seed(input.seed, &field.definition.origins[origin].id)
        };
        let before = field.located.len();
        locate_origin(env, field, input, context, seed)?;
        if origin == 0 {
            placed::locate(env, field, context, input.placed, input.space_id)?;
        }
        for point in &mut field.located[before..] {
            point.origin = field.definition.origins[origin].id.clone();
        }
        capture_source(field, origin, &mut merged, &mut radii)?;
    }
    for cell in 0..env.mesh.len() {
        field
            .channels
            .band_mut(C::Source)
            .set(cell, merged.get(cell)?)?;
        field
            .channels
            .band_mut(C::Radii)
            .set(cell, radii.get(cell)?)?;
    }
    Ok(())
}
fn capture_source(
    field: &mut MagicField,
    origin: usize,
    merged: &mut Band<f64>,
    radii: &mut Band<f64>,
) -> io::Result<()> {
    for cell in 0..merged.len() {
        let strength = field.channels.band(C::Source).get(cell)?;
        field.origins[origin].source.set(cell, strength)?;
        if strength > merged.get(cell)? {
            merged.set(cell, strength)?;
            radii.set(cell, field.channels.band(C::Radii).get(cell)?)?;
        }
    }
    Ok(())
}
fn locate_origin(
    env: &Environment<'_>,
    field: &mut MagicField,
    input: &Locate<'_>,
    context: Context,
    seed: i32,
) -> io::Result<()> {
    match field.definition.origins[context.origin].source {
        Source::Geothermal => geothermal::locate(env, field, context, seed, input.kernel),
        Source::Cold => cold(env, field, context),
        Source::DeepOcean => ocean::locate(env, field, context, seed, input.kernel),
        Source::Placed => Ok(()), // Placed sources join the first origin after its locator.
        Source::Verdant => greenwood::verdant(env, field, context),
        Source::Aquifer => greenwood::aquifer(env, field, context),
        Source::Impact => fallen::locate(env, field, context),
        Source::Forge => greenwood::forge(env, field, context),
        Source::Death | Source::DeadLake => salt::locate(env, field, context),
        Source::Tenure => hallowed::tenure(
            env,
            field,
            context,
            Seats {
                living: input.people.seats.living,
                ways: input.people.seats.ways,
                tenure: input.people.seats.tenure,
            },
        ),
        Source::KeptLine => {
            hallowed::kept_lines(env, field, context, input.people.kept, input.people.walked)
        }
        Source::Strain => {
            veil::strain_sources(env, field, context, input.other_systems, input.meetings)
        }
        Source::Pairing => doors::pair(env, field, context, input.doors, input.kernel),
    }
}
pub struct Supply<'a> {
    pub seed: i32,
    pub epoch: i32,
    pub activity: f64,
    pub deaths: &'a mut dyn FnMut(usize) -> io::Result<f64>,
    pub water: &'a mut Water,
    pub kernel: &'a dyn SpatialKernel,
}
pub fn supply(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    input: &mut Supply<'_>,
) -> io::Result<()> {
    if field.supplied_epoch == input.epoch {
        return Ok(());
    }
    field.supplied_epoch = input.epoch;
    let local = system_seed(input.seed, &field.definition.id);
    for origin in 0..field.origins.len() {
        let seed = if origin == 0 {
            local
        } else {
            system_seed(local, &field.definition.origins[origin].id)
        };
        let context = Context {
            origin,
            epoch: input.epoch,
            activity: input.activity,
        };
        match field.definition.origins[origin].source {
            Source::Geothermal => geothermal::supply(env, field, context, seed, input.kernel)?,
            Source::Verdant => greenwood::supply_sap(env, field, context)?,
            Source::Impact => fallen::supply(env, field, context)?,
            Source::Death => salt::supply_death(env, field, context, input.deaths)?,
            Source::DeadLake => salt::supply_lake(env, field, context, input.water)?,
            Source::Cold
            | Source::DeepOcean
            | Source::Placed
            | Source::Aquifer
            | Source::Forge
            | Source::Tenure
            | Source::KeptLine
            | Source::Strain
            | Source::Pairing => {}
        }
    }
    Ok(())
}
pub fn supply_society_events(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    input: &mut Supply<'_>,
) -> io::Result<()> {
    for origin in 0..field.origins.len() {
        if field.definition.origins[origin].source == Source::Death {
            salt::supply_death(
                env,
                field,
                Context {
                    origin,
                    epoch: input.epoch,
                    activity: input.activity,
                },
                input.deaths,
            )?;
        }
    }
    Ok(())
}
