//! Existing standalone map sources use private surface fields and the common material owner.
use super::{
    dispatch::{Input, Process, Registry, Specification},
    state::State,
};
use crate::{
    execution::{Command, CommandKind, ExecutionResult},
    field::{forcing, landmarks::magic::Source, projection::local_magic::Activity},
};
use std::{io, rc::Rc};

const INVALIDATED_CLIMATE: &[&str] = &[
    "Temperature",
    "ColumnPrecipitation",
    "Snowfall",
    "Rainfall",
    "AtmosphericWaterRate",
    "Runoff",
    "drainage",
    "FlowAccumulation",
    "lakes",
    "IceThickness",
];
fn activity(input: &Input, epochs: usize) -> ExecutionResult<Activity> {
    Ok(Activity {
        source: input.number("sourceActivity")?,
        heat: input.number("heatActivity")?,
        cold: input.number("coldActivity")?,
        epoch: input
            .physical
            .epoch
            .unwrap_or_else(|| epochs.saturating_sub(1)),
    })
}
fn specification(
    name: &str,
    requires: &str,
    produces: &str,
    activities: bool,
) -> io::Result<Specification> {
    let mut spec = Specification::new(name, requires, produces, false);
    if activities {
        spec.parameters = serde_json::from_value(serde_json::json!({
            "sourceActivity": {"type":"number","unit":"ratio","required":false,"default":1},
            "heatActivity": {"type":"number","unit":"ratio","required":false,"default":1},
            "coldActivity": {"type":"number","unit":"ratio","required":false,"default":1}
        }))?;
    }
    Ok(spec)
}
fn thermal(sources: Rc<Vec<Source>>) -> Command<State, Activity> {
    Command::with_inputs(
        "magic.thermal",
        CommandKind::Event,
        vec![],
        move |scope, input| {
            let state: &mut State = scope.state_mut();
            let causes = state.physical.surface.thermal_sources(
                &sources,
                &state.scope.space,
                input,
                state.spatial.as_ref(),
            )?;
            state.causes.extend(causes);
            Ok(())
        },
    )
}
fn storage(sources: Rc<Vec<Source>>) -> Command<State, f64> {
    Command::with_inputs(
        "magic.advanceStorage",
        CommandKind::Elapsed,
        vec![],
        move |scope, years: &f64| {
            let state: &mut State = scope.state_mut();
            let causes = state.physical.surface.advance_local_storage(
                &sources,
                &state.scope.space,
                *years,
                &state.causes,
            )?;
            state.causes.extend(causes);
            Ok(())
        },
    )
}
struct Material {
    activity: Activity,
    react: bool,
}
fn material(sources: Rc<Vec<Source>>) -> Command<State, Material> {
    Command::with_inputs(
        "magic.material",
        CommandKind::Event,
        vec![],
        move |scope, input: &Material| {
            let state: &mut State = scope.state_mut();
            let physical = &mut state.physical;
            let (causes, altered) = physical.surface.local_material(
                &sources,
                &state.scope.space,
                &input.activity,
                state.spatial.as_ref(),
                input.react,
            )?;
            for channel in altered {
                physical.executor.run_with(
                    &forcing::alter_source_ground(),
                    &forcing::Material {
                        surface: &physical.surface,
                        channel: &channel,
                    },
                )?;
            }
            state.causes.extend(causes);
            Ok(())
        },
    )
}
fn advection() -> Command<State> {
    Command::new(
        "magic.advection",
        CommandKind::Event,
        vec![],
        |state: &mut State, _| {
            let physical = &mut state.physical;
            physical.surface.advect_local_magic(
                physical.executor.state(),
                &physical.field_footprint,
                state.spatial.as_ref(),
            )?;
            Ok(())
        },
    )
}
fn heat_specification() -> io::Result<Specification> {
    let mut heat = specification("magic.thermal", "Elevation", "Heat StoredHeat", true)?;
    for parameter in heat.parameters.values_mut() {
        parameter.minimum = Some(0.0);
    }
    heat.contract.invalidates = INVALIDATED_CLIMATE.iter().map(|s| (*s).into()).collect();
    Ok(heat)
}
fn storage_specification() -> io::Result<Specification> {
    let mut stored = specification("magic.advanceStorage", "Heat", "magicStorage", false)?;
    stored.contract.invalidates = std::iter::once("Heat")
        .chain(INVALIDATED_CLIMATE.iter().copied())
        .map(str::to_owned)
        .collect();
    Ok(stored.elapsed(crate::bindings::DurationBinding::EpochFraction(1.0)))
}
fn material_specification() -> io::Result<Specification> {
    let mut rocks = specification("magic.material", "Elevation geology", "magicMaterial", true)?;
    rocks.parameters.insert(
        "react".into(),
        serde_json::from_value(
            serde_json::json!({"type":"boolean","unit":null,"required":false,"default":false}),
        )?,
    );
    Ok(rocks)
}
fn advection_specification() -> io::Result<Specification> {
    specification("magic.advection", "atlas:workspace", "", false)
}
pub fn specifications() -> io::Result<Vec<Specification>> {
    Ok(vec![
        heat_specification()?,
        storage_specification()?,
        material_specification()?,
        advection_specification()?,
    ])
}
pub fn register(
    registry: &mut Registry,
    sources: Rc<Vec<Source>>,
    epochs: usize,
) -> io::Result<()> {
    registry.register(Process::command(
        heat_specification()?,
        thermal(sources.clone()),
        move |input| activity(input, epochs),
    ))?;
    registry.register(Process::command(
        storage_specification()?,
        storage(sources.clone()),
        |input| {
            input
                .epochs
                .last()
                .map(|epoch| epoch.duration)
                .ok_or_else(|| {
                    io::Error::other("Advance magical storage in an explicit epoch").into()
                })
        },
    ))?;
    registry.register(Process::command(
        material_specification()?,
        material(sources),
        move |input| {
            Ok(Material {
                activity: activity(input, epochs)?,
                react: input.flag("react")?,
            })
        },
    ))?;
    registry.register(Process::unit(advection_specification()?, advection()))
}
