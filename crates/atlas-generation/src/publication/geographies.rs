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
    ("water.routing", "lakes", &["lake"], false),
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
        ],
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
    ("built.layout", "settlements", &["settlement"], false),
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
        &["clearance", "hunting", "conservation", "burning", "mine"],
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
    ("built.layout", "roads", &["road", "lane"], true),
    (
        "built.layout",
        "structures",
        &["building", "room", "door", "furniture", "wall"],
        false,
    ),
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
