//! Domain layer vocabulary shared by new maps and generation publication.
use super::catalogue::Layer;
use crate::atlas::resolution::Profile;
// hpc-exempt: GIS layer declarations keyed by identity, never numerical cell storage.
use std::collections::BTreeMap;

type Entry = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);
const VOCABULARY: &[Entry] = &[
    (
        "elevation",
        "Elevation",
        "physical",
        "field",
        "#aaa183",
        "physical",
    ),
    (
        "geology",
        "Geology and landforms",
        "physical",
        "field",
        "#998477",
        "physical",
    ),
    (
        "ecology",
        "Biomes and life",
        "physical",
        "field",
        "#588860",
        "physical",
    ),
    (
        "faults",
        "Fault traces",
        "physical",
        "vector",
        "#998477",
        "physical",
    ),
    (
        "climate", "Climate", "water", "field", "#80a89b", "physical",
    ),
    (
        "rivers", "Rivers", "water", "network", "#71c4de", "physical",
    ),
    ("lakes", "Lakes", "water", "vector", "#67aabe", "physical"),
    (
        "oceans",
        "Oceans and seas",
        "water",
        "vector",
        "#397d99",
        "physical",
    ),
    (
        "magic",
        "Magical influences",
        "magic",
        "field",
        "#c199ee",
        "magic",
    ),
    (
        "roads",
        "Roads and routes",
        "transport",
        "network",
        "#d9b779",
        "built",
    ),
    (
        "settlements",
        "Settlements",
        "built",
        "vector",
        "#f2dab0",
        "built",
    ),
    (
        "ruins",
        "Ruins and abandoned settlements",
        "built",
        "vector",
        "#8e806a",
        "built",
    ),
    (
        "waterworks",
        "Dams and irrigation",
        "built",
        "vector",
        "#438f9e",
        "built",
    ),
    (
        "transportSites",
        "Harbors and mountain passes",
        "transport",
        "vector",
        "#ac8553",
        "built",
    ),
    (
        "landUse",
        "Clearance, hunting and conservation",
        "built",
        "vector",
        "#718d51",
        "built",
    ),
    (
        "magicPractices",
        "Magical practice sites",
        "built",
        "vector",
        "#9b76b5",
        "built",
    ),
    (
        "institutions",
        "Institutions",
        "cultural",
        "vector",
        "#be9562",
        "cultural",
    ),
    (
        "historicalEvents",
        "Societal events and disasters",
        "built",
        "vector",
        "#b56e60",
        "built",
    ),
    (
        "structures",
        "Structures and spaces",
        "built",
        "vector",
        "#d7b98f",
        "built",
    ),
    (
        "plots",
        "Plots and fields",
        "built",
        "vector",
        "#c8c27a",
        "",
    ),
    (
        "objects",
        "Objects and clutter",
        "physical",
        "vector",
        "#8f7f6a",
        "",
    ),
    ("hexes", "Hex grid", "custom", "vector", "#5b5b5b", ""),
    (
        "caves",
        "Caves and passages",
        "physical",
        "vector",
        "#7a6a58",
        "",
    ),
    (
        "caveEntrances",
        "Cave entrances",
        "physical",
        "vector",
        "#3b2f25",
        "",
    ),
    (
        "caveHexes",
        "Cave hex grid",
        "custom",
        "vector",
        "#5b5b5b",
        "",
    ),
    (
        "caveWalls",
        "Cave walls",
        "physical",
        "vector",
        "#4a3c30",
        "",
    ),
    (
        "sovereignty",
        "Sovereignty",
        "political",
        "vector",
        "#d49f79",
        "political",
    ),
    (
        "administration",
        "Administration",
        "political",
        "vector",
        "#b9a46d",
        "political",
    ),
    (
        "claims",
        "Territorial claims",
        "political",
        "vector",
        "#d8b36c",
        "political",
    ),
    (
        "control",
        "Effective control",
        "political",
        "vector",
        "#ac7f97",
        "political",
    ),
    (
        "cultures",
        "Cultural prevalence",
        "cultural",
        "field",
        "#87b7a0",
        "cultural",
    ),
    (
        "languages",
        "Languages",
        "cultural",
        "field",
        "#9aa7d4",
        "cultural",
    ),
    (
        "religions",
        "Religions and traditions",
        "cultural",
        "field",
        "#bc9bc7",
        "cultural",
    ),
    (
        "pois",
        "Places of interest",
        "custom",
        "vector",
        "#f0cc7c",
        "",
    ),
];
/// Layers that exist only where things are their real size (ADR 0016).
const REAL_SCALE_ONLY: &[&str] = &[
    "plots",
    "objects",
    "hexes",
    "caves",
    "caveEntrances",
    "caveHexes",
    "caveWalls",
];
/// Layers published in the ground map's underground space rather than on its surface.
const UNDERGROUND: &[&str] = &["caves", "caveHexes", "caveWalls"];
pub fn underground(layer_id: &str) -> bool {
    UNDERGROUND.contains(&layer_id.strip_prefix("vector:").unwrap_or(layer_id))
}

/// City squares and commons occupy the plots layer on the City's regional storage profile.
// hpc-exempt: GIS layer declarations are keyed by catalogue identity.
pub fn city_plots(layers: &mut BTreeMap<String, Layer>) {
    if let Some(plots) = layers.get_mut("plots") {
        if !plots.profiles.contains(&Profile::Region) {
            plots.profiles.push(Profile::Region);
        }
    }
}
// hpc-exempt: the map layer catalogue is sparse metadata keyed by layer identity.
pub fn builtin() -> BTreeMap<String, Layer> {
    VOCABULARY
        .iter()
        .map(|&(id, name, family, representation, color, generator)| {
            let mut representations = vec![representation.into()];
            if representation != "vector" {
                representations.push("vector".into());
            }
            (
                id.into(),
                Layer {
                    id: id.into(),
                    name: name.into(),
                    family: family.into(),
                    color: color.into(),
                    representation: representation.into(),
                    representations: Some(representations),
                    profiles: if REAL_SCALE_ONLY.contains(&id) {
                        vec![Profile::Local, Profile::Site, Profile::Interior]
                    } else {
                        vec![
                            Profile::World,
                            Profile::Region,
                            Profile::Local,
                            Profile::Site,
                            Profile::Interior,
                        ]
                    },
                    generator: (!generator.is_empty()).then(|| generator.into()),
                    facts: Some(facts(id).iter().map(|s| (*s).into()).collect()),
                    // hpc-exempt: named GIS attribute declarations for this layer.
                    schema: BTreeMap::new(),
                },
            )
        })
        .collect()
}
// hpc-exempt: publication adds presentation declarations to the named layer catalogue.
pub fn publication() -> BTreeMap<String, Layer> {
    let mut layers = builtin();
    layers
        .get_mut("rivers")
        .unwrap()
        .representations
        .as_mut()
        .unwrap()
        .push("field".into());
    let mut population = layers["cultures"].clone();
    population.id = "population".into();
    population.name = "Population and livelihoods".into();
    population.facts = Some(vec![
        "populationDensity".into(),
        "populationCapacity".into(),
    ]);
    layers.insert(population.id.clone(), population);
    layers
}
fn facts(id: &str) -> Vec<&str> {
    match id {
        "elevation" => vec!["Elevation", "relief"],
        "geology" => vec![
            "geology",
            "hardness",
            "FractureConductance",
            "lithology",
            "uplift",
        ],
        "ecology" => vec![
            "ecology",
            "BiomeCodes",
            "TreeCover",
            "GrassCover",
            "WetlandCover",
            "Productivity",
            "Herbivores",
            "Predators",
            "AquaticFauna",
        ],
        "climate" => vec![
            "climate",
            "Temperature",
            "Precipitation",
            "Moisture",
            "WindX",
            "WindY",
            "WindSpeed",
        ],
        "rivers" => vec!["rivers", "FlowAccumulation"],
        _ => vec![id],
    }
}
