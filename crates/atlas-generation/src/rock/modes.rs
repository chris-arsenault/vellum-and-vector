//! Port of rock/modes.ts. Definitions compile once into packed per-kind responses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum ModeId {
    Abrasion,
    Plucking,
    Shear,
    Solution,
}
const MODE_COUNT: usize = 4;
#[derive(Clone, Copy, Default)]
pub struct ModeMix {
    weights: [f64; MODE_COUNT],
}
impl ModeMix {
    pub fn with(mut self, mode: ModeId, weight: f64) -> Self {
        self.weights[mode as usize] = weight;
        self
    }
}

/// Kind facts come from the owning catalogue, not from a process formula.
#[derive(Clone, Copy)]
pub struct MaterialFacts {
    pub resistance: f64,
    pub jointing: f64,
    pub bedding: f64,
    pub solubility: f64,
    pub porosity: f64,
    pub gives: [Option<f64>; MODE_COUNT],
}
struct Mode {
    openness: fn(&MaterialFacts) -> f64,
    strength_resists: bool,
    cover_holds: f64,
    fractures_weaken: f64,
    ward_holds: f64,
    fabric_response: f64,
}
const MODES: [Mode; MODE_COUNT] = [
    Mode {
        openness: |_| 1.0,
        strength_resists: true,
        cover_holds: 1.0,
        fractures_weaken: 0.5,
        ward_holds: 0.5,
        fabric_response: 0.0,
    },
    Mode {
        openness: |f| 0.5 + f.jointing / 0.6,
        strength_resists: true,
        cover_holds: 0.0,
        fractures_weaken: 1.0,
        ward_holds: 0.5,
        fabric_response: 0.5,
    },
    Mode {
        openness: |f| 0.5 + 0.5 * (f.jointing + 0.5 * f.bedding) / 0.7,
        strength_resists: true,
        cover_holds: 1.0,
        fractures_weaken: 0.5,
        ward_holds: 0.5,
        fabric_response: 1.0,
    },
    Mode {
        openness: |f| f.solubility,
        strength_resists: false,
        cover_holds: 0.0,
        fractures_weaken: 0.25,
        ward_holds: 0.5,
        fabric_response: 0.0,
    },
];
/// Scalar table access stays inside the material interaction owner.
/// ```compile_fail
/// use atlas_generation::rock::CompiledMix;
/// fn bypass(mix:CompiledMix) {mix.given_up(0,1000.0);}
/// ```
pub struct CompiledMix {
    flat: Vec<f64>,
    by_strength: Vec<f64>,
    bedding: Vec<f64>,
    baseline: f64,
    loose_strength: f64,
    pub cover_holds: f64,
    pub fractures_weaken: f64,
    pub ward_holds: f64,
    pub fabric_response: f64,
}
/// Catalogue order is its dense material code order; no second kind catalogue is kept here.
pub fn compile_mix(
    kinds: &[MaterialFacts],
    mix: ModeMix,
    baseline: f64,
    loose_strength: f64,
) -> CompiledMix {
    let mut result = CompiledMix {
        flat: vec![0.0; kinds.len()],
        by_strength: vec![0.0; kinds.len()],
        bedding: kinds.iter().map(|f| f.bedding).collect(),
        baseline,
        loose_strength,
        cover_holds: 0.0,
        fractures_weaken: 0.0,
        ward_holds: 0.0,
        fabric_response: 0.0,
    };
    for (index, mode) in MODES.iter().enumerate() {
        let share = mix.weights[index];
        result.cover_holds += share * mode.cover_holds;
        result.fractures_weaken += share * mode.fractures_weaken;
        result.ward_holds += share * mode.ward_holds;
        result.fabric_response += share * mode.fabric_response;
        for (code, kind) in kinds.iter().enumerate() {
            if let Some(stated) = kind.gives[index] {
                result.flat[code] += share * stated;
            } else if mode.strength_resists {
                result.by_strength[code] += share * (mode.openness)(kind);
            } else {
                result.flat[code] += share * (mode.openness)(kind);
            }
        }
    }
    result
}
impl CompiledMix {
    pub(super) fn given_up(&self, code: usize, strength: f64) -> f64 {
        self.flat[code] + self.by_strength[code] * self.baseline / strength.max(1.0)
    }
}
/// A detached read of the bed facts needed by this query, not persistent per-cell objects.
pub struct MaterialResponse {
    pub kind: usize,
    pub secondary_kind: usize,
    pub secondary_share: f64,
    pub strength: f64,
    pub consolidation: f64,
    pub damage: f64,
    pub grain: [f64; 2],
    pub bed_slope: [f64; 2],
}
/// The complete retained constituents answer together; no kind or system switch in a process.
pub fn material_gives(
    mix: &CompiledMix,
    layer: &MaterialResponse,
    loose: bool,
    direction: [f64; 2],
) -> f64 {
    let loose_strength = layer.strength.min(mix.loose_strength);
    let strength = if loose {
        loose_strength
    } else {
        loose_strength + (layer.strength - loose_strength) * layer.consolidation
    };
    let first = mix.given_up(layer.kind, strength);
    let second = mix.given_up(layer.secondary_kind, strength);
    let [x, y] = direction;
    let length = x * x + y * y;
    let alignment = if length > 0.0 {
        ((x * x - y * y) * layer.grain[0] + 2.0 * x * y * layer.grain[1]) / (1000.0 * length)
    } else {
        0.0
    };
    let bedding = mix.bedding[layer.kind] * (1.0 - layer.secondary_share)
        + mix.bedding[layer.secondary_kind] * layer.secondary_share;
    let dip = if length > 0.0 {
        -(layer.bed_slope[0] * x + layer.bed_slope[1] * y) / length.sqrt()
    } else {
        0.0
    };
    let release = dip / 1.0f64.hypot(dip);
    (1.0 + 0.5 * mix.fabric_response * bedding * alignment)
        * (1.0 + 0.5 * mix.fabric_response * bedding * release)
        * (first + (second - first) * layer.secondary_share)
        * (mix.fractures_weaken * layer.damage).exp()
}
