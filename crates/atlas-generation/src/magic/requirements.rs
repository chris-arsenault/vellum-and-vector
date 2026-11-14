//! Inputs belong to the source, propagation and classification rules that read them.
use super::{
    configuration::{Phase, Propagation, Source, System},
    regions::independent_interaction,
};
impl Source {
    pub fn requires(self) -> &'static [&'static str] {
        match self {
            Self::Geothermal => &["field:Geothermal"],
            Self::Cold => &["field:Temperature", "field:Elevation"],
            Self::DeepOcean => &["field:WaterKindCodes", "field:BathymetricZoneCodes"],
            Self::Verdant => &["ecology"],
            Self::Aquifer => &["field:FlowTargets", "field:Elevation"],
            Self::DeadLake => &["field:LakeOutletTargets", "field:Elevation"],
            Self::Placed
            | Self::Impact
            | Self::Forge
            | Self::Death
            | Self::Tenure
            | Self::KeptLine
            | Self::Strain
            | Self::Pairing => &[],
        }
    }
}
impl Propagation {
    pub fn requires(self) -> &'static [&'static str] {
        match self {
            Self::Fracture => &["field:FractureConductance"],
            Self::ColdDrainage => &["field:Temperature", "field:IceThickness"],
            Self::OceanRays => &["field:WaterKindCodes", "field:BathymetricZoneCodes"],
            Self::Roots => &["ecology"],
            Self::Brine => &["field:FlowTargets"],
            Self::Radial | Self::Local | Self::Ward => &[],
        }
    }
}
fn condition(field: &str) -> &'static [&'static str] {
    match field {
        "elevation" | "slope" => &["field:Elevation"],
        "temperature" => &["field:Temperature"],
        "ice" => &["field:IceThickness"],
        "water" => &["field:WaterKindCodes", "field:LakeOutletTargets"],
        "moisture" => &["field:Moisture"],
        "geothermal" => &["field:Geothermal"],
        "fracture" => &["field:FractureConductance"],
        "landform" => &["field:LandformCodes"],
        "river" => &["field:RiverOrders"],
        "upwelling" => &["field:OceanCurrentX"],
        "biome" | "treeCover" | "wetlandCover" | "peatCarbon" | "oilCarbon"
        | "ecologicalToxicity" | "soilWater" | "soilDepth" | "grazers" | "browsers" => &["ecology"],
        _ => &[],
    }
}
fn environment(id: &str, systems: &[System], needs: &mut Vec<&'static str>) {
    let selected = || systems.iter().filter(|system| system.enabled);
    let phase = match id {
        "climate" => Some(Phase::Climate),
        "post-glacial" => Some(Phase::PostGlacial),
        _ => None,
    };
    if let Some(phase) = phase {
        if selected().any(|s| s.effects.heat != 0.0 || s.effects.ice_melt != 0.0) {
            needs.push("field:Temperature");
        }
        for system in selected().filter(|system| system.phase == phase) {
            for origin in &system.origins {
                needs.extend(origin.source.requires());
                needs.extend(origin.propagation.requires());
            }
        }
        if selected().any(|s| s.effects.upwelling != 0.0 || s.effects.sea_surface != 0.0) {
            needs.push("field:WaterKindCodes");
        }
    }
}
fn classification(systems: &[System], needs: &mut Vec<&'static str>) {
    for system in systems {
        for rule in system
            .features
            .iter()
            .filter(|rule| system.enabled || independent_interaction(rule, &system.id))
        {
            for test in rule
                .seeds
                .iter()
                .chain(rule.retains.iter().flatten())
                .flatten()
            {
                needs.extend(condition(&test.field));
            }
        }
    }
}
pub fn process(id: &str, systems: &[System]) -> Vec<String> {
    let mut needs = vec!["atlas:workspace"];
    if id == "initialize" {
        return needs.into_iter().map(str::to_owned).collect();
    }
    needs.push("atlas:magic-initialize");
    environment(id, systems, &mut needs);
    match id {
        "rocks" => needs.push("atlas:magic-climate"),
        "coast" => {
            needs.push("atlas:magic-post-glacial");
            if systems
                .iter()
                .any(|s| s.enabled && s.effects.coastal_forcing != 0.0)
            {
                needs.extend(["field:WaterKindCodes", "field:OceanCurrentX"]);
            }
        }
        "project" => needs.push("atlas:magic-classify"),
        "classify" => classification(systems, &mut needs),
        _ => {}
    }
    let mut unique = Vec::new();
    for need in needs {
        if !unique.iter().any(|value| value == need) {
            unique.push(need.to_owned());
        }
    }
    unique
}
