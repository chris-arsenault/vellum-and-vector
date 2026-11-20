//! Declared geographic products, paired with the processes that own them.
use super::channels::Inputs;

pub struct Binding {
    pub layer: &'static str,
    pub kinds: Vec<String>,
    pub network: bool,
    pub publish: bool,
}
type Group = (&'static str, &'static str, &'static [&'static str], bool);
const GROUPS: &[Group] = &[
    ("physical.impacts", "geology", &["crater"], false),
    (
        "physical.volcanism",
        "geology",
        &["volcano", "caldera"],
        false,
    ),
    ("physical.landmarks", "geology", &["landmark"], false),
    ("physical.landmarks", "magic", &["landmark"], false),
    ("physical.fractures", "faults", &["fault"], false),
    ("water.routing", "lakes", &["lake", "pool"], false),
    ("ocean.geography", "oceans", &["ocean"], false),
    (
        "physical.landforms",
        "geology",
        &[
            "peak",
            "range",
            "valley",
            "cirque",
            "fjord",
            "moraine",
            "waterfall",
            "gorge",
            "pass",
            "ridge",
            "escarpment",
            "plateau",
            "dome",
            "spring",
            "riverMouth",
            "headland",
            "bay",
            "strait",
            "placer",
            "saltPan",
            "killingGround",
            "outcrop",
            "cliff",
        ],
        false,
    ),
    // Caves open in a real-scale map's own rock beside its other landforms (ADR 0016).
    (
        "physical.landforms",
        "caves",
        &[
            "cave",
            "dissolvedPassage",
            "fissure",
            "lavaTube",
            "thermalPassage",
            "chamber",
            "shaft",
        ],
        false,
    ),
    (
        "physical.landforms",
        "caveEntrances",
        &["caveMouth", "sinkhole", "skylight"],
        false,
    ),
    ("physical.river-networks", "rivers", &["river"], true),
    (
        "ecology.living",
        "ecology",
        &[
            "ember",
            "thaw",
            "rime",
            "glow",
            "fog",
            "deepwood",
            "wending",
            "well",
            "barrow",
            "pan",
            "flat",
            "wetland",
            "forest",
            "grassland",
            "barren",
        ],
        false,
    ),
    ("human.cultures", "cultures", &["culturalOrigin"], false),
    ("human.cultures", "institutions", &["institution"], false),
    (
        "human.politics",
        "sovereignty",
        &["sovereignty", "politicalRegion"],
        false,
    ),
    ("human.politics", "control", &["control"], false),
    ("human.politics", "administration", &["jurisdiction"], false),
    ("human.politics", "claims", &["claim"], false),
    (
        "built.layout",
        "settlements",
        // A city map's hot-spot places, districts and major works (ADR 0018).
        &["settlement", "ward", "cityPlace", "district", "majorWork"],
        false,
    ),
    ("built.layout", "ruins", &["settlement"], false),
    (
        "built.layout",
        "waterworks",
        &["dam", "irrigation", "mill", "weir"],
        false,
    ),
    (
        "built.layout",
        "transportSites",
        &["pass", "harbor", "ford", "bridge"],
        false,
    ),
    (
        "built.layout",
        "landUse",
        // A city map's blocks are its land use; plots exist only at real scale (ADR 0016).
        &[
            "clearance",
            "hunting",
            "conservation",
            "burning",
            "mine",
            "cityBlock",
        ],
        false,
    ),
    (
        "built.layout",
        "magicPractices",
        &[
            "fire-forge",
            "aurora-archive",
            "pressure-diving",
            "shrine",
            "tapping",
            "quarrying",
            "hearthRing",
            "readIce",
            "heldShore",
            "boundWood",
            "swornGround",
            "vowedGround",
        ],
        false,
    ),
    ("built.layout", "historicalEvents", &["societyEvent"], false),
    (
        "built.layout",
        "roads",
        &["road", "lane", "street", "footpath"],
        true,
    ),
    // A city map's thoroughfares are lines of their own, not a routed network (ADR 0018).
    ("built.layout", "roads", &["trail", "thoroughfare"], false),
    ("built.layout", "objects", &["fountain", "statue"], false),
    (
        "ecology.living",
        "objects",
        &["tree", "shrub", "boulder", "reeds"],
        false,
    ),
    (
        "built.layout",
        "structures",
        &[
            "building",
            "majorWork",
            "settlementCrossing",
            "room",
            "door",
            "furniture",
            "wall",
            "bridge",
            "gate",
            "cityWall",
            "cityGate",
        ],
        false,
    ),
    ("built.layout", "plots", &["field", "yard", "square"], false),
];
pub fn bindings(input: &Inputs<'_>, inherited_layers: &[String]) -> Vec<Binding> {
    let humans = ["human.cultures", "human.politics", "built.layout"]
        .iter()
        .any(|id| input.enabled(id));
    let mut result: Vec<_> = GROUPS
        .iter()
        .map(|&(owner, layer, kinds, network)| Binding {
            layer,
            kinds: kinds.iter().map(|s| (*s).into()).collect(),
            network,
            publish: input.enabled(owner)
                || (humans
                    && ["rivers", "lakes", "ecology"].contains(&layer)
                    && inherited_layers
                        .iter()
                        .any(|id| id == layer || (layer == "lakes" && id == "rivers"))),
        })
        .collect();
    result.push(Binding {
        layer: "magic",
        network: false,
        publish: input.enabled("magic.configured"),
        kinds: input
            .systems
            .iter()
            .flat_map(|system| {
                system
                    .features
                    .iter()
                    .map(|rule| format!("{}:{}", system.id, rule.id))
            })
            .chain(
                input
                    .confluences
                    .iter()
                    .map(|c| format!("confluence:{}", c.id)),
            )
            .collect(),
    });
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atlas::features::{Selected, Selection};
    // hpc-exempt: publication test channel-name metadata, not numerical field state.
    use std::collections::BTreeSet;

    #[test]
    fn real_scale_products_have_publication_bindings() {
        let selection = [
            "water.routing",
            "physical.landforms",
            "built.layout",
            "ecology.living",
        ]
        .into_iter()
        .map(|id| {
            (
                id.into(),
                Selected {
                    enabled: true,
                    ..Default::default()
                },
            )
        })
        .collect::<Selection>();
        let input = Inputs {
            selection: &selection,
            systems: &[],
            confluences: &[],
            sources: &[],
            // hpc-exempt: publication test channel-name metadata, not numerical field state.
            inherited: &BTreeSet::new(),
        };
        let bindings = bindings(&input, &[]);
        assert!(bindings.iter().any(|b| b.layer == "roads"
            && b.publish
            && b.network
            && b.kinds.iter().any(|k| k == "footpath")));
        for (layer, kind) in [
            ("lakes", "pool"),
            ("geology", "outcrop"),
            ("geology", "cliff"),
            ("roads", "trail"),
            ("objects", "tree"),
            ("objects", "shrub"),
            ("objects", "boulder"),
            ("objects", "reeds"),
            ("objects", "fountain"),
            ("objects", "statue"),
        ] {
            let product = bindings
                .iter()
                .find(|binding| binding.layer == layer && binding.kinds.iter().any(|k| k == kind))
                .unwrap_or_else(|| panic!("Missing publication binding for {kind} on {layer}"));
            assert!(product.publish);
            assert!(!product.network);
        }
    }
}
