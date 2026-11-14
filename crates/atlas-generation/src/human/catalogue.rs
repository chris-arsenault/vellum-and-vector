//! A mode acts through layer facts; callers do not branch on layer kinds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum LayerId {
    Population,
    Farmland,
    Pasture,
    BuiltUp,
    Standing,
}
impl LayerId {
    pub const ALL: [Self; 5] = [
        Self::Population,
        Self::Farmland,
        Self::Pasture,
        Self::BuiltUp,
        Self::Standing,
    ];
}
#[derive(Clone, Copy)]
#[repr(usize)]
pub enum LayerMode {
    Drown,
    Scour,
    Shake,
    Burn,
    Neglect,
    Starve,
    Fallow,
}
pub struct LayerFacts {
    pub area: bool,
    pub yields: [f64; 7],
    pub remains: Option<usize>,
    pub left: [f64; 7],
    pub standing_holds: f64,
    pub carries_identity: bool,
    pub records_ground: bool,
}
const RUIN: [f64; 7] = [1.0, 0.2, 0.9, 0.7, 1.0, 0.0, 0.0];
pub const PEOPLE: LayerId = LayerId::Population;
pub const BUILT: LayerId = LayerId::BuiltUp;
pub const WORKS: LayerId = LayerId::Standing;
pub const WAY_MEMORY_YEARS: f64 = 150.0;
pub const FULL_STANDING_PER_BUILT_KM2: f64 = 2_000_000.0;
const FACTS: [LayerFacts; 5] = [
    LayerFacts {
        area: false,
        yields: [1.0, 1.0, 0.3, 0.6, 0.0, 1.0, 0.0],
        remains: None,
        left: [0.0; 7],
        standing_holds: 0.5,
        carries_identity: true,
        records_ground: true,
    },
    LayerFacts {
        area: true,
        yields: [1.0, 0.8, 0.0, 0.5, 0.0, 0.0, 0.6],
        remains: None,
        left: [0.0; 7],
        standing_holds: 0.0,
        carries_identity: false,
        records_ground: false,
    },
    LayerFacts {
        area: true,
        yields: [1.0, 0.5, 0.0, 0.3, 0.0, 0.0, 0.3],
        remains: None,
        left: [0.0; 7],
        standing_holds: 0.0,
        carries_identity: false,
        records_ground: false,
    },
    LayerFacts {
        area: true,
        yields: [0.6, 0.8, 0.7, 0.6, 0.25, 0.0, 0.0],
        remains: Some(0),
        left: RUIN,
        standing_holds: 1.0,
        carries_identity: false,
        records_ground: false,
    },
    LayerFacts {
        area: false,
        yields: [0.6, 0.8, 0.5, 0.5, 0.25, 0.0, 0.0],
        remains: Some(1),
        left: RUIN,
        standing_holds: 1.0,
        carries_identity: false,
        records_ground: false,
    },
];
pub fn facts(kind: LayerId) -> &'static LayerFacts {
    &FACTS[kind as usize]
}
pub struct CompiledLayerMix {
    pub(super) yields: [f64; 5],
    pub(super) left: [f64; 5],
}
pub fn compile(mix: [f64; 7]) -> CompiledLayerMix {
    let mut result = CompiledLayerMix {
        yields: [0.0; 5],
        left: [0.0; 5],
    };
    for kind in LayerId::ALL {
        let index = kind as usize;
        let facts = facts(kind);
        for (mode, weight) in mix.iter().enumerate() {
            let taken = weight * facts.yields[mode];
            result.yields[index] += taken;
            result.left[index] += taken * facts.left[mode];
        }
        result.left[index] = if result.yields[index] > 0.0 {
            result.left[index] / result.yields[index]
        } else {
            0.0
        };
    }
    result
}
