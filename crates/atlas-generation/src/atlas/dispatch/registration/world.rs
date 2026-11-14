use super::super::{Process, Registry, Specification};
use crate::atlas::{people::Publication, world::Operations};
use crate::field::projection::channels::Channel;
use std::collections::BTreeSet;
use std::io;

type Select = fn(&Operations) -> &crate::execution::Command<crate::atlas::state::State>;
type Definition = (&'static str, Select, &'static str, &'static str, bool);
const DEFINITIONS: &[Definition] = &[
    ("atlas.prepare", |o| &o.prepare, "", "", false),
    ("atlas.names", |o| &o.names, "", "atlasNames", false),
    ("atlas.absent-physical", |o| &o.absent, "atlas:workspace", "", true),
    ("atlas.begin-epoch", |o| &o.epoch, "atlas:workspace", "", true),
    ("poi.effects", |o| &o.place_effects, "atlas:workspace", "", true),
    ("atlas.features", |o| &o.features, "atlas:validated", "geographicFeatures", false),
    ("atlas.magic-places", |o| &o.magic_places, "", "magicalPlaces", false),
    ("atlas.project-forcing", |o| &o.project_forcing, "atlas:workspace", "Elevation geology FractureConductance NaturalTemperature NaturalRockResistance BaseSeaLevel EffectiveSeaLevel", false),
];
fn declared(&(name, _, requires, produces, workspace): &Definition) -> Specification {
    Specification::new(name, requires, produces, workspace)
}
pub fn specifications(
    physical: &[Channel],
    derived: &BTreeSet<String>,
) -> io::Result<Vec<Specification>> {
    let mut result = DEFINITIONS.iter().map(declared).collect::<Vec<_>>();
    result.extend([projection(physical, derived), forcing()?]);
    Ok(result)
}

pub fn register(
    registry: &mut Registry,
    operations: &Operations,
    publication: &Publication,
) -> io::Result<()> {
    for definition in DEFINITIONS {
        registry.register(Process::unit(
            declared(definition),
            definition.1(operations).clone(),
        ))?;
    }
    registry.register(Process::unit(
        projection(&publication.physical, &publication.derived),
        operations.project.clone(),
    ))?;
    registry.register(Process::command(
        forcing()?,
        operations.forcing.clone(),
        |input| input.flag("includeStandalone").map_err(Into::into),
    ))?;
    Ok(())
}
fn projection(physical: &[Channel], derived: &BTreeSet<String>) -> Specification {
    let has = |name| physical.iter().any(|channel| channel.name == name);
    let mut outputs = Vec::new();
    if has("Elevation") {
        outputs.push("Elevation");
    }
    if ["BedrockElevation", "RockResistance", "SedimentThickness"]
        .into_iter()
        .all(has)
    {
        outputs.push("geology");
    }
    if has("FractureConductance") {
        outputs.push("FractureConductance");
    }
    if has("FlowAccumulation") || derived.contains("FlowAccumulation") {
        outputs.push("FlowAccumulation");
    }
    Specification::new(
        "atlas.project",
        "atlas:workspace",
        &outputs.join(" "),
        false,
    )
}
fn forcing() -> io::Result<Specification> {
    let mut forcing = Specification::new("atlas.forcing", "atlas:workspace", "", true);
    forcing.parameters = serde_json::from_value(
        serde_json::json!({"includeStandalone": {"type":"boolean","unit":null,"required":false,"default":true}}),
    )?;
    Ok(forcing)
}
