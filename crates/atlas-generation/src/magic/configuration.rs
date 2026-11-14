use super::parameters::{measure, Overrides, Parameters};
use crate::scale::MapScale;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "MagicSource")]
pub enum Source {
    Geothermal,
    Cold,
    DeepOcean,
    Placed,
    Verdant,
    Aquifer,
    Impact,
    Forge,
    Death,
    DeadLake,
    Tenure,
    KeptLine,
    Strain,
    Pairing,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "MagicPropagation")]
pub enum Propagation {
    Fracture,
    ColdDrainage,
    OceanRays,
    Radial,
    Roots,
    Local,
    Brine,
    Ward,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "MagicRenewal")]
pub enum Renewal {
    ConduitFed,
    Accumulating,
    #[default]
    Continuous,
    Finite,
    Kept,
    Emergent,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "MagicCarrier")]
pub enum Carrier {
    Crust,
    Ice,
    River,
    Groundwater,
    Wind,
    Current,
    Animal,
    People,
    Door,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "MagicPhase")]
pub enum Phase {
    Climate,
    PostGlacial,
    Society,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicStock")]
pub struct Stock {
    pub id: String,
    pub reservoir: String,
    #[serde(default)]
    pub carriers: Vec<Carrier>,
}
impl Default for Stock {
    fn default() -> Self {
        Self {
            id: "held".into(),
            reservoir: "held".into(),
            carriers: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicOrigin")]
pub struct Origin {
    pub id: String,
    pub source: Source,
    pub propagation: Propagation,
    #[serde(default)]
    pub renewal: Renewal,
    #[serde(default)]
    pub parameters: Overrides,
    #[serde(default)]
    pub stocks: Vec<Stock>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicCondition", optional_fields = nullable)]
pub struct Condition {
    pub field: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub values: Option<Vec<f64>>,
    pub salt: Option<i32>,
    pub index: Option<i32>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicCoverage")]
pub struct Coverage {
    pub field: String,
    pub floor: f64,
    pub full: f64,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "MagicCartography")]
pub enum Cartography {
    Site,
    Area,
    Course,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicFeatureRule", optional_fields = nullable)]
pub struct Feature {
    pub id: String,
    pub name: String,
    pub cartography: Option<Cartography>,
    #[serde(default = "one")]
    pub priority: f64,
    pub seeds: Vec<Vec<Condition>>,
    pub retains: Option<Vec<Vec<Condition>>>,
    pub coverage: Option<Coverage>,
}
macro_rules! effects {
    ($($name:ident: ($min:expr, $max:expr)),+ $(,)?) => {
        #[derive(Clone, Debug, Default, Serialize, Deserialize, ts_rs::TS)]
        #[serde(default, rename_all = "camelCase", deny_unknown_fields)]
        #[ts(rename = "MagicEffects")]
        pub struct Effects { $(pub $name: f64,)+ }
        impl Effects {
            fn validate(&self) -> Result<(), &'static str> {
                $(if !self.$name.is_finite() || self.$name < $min || self.$name > $max {
                    return Err(concat!("Invalid magic effect: ", stringify!($name)));
                })+
                Ok(())
            }
        }
    }
}
effects! {
    heat: (f64::NEG_INFINITY, f64::INFINITY),
    ice_melt: (f64::NEG_INFINITY, f64::INFINITY),
    rock_resistance: (f64::NEG_INFINITY, f64::INFINITY),
    coastal_forcing: (0.0, f64::INFINITY),
    quickening: (0.0, 1.0), conduit_opening: (0.0, 1000.0),
    stillness: (0.0, 1.0), ice_persistence: (0.0, 1.0),
    upwelling: (0.0, 3.0), sea_surface: (-1.0, 1.0), wake_warming: (0.0, 200.0),
    fog: (0.0, 1.0), storm: (0.0, 1.0), verdure: (0.0, 1.0), salting: (0.0, 1.0),
    warding: (0.0, 1.0), tearing: (0.0, 1.0), vegetation_growth: (-1.0, 5.0),
    fire: (0.0, 1.0), organic_preservation: (-3.0, 3.0), animal_toxicity: (0.0, 1.0),
    seed_dispersal: (-1.0, 5.0),
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicHistory")]
pub struct History {
    pub retention: f64,
    pub storage: f64,
    pub advect: bool,
}
impl Default for History {
    fn default() -> Self {
        Self {
            retention: 1.0,
            storage: 0.0,
            advect: true,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename = "MagicUnits")]
pub enum Relative {
    #[default]
    Relative,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicSystem")]
pub struct System {
    #[serde(default)]
    pub length_units: Relative,
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub origins: Vec<Origin>,
    pub phase: Phase,
    #[serde(default = "one")]
    pub strength: f64,
    #[serde(default)]
    pub parameters: Parameters,
    #[serde(default)]
    pub effects: Effects,
    #[serde(default)]
    pub history: History,
    #[serde(default)]
    pub features: Vec<Feature>,
}
fn one() -> f64 {
    1.0
}
fn yes() -> bool {
    true
}

/// Measured configuration has no deserializer and cannot re-enter the relative boundary.
#[derive(Clone, Debug)]
pub struct ResolvedSystem {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub origins: Vec<Origin>,
    pub phase: Phase,
    pub strength: f64,
    pub parameters: Parameters,
    pub effects: Effects,
    pub history: History,
    pub features: Vec<Feature>,
}
impl System {
    pub fn resolve(mut self, scale: &MapScale) -> Result<ResolvedSystem, &'static str> {
        self.validate()?;
        self.parameters.resolve(scale)?;
        for origin in &mut self.origins {
            origin.parameters.resolve(scale)?;
            if origin.stocks.is_empty() {
                origin.stocks.push(Stock::default());
            }
        }
        self.effects.ice_melt = measure(scale, self.effects.ice_melt, 1)?;
        for feature in &mut self.features {
            feature.resolve(scale)?;
        }
        Ok(ResolvedSystem {
            id: self.id,
            name: self.name.trim().into(),
            enabled: self.enabled,
            origins: self.origins,
            phase: self.phase,
            strength: self.strength,
            parameters: self.parameters,
            effects: self.effects,
            history: self.history,
            features: self.features,
        })
    }
    fn validate(&self) -> Result<(), &'static str> {
        if self.id.is_empty()
            || self.name.trim().is_empty()
            || self.origins.is_empty()
            || !self.strength.is_finite()
            || self.strength < 0.0
        {
            return Err("Invalid magic system identity, origins or strength");
        }
        self.parameters.validate()?;
        self.effects.validate()?;
        if !self.history.retention.is_finite()
            || !(0.0..=1.0).contains(&self.history.retention)
            || !self.history.storage.is_finite()
            || self.history.storage < 0.0
        {
            return Err("Invalid magic history settings");
        }
        for (index, origin) in self.origins.iter().enumerate() {
            if origin.id.is_empty()
                || self.origins[..index]
                    .iter()
                    .any(|other| other.id == origin.id)
            {
                return Err("Magic origins require distinct nonempty identities");
            }
            origin.parameters.validate()?;
            for (i, stock) in origin.stocks.iter().enumerate() {
                if stock.id.is_empty()
                    || stock.reservoir.is_empty()
                    || origin.stocks[..i].iter().any(|other| other.id == stock.id)
                {
                    return Err("Magic stocks require distinct nonempty identities and reservoirs");
                }
            }
        }
        for feature in &self.features {
            feature.validate()?;
        }
        Ok(())
    }
}
impl Feature {
    pub(super) fn resolve(&mut self, scale: &MapScale) -> Result<(), &'static str> {
        for condition in self
            .seeds
            .iter_mut()
            .chain(self.retains.iter_mut().flatten())
            .flatten()
        {
            if dimensional_condition(&condition.field) {
                if let Some(value) = condition.min {
                    condition.min = Some(measure(scale, value, 1)?);
                }
                if let Some(value) = condition.max {
                    condition.max = Some(measure(scale, value, 1)?);
                }
                if let Some(values) = &mut condition.values {
                    for value in values {
                        *value = measure(scale, *value, 1)?;
                    }
                }
            }
        }
        if let Some(coverage) = &mut self.coverage {
            if dimensional_condition(&coverage.field) {
                coverage.floor = measure(scale, coverage.floor, 1)?;
                coverage.full = measure(scale, coverage.full, 1)?;
            }
        }
        Ok(())
    }
    pub(super) fn validate(&self) -> Result<(), &'static str> {
        if self.id.is_empty()
            || self.name.is_empty()
            || !self.priority.is_finite()
            || self.seeds.is_empty()
        {
            return Err("Invalid magic feature");
        }
        for group in self.seeds.iter().chain(self.retains.iter().flatten()) {
            if group.is_empty() {
                return Err("Magic condition conjunction is empty");
            }
            for condition in group {
                if condition.field.is_empty()
                    || condition
                        .min
                        .iter()
                        .chain(condition.max.iter())
                        .chain(condition.values.iter().flatten())
                        .any(|v| !v.is_finite())
                {
                    return Err("Invalid magic condition");
                }
            }
        }
        if self.coverage.as_ref().is_some_and(|c| {
            c.field.is_empty() || !c.floor.is_finite() || !c.full.is_finite() || c.full <= c.floor
        }) {
            return Err("Coverage needs a named field and finite full above floor");
        }
        Ok(())
    }
}
fn dimensional_condition(field: &str) -> bool {
    matches!(field, "ice" | "soilDepth")
}
pub fn validate_systems(systems: &[System]) -> Result<(), &'static str> {
    for (index, system) in systems.iter().enumerate() {
        system.validate()?;
        if systems[..index].iter().any(|other| other.id == system.id) {
            return Err("Magic systems require distinct identities");
        }
        for feature in &system.features {
            for condition in feature
                .seeds
                .iter()
                .chain(feature.retains.iter().flatten())
                .flatten()
            {
                let name = &condition.field;
                let known = PHYSICAL_FIELDS.contains(&name.as_str())
                    || name
                        .strip_prefix("system:")
                        .is_some_and(|id| systems.iter().any(|s| s.id == id))
                    || name
                        .strip_prefix("source:")
                        .is_some_and(|id| system.origins.iter().any(|o| o.id == id))
                    || name.strip_prefix("stock:").is_some_and(|key| {
                        system.origins.iter().any(|origin| {
                            key.strip_prefix(&format!("{}/", origin.id))
                                .is_some_and(|id| {
                                    if origin.stocks.is_empty() {
                                        id == "held"
                                    } else {
                                        origin.stocks.iter().any(|s| s.id == id)
                                    }
                                })
                        })
                    });
                if !known {
                    return Err("Unknown magic condition field");
                }
            }
        }
    }
    Ok(())
}
const PHYSICAL_FIELDS: &[&str] = &[
    "temperature",
    "ice",
    "elevation",
    "slope",
    "water",
    "moisture",
    "geothermal",
    "fracture",
    "landform",
    "river",
    "biome",
    "treeCover",
    "wetlandCover",
    "peatCarbon",
    "oilCarbon",
    "ecologicalToxicity",
    "soilWater",
    "soilDepth",
    "grazers",
    "browsers",
    "upwelling",
    "quickening",
    "stillness",
    "fog",
    "verdure",
    "noise",
    "intensity",
    "history",
    "source",
    "wake",
    "rogue",
    "coastalHistory",
    "firstEpoch",
    "coastalFirstEpoch",
    "stored",
    "sealed",
    "wild",
    "scatter",
];
