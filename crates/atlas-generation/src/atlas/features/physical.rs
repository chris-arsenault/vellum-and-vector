use super::{operations, Context, Feature, Policy};
use std::rc::Rc;

#[derive(Clone, Copy)]
enum Operation {
    Native(&'static str),
    Map(&'static str),
}
use Operation::{Map as m, Native as n};
type Slots = Vec<(&'static str, Vec<Operation>)>;
enum Regional {
    Shared,
    Captured,
    Specialized(Slots),
}
type Predicate = fn(&str, &Context<'_>) -> bool;
// Arconis: docs/architecture/subsystems.arconis#item=rg_disp — each feature chooses its regional handling: shared, captured or specialized.
fn feature(id: &'static str, slots: Slots, regional: Regional) -> Feature {
    let alternatives = match &regional {
        Regional::Specialized(slots) => slots.as_slice(),
        _ => &[],
    };
    let mut names = Vec::new();
    let mut native = Vec::new();
    let mut processes = Vec::new();
    for (slot, entries) in slots.iter().chain(alternatives) {
        if !names.contains(slot) {
            names.push(*slot);
        }
        for entry in entries {
            let process = match entry {
                Operation::Native(name) => {
                    if !native.contains(name) {
                        native.push(*name);
                    }
                    format!("atlas.{name}")
                }
                Operation::Map(name) => name.to_string(),
            };
            if !processes.contains(&process) {
                processes.push(process);
            }
        }
    }
    Feature {
        id,
        domains: &["physical"],
        requires: &[],
        absent: &[],
        parameters: &[],
        controls: &[],
        processes,
        native,
        slots: names,
        contribute: Rc::new(move |slot, context| {
            if context.policy == Policy::Regional && matches!(regional, Regional::Captured) {
                return Vec::new();
            }
            let selected = if context.policy == Policy::Regional {
                match &regional {
                    Regional::Specialized(slots) => slots.iter().find(|(name, _)| *name == slot),
                    _ => None,
                }
            } else {
                None
            };
            let Some((_, entries)) =
                selected.or_else(|| slots.iter().find(|(name, _)| *name == slot))
            else {
                return Vec::new();
            };
            entries
                .iter()
                .flat_map(|entry| match entry {
                    Operation::Native(name) => operations(&[&format!("atlas.{name}")]),
                    Operation::Map(name) => operations(&[name]),
                })
                .collect()
        }),
    }
}
impl Feature {
    fn requires(mut self, required: &'static [&'static str]) -> Self {
        self.requires = required;
        self
    }
    fn absent(mut self, absent: &'static [&'static str]) -> Self {
        self.absent = absent;
        self
    }
    fn parameters(mut self, parameters: &'static [&'static str]) -> Self {
        self.parameters = parameters;
        self
    }
    fn when(mut self, predicate: Predicate) -> Self {
        let contribution = self.contribute;
        self.contribute = Rc::new(move |slot, context| {
            if predicate(slot, context) {
                contribution(slot, context)
            } else {
                Vec::new()
            }
        });
        self
    }
}
pub(super) fn features() -> Vec<Feature> {
    use Regional::{Captured, Shared, Specialized};
    vec![
        feature(
            "physical.foundation",
            vec![
                (
                    "formation.foundation",
                    vec![
                        n("tectonic-provinces"),
                        n("continental-sutures"),
                        n("tectonic-margins"),
                        n("continental-domains"),
                        n("tectonic-uplift"),
                        n("landscape-initialization"),
                    ],
                ),
                ("epoch.crust.provinces", vec![n("tectonic-provinces")]),
                (
                    "epoch.crust.structure",
                    vec![
                        n("tectonic-margins"),
                        n("continental-domains"),
                        n("tectonic-uplift"),
                    ],
                ),
                ("epoch.mountains", vec![n("continental-sutures")]),
            ],
            Captured,
        )
        .requires(&["physical.lifecycle"])
        .parameters(&[
            "continents",
            "oceanicPlates",
            "provinces",
            "continentalCrustFraction",
            "landFraction",
            "mapBoundary",
        ])
        .when(|slot, context| {
            !slot.starts_with("epoch.crust.") || context.enabled("physical.tectonic-history")
        }),
        feature(
            "physical.tectonic-history",
            vec![
                ("epoch.advection", vec![n("plate-advection")]),
                ("epoch.crust.activity", vec![n("tectonic-epoch-activity")]),
            ],
            Captured,
        )
        .requires(&["physical.foundation"])
        .parameters(&["plateDrift"]),
        feature(
            "physical.mountains",
            vec![
                ("formation.mountains", vec![n("orogenic-construction")]),
                ("epoch.mountains", vec![n("orogenic-construction")]),
                ("terrain.refinement", vec![m("atlas.refine-relief")]),
            ],
            Captured,
        )
        .requires(&["physical.foundation"])
        .absent(&["OrogenicConstruction"])
        .when(|slot, context| slot != "terrain.refinement" || context.refinement),
        feature(
            "physical.volcanism",
            vec![
                (
                    "formation.volcanism",
                    vec![n("mantle-plume-roots"), n("volcanic-construction")],
                ),
                ("epoch.volcanism", vec![n("volcanic-construction")]),
            ],
            Captured,
        )
        .requires(&["physical.foundation"])
        .parameters(&["volcanism"])
        .absent(&["MantlePlumeRoots", "VolcanicConstruction"]),
        feature(
            "physical.impacts",
            vec![
                ("formation.impacts", vec![n("impact-cratering")]),
                ("epoch.impacts", vec![n("impact-cratering")]),
            ],
            Captured,
        )
        .requires(&["physical.foundation"])
        .parameters(&["impacts", "impactSize"])
        .absent(&["Impacts"]),
        feature(
            "physical.landmarks",
            vec![
                ("epoch.landmarks", vec![m("landmark.emplace")]),
                ("epoch.landmark-maintenance", vec![m("landmark.maintain")]),
            ],
            Shared,
        )
        .requires(&["physical.foundation"])
        .parameters(&["landscapeLandmarks", "magicLandmarks"])
        .when(|_, context| context.landmarks_apply),
        feature(
            "physical.hillslopes",
            vec![
                ("material.hillslopes", vec![n("mass-wasting")]),
                (
                    "epoch.after-incision.hillslopes",
                    vec![n("post-fluvial-mass-wasting")],
                ),
            ],
            Shared,
        )
        .requires(&["physical.foundation"])
        .when(|slot, context| {
            slot != "epoch.after-incision.hillslopes" || context.enabled("physical.river-incision")
        }),
        feature(
            "material.load-response",
            vec![
                ("material.relaxation", vec![n("crustal-relaxation")]),
                (
                    "material.support.before-margins",
                    vec![n("crustal-support"), n("lithospheric-flexure")],
                ),
                (
                    "material.support.after-margins",
                    vec![n("crustal-support"), n("lithospheric-flexure")],
                ),
                (
                    "epoch.ice-load",
                    vec![n("crustal-support"), n("lithospheric-flexure")],
                ),
            ],
            Shared,
        )
        .requires(&["physical.foundation"]),
        feature(
            "physical.continental-margins",
            vec![(
                "material.margins",
                vec![n("continental-margin-evolution"), n("marine-sedimentation")],
            )],
            Shared,
        )
        .requires(&[
            "physical.foundation",
            "ocean.geography",
            "material.load-response",
        ]),
        feature(
            "physical.coastal-construction",
            vec![("formation.coastal-construction", vec![n("coastal-detail")])],
            Captured,
        )
        .requires(&["physical.foundation"]),
        feature(
            "physical.fractures",
            vec![("geology.fractures", vec![n("fracture-network")])],
            Captured,
        )
        .requires(&["physical.foundation"])
        .absent(&["Fractures"]),
        feature(
            "physical.geothermal",
            vec![("geology.geothermal", vec![n("geothermal")])],
            Captured,
        )
        .requires(&["physical.foundation"])
        .absent(&["Geothermal"]),
        feature(
            "ocean.geography",
            vec![
                (
                    "material.ocean.before-margins",
                    vec![n("ocean-connectivity")],
                ),
                (
                    "material.ocean.after-margins",
                    vec![n("ocean-connectivity")],
                ),
                ("formation.ocean.final", vec![n("ocean-connectivity")]),
                (
                    "climate.ocean",
                    vec![
                        n("ocean-connectivity"),
                        n("ocean-distance"),
                        n("bathymetry"),
                        n("landmasses-and-shelf-groups"),
                    ],
                ),
            ],
            Specialized(vec![(
                "climate.ocean",
                vec![
                    m("refinement.ocean"),
                    m("refinement.ocean-memory"),
                    n("ocean-distance"),
                    n("bathymetry"),
                    n("landmasses-and-shelf-groups"),
                ],
            )]),
        )
        .requires(&["physical.foundation"]),
        feature(
            "physical.ocean-circulation",
            vec![(
                "climate.circulation",
                vec![n("ocean-currents"), n("warmth-sources")],
            )],
            Shared,
        )
        .requires(&["ocean.geography"])
        .absent(&["OceanCurrents", "Warmth"]),
        feature(
            "physical.climate",
            vec![("climate.atmosphere", vec![n("atmospheric-climate")])],
            Specialized(vec![("climate.atmosphere", vec![m("refinement.climate")])]),
        )
        .requires(&["ocean.geography"])
        .parameters(&[
            "temperature",
            "rainfall",
            "seaLevel",
            "southLatitude",
            "northLatitude",
            "latitudeProjection",
        ]),
        feature(
            "water.routing",
            vec![
                ("water.runoff", vec![n("runoff")]),
                (
                    "water.routing",
                    vec![
                        n("drainage-conditioning"),
                        n("lake-basins"),
                        n("drainage-guidance"),
                        n("flow-routing"),
                        n("river-network"),
                    ],
                ),
                ("water.current", vec![n("current-water")]),
                ("water.initialize", vec![n("river-network")]),
                ("water.groundwater", vec![n("groundwater")]),
            ],
            Specialized(vec![
                ("water.routing", vec![m("refinement.water-evolution")]),
                ("water.current", vec![m("refinement.water")]),
                ("water.initialize", vec![m("refinement.water-initialize")]),
            ]),
        )
        .requires(&["physical.climate", "ocean.geography"]),
        feature(
            "physical.river-incision",
            vec![("epoch.incision", vec![n("ancestral-fluvial-erosion")])],
            Shared,
        )
        .requires(&["water.routing", "material.fluvial-transport"])
        .parameters(&["erosion"]),
        feature(
            "material.fluvial-transport",
            vec![("epoch.sediment", vec![n("sediment-transport")])],
            Shared,
        )
        .requires(&["water.routing", "ocean.geography"])
        .absent(&["SedimentTransport"]),
        feature(
            "physical.land-ice",
            vec![
                ("ice.model", vec![n("land-ice-mass-balance"), n("ice-flow")]),
                ("ice.flow", vec![n("ice-flow")]),
                ("ice.meltwater", vec![n("glacial-meltwater")]),
            ],
            Shared,
        )
        .requires(&[
            "physical.climate",
            "water.routing",
            "material.load-response",
        ])
        .absent(&["LandIce", "IceFlow", "GlacialMeltwater"]),
        feature(
            "physical.glacial-sculpting",
            vec![
                (
                    "epoch.sculpting",
                    vec![n("glacial-erosion"), n("glacial-deposition")],
                ),
                ("present.glacial-landforms", vec![n("glacial-landforms")]),
            ],
            Shared,
        )
        .requires(&["physical.land-ice"])
        .parameters(&["glaciers"])
        .absent(&["GlacialEvolution", "GlacialRelief"]),
        feature(
            "physical.sea-ice",
            vec![
                ("ice.model", vec![n("sea-ice")]),
                ("present.sea-ice", vec![n("sea-ice")]),
            ],
            Shared,
        )
        .requires(&["physical.climate", "ocean.geography"])
        .absent(&["SeaIce"]),
        feature(
            "physical.coastal-evolution",
            vec![(
                "epoch.coasts",
                vec![
                    n("external-coastal-forcing"),
                    n("coastal-erosion-and-deposition"),
                ],
            )],
            Shared,
        )
        .requires(&["ocean.geography", "material.fluvial-transport"])
        .parameters(&["coastalErosion"])
        .absent(&["CoastalEvolution"]),
        feature(
            "physical.river-networks",
            vec![("present.river-geometry", vec![n("river-channel-geometry")])],
            Shared,
        )
        .requires(&["water.routing"])
        .absent(&["RiverGeometry"]),
        feature(
            "physical.floodplains",
            vec![("present.floodplains", vec![n("river-floodplains")])],
            Shared,
        )
        .requires(&["physical.river-networks"])
        .absent(&["Floodplains"]),
        feature(
            "physical.deltas",
            vec![("present.deltas", vec![n("river-delta-formation")])],
            Shared,
        )
        .requires(&["physical.floodplains", "material.fluvial-transport"])
        .absent(&["Deltas"]),
        feature(
            "physical.landforms",
            vec![("present.landforms", vec![n("landform-classification")])],
            Specialized(vec![("present.landforms", vec![m("refinement.landforms")])]),
        )
        .requires(&["water.routing", "ocean.geography"])
        .absent(&["Landforms"]),
        feature(
            "physical.lifecycle",
            vec![
                (
                    "epoch.history",
                    vec![
                        n("lithification"),
                        n("rock-metamorphism"),
                        n("physical-epoch-history"),
                    ],
                ),
                (
                    "present.validation",
                    vec![n("physical-structural-validation")],
                ),
            ],
            Captured,
        ),
    ]
}
