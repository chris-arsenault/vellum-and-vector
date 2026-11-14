//! Material facts from rock/rockCatalogue.ts; processes choose actions, never these facts.
use super::{material::MaterialLayer, MaterialFacts};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RockFamily {
    Sedimentary,
    Igneous,
    Metamorphic,
    Broken,
    Loose,
    Ice,
}
pub struct RockKind {
    pub id: &'static str,
    pub code: usize,
    pub name: &'static str,
    pub family: RockFamily,
    pub under_heat: Option<usize>,
    pub facts: MaterialFacts,
}
use RockFamily::{Broken, Ice, Igneous, Loose, Metamorphic, Sedimentary};

// Each row is code, identity, family, heat product, resistance, jointing, bedding,
// solubility and porosity. Codes are persisted material identities, not array ordering policy.
macro_rules! kind {
    ($code:expr,$id:expr,$name:expr,$family:expr,$heat:expr,$r:expr,$j:expr,$b:expr,$s:expr,$p:expr) => {
        RockKind {
            code: $code,
            id: $id,
            name: $name,
            family: $family,
            under_heat: $heat,
            facts: MaterialFacts {
                resistance: $r,
                jointing: $j,
                bedding: $b,
                solubility: $s,
                porosity: $p,
                gives: [None; 4],
            },
        }
    };
}
pub const STRATA: usize = 0;
pub const SHALE: usize = 1;
pub const SANDSTONE: usize = 2;
pub const LIMESTONE: usize = 3;
pub const SALT_BED: usize = 4;
pub const GNEISS: usize = 9;
pub const GRANITE: usize = 10;
pub const BASALT: usize = 11;
pub const IMPACTITE: usize = 13;
pub const ALLUVIUM: usize = 25;
pub const SOIL: usize = 26;
pub const GLACIER_ICE: usize = 27;
pub const KIND_COUNT: usize = 28;
pub const BASELINE_ROCK: f64 = 1000.0;
pub const SOFTEST_ROCK: f64 = 250.0;
pub const HARDEST_ROCK: f64 = 4000.0;
pub const PERMEABLE_FROM: f64 = 0.3;

pub static CATALOGUE: [RockKind; KIND_COUNT] = [
    kind!(
        0,
        "strata",
        "Bedded strata",
        Sedimentary,
        Some(6),
        1000.0,
        0.3,
        0.8,
        0.3,
        0.5
    ),
    kind!(
        1,
        "shale",
        "Shale",
        Sedimentary,
        Some(5),
        600.0,
        0.3,
        0.9,
        0.05,
        0.2
    ),
    kind!(
        2,
        "sandstone",
        "Sandstone",
        Sedimentary,
        Some(8),
        1100.0,
        0.4,
        0.8,
        0.05,
        0.6
    ),
    kind!(
        3,
        "limestone",
        "Limestone",
        Sedimentary,
        Some(7),
        1200.0,
        0.5,
        0.85,
        0.9,
        0.5
    ),
    kind!(
        4,
        "saltbed",
        "Salt bed",
        Sedimentary,
        None,
        350.0,
        0.1,
        0.9,
        1.0,
        0.1
    ),
    kind!(
        5,
        "slate",
        "Slate",
        Metamorphic,
        Some(6),
        1300.0,
        0.45,
        0.3,
        0.0,
        0.1
    ),
    kind!(
        6,
        "schist",
        "Schist",
        Metamorphic,
        Some(9),
        1500.0,
        0.5,
        0.2,
        0.05,
        0.15
    ),
    kind!(
        7,
        "marble",
        "Marble",
        Metamorphic,
        None,
        1600.0,
        0.35,
        0.1,
        0.6,
        0.1
    ),
    kind!(
        8,
        "quartzite",
        "Quartzite",
        Metamorphic,
        None,
        3500.0,
        0.35,
        0.3,
        0.0,
        0.05
    ),
    kind!(
        9,
        "gneiss",
        "Gneiss",
        Metamorphic,
        None,
        2200.0,
        0.2,
        0.05,
        0.0,
        0.1
    ),
    kind!(10, "granite", "Granite", Igneous, None, 2400.0, 0.3, 0.0, 0.0, 0.05),
    kind!(11, "basalt", "Basalt", Igneous, None, 2600.0, 0.6, 0.4, 0.0, 0.35),
    kind!(
        12,
        "tuff",
        "Tuff",
        Igneous,
        Some(6),
        800.0,
        0.5,
        0.7,
        0.05,
        0.6
    ),
    kind!(
        13,
        "impactite",
        "Impactite",
        Igneous,
        None,
        2000.0,
        0.7,
        0.0,
        0.0,
        0.2
    ),
    kind!(
        14,
        "veinrock",
        "Veinrock",
        Metamorphic,
        None,
        3200.0,
        0.25,
        0.0,
        0.0,
        0.05
    ),
    kind!(
        15,
        "sinter",
        "Sinter",
        Sedimentary,
        None,
        2800.0,
        0.15,
        0.5,
        0.0,
        0.0
    ),
    kind!(16, "corefall", "Corefall", Broken, None, 700.0, 0.6, 0.1, 0.0, 0.7),
    kind!(17, "rimerot", "Rimerot", Broken, None, 300.0, 0.9, 0.0, 0.2, 0.7),
    kind!(
        18,
        "auroraCrystal",
        "Aurora crystal",
        Igneous,
        None,
        3800.0,
        0.1,
        0.0,
        0.0,
        0.0
    ),
    kind!(
        19,
        "crushstone",
        "Crushstone",
        Broken,
        None,
        450.0,
        0.95,
        0.0,
        0.05,
        0.6
    ),
    kind!(
        20,
        "rootstone",
        "Rootstone",
        Broken,
        None,
        800.0,
        0.7,
        0.1,
        0.3,
        0.8
    ),
    kind!(
        21,
        "tufa",
        "Spring tufa",
        Sedimentary,
        None,
        700.0,
        0.4,
        0.6,
        0.7,
        0.8
    ),
    kind!(
        22,
        "saltGlass",
        "Salt glass",
        Igneous,
        None,
        3000.0,
        0.4,
        0.1,
        0.1,
        0.0
    ),
    RockKind {
        facts: MaterialFacts {
            gives: [Some(0.1), Some(0.1), Some(0.1), Some(0.0)],
            ..kind!(
                23,
                "keptStone",
                "Kept stone",
                Metamorphic,
                None,
                3000.0,
                0.1,
                0.1,
                0.0,
                0.05
            )
            .facts
        },
        ..kind!(
            23,
            "keptStone",
            "Kept stone",
            Metamorphic,
            None,
            3000.0,
            0.1,
            0.1,
            0.0,
            0.05
        )
    },
    kind!(
        24,
        "tornstone",
        "Tornstone",
        Broken,
        None,
        900.0,
        0.9,
        0.0,
        0.1,
        0.5
    ),
    kind!(25, "alluvium", "Alluvium", Loose, None, 300.0, 0.3, 0.3, 0.0, 0.5),
    kind!(26, "soil", "Soil", Loose, None, 250.0, 0.2, 0.0, 0.1, 0.6),
    RockKind {
        facts: MaterialFacts {
            gives: [Some(0.0); 4],
            ..kind!(
                27,
                "glacierIce",
                "Glacier ice",
                Ice,
                None,
                250.0,
                0.5,
                0.5,
                0.0,
                0.0
            )
            .facts
        },
        ..kind!(
            27,
            "glacierIce",
            "Glacier ice",
            Ice,
            None,
            250.0,
            0.5,
            0.5,
            0.0,
            0.0
        )
    },
];

pub fn kind_of_code(code: usize) -> &'static RockKind {
    CATALOGUE.get(code).unwrap_or(&CATALOGUE[STRATA])
}
pub fn facts() -> &'static [MaterialFacts] {
    static FACTS: std::sync::OnceLock<Vec<MaterialFacts>> = std::sync::OnceLock::new();
    FACTS.get_or_init(|| CATALOGUE.iter().map(|kind| kind.facts).collect())
}
pub fn hardness_of(resistance: f64) -> f64 {
    ((resistance - 600.0) / (2600.0 - 600.0)).clamp(0.0, 1.0)
}
pub fn material(kind: usize, depth: f64, epoch: f64) -> MaterialLayer {
    let facts = kind_of_code(kind);
    MaterialLayer::new(
        kind,
        depth,
        facts.facts.resistance,
        facts.family == Loose,
        epoch,
    )
}
pub fn compile(mix: super::ModeMix) -> super::CompiledMix {
    super::compile_mix(
        facts(),
        mix,
        BASELINE_ROCK,
        CATALOGUE[ALLUVIUM].facts.resistance,
    )
}
