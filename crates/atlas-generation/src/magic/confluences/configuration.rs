use crate::{
    magic::{
        configuration::{Cartography, Condition, Feature, Relative},
        parameters::measure,
    },
    scale::MapScale,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "ConfluenceEffects")]
pub struct Effects {
    pub fracture_conductance: f64,
    pub rock_resistance: f64,
    pub relief: f64,
    pub soil_removal: f64,
    pub coastal_forcing: f64,
    pub fog: f64,
    pub ice_melt: f64,
    pub debris: f64,
    pub toxicity: f64,
}
impl Effects {
    fn validate(&self) -> Result<(), &'static str> {
        let finite = [
            self.fracture_conductance,
            self.rock_resistance,
            self.relief,
            self.soil_removal,
            self.coastal_forcing,
            self.fog,
            self.ice_melt,
            self.debris,
            self.toxicity,
        ];
        if finite.iter().any(|x| !x.is_finite())
            || [self.relief, self.ice_melt, self.debris]
                .iter()
                .any(|x| *x < 0.0)
            || [self.soil_removal, self.fog, self.toxicity]
                .iter()
                .any(|x| !(0.0..=1.0).contains(x))
            || !(0.0..=1000.0).contains(&self.coastal_forcing)
        {
            return Err("Invalid confluence effects");
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicHazard")]
pub struct Hazard {
    pub kind: String,
    pub rate: f64,
    pub severity: f64,
    pub radius: f64,
    pub cause: String,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum GroundMaterial {
    Sinter,
    Crushstone,
    Rootstone,
    Rimerot,
    Tufa,
    SaltGlass,
    Tornstone,
    Saltbed,
}
impl GroundMaterial {
    pub fn code(self) -> usize {
        match self {
            Self::Sinter => 15,
            Self::Crushstone => 19,
            Self::Rootstone => 20,
            Self::Rimerot => 17,
            Self::Tufa => 21,
            Self::SaltGlass => 22,
            Self::Tornstone => 24,
            Self::Saltbed => 4,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "MagicConfluence", optional_fields = nullable)]
pub struct Confluence {
    #[serde(default)]
    pub length_units: Relative,
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub systems: Vec<String>,
    #[serde(default = "floor")]
    pub floor: f64,
    #[serde(default = "strain")]
    pub strain_scale: f64,
    #[serde(default = "priority")]
    pub priority: f64,
    pub cartography: Option<Cartography>,
    pub seeds: Vec<Vec<Condition>>,
    pub retains: Option<Vec<Vec<Condition>>>,
    #[serde(default)]
    pub effects: Effects,
    pub ground_material: Option<GroundMaterial>,
    pub hazard: Option<Hazard>,
}
fn yes() -> bool {
    true
}
fn floor() -> f64 {
    0.2
}
fn strain() -> f64 {
    4.0
}
fn priority() -> f64 {
    100.0
}
#[derive(Clone, Debug)]
pub struct ResolvedConfluence {
    pub rule: Feature,
    pub enabled: bool,
    pub systems: Vec<String>,
    pub floor: f64,
    pub strain_scale: f64,
    pub effects: Effects,
    pub ground_material: Option<GroundMaterial>,
    pub hazard: Option<Hazard>,
}
impl Confluence {
    pub fn validate_definition(&self) -> Result<(), &'static str> {
        self.validate()?;
        Feature {
            id: self.id.clone(),
            name: self.name.clone(),
            cartography: self.cartography,
            priority: self.priority,
            seeds: self.seeds.clone(),
            retains: self.retains.clone(),
            coverage: None,
        }
        .validate()
    }
    pub fn resolve(mut self, scale: &MapScale) -> Result<ResolvedConfluence, &'static str> {
        self.validate()?;
        let mut rule = Feature {
            id: self.id,
            name: self.name.trim().into(),
            cartography: self.cartography,
            priority: self.priority,
            seeds: self.seeds,
            retains: self.retains,
            coverage: None,
        };
        rule.validate()?;
        rule.resolve(scale)?;
        self.effects.relief = measure(scale, self.effects.relief, 1)?;
        self.effects.ice_melt = measure(scale, self.effects.ice_melt, 1)?;
        self.effects.debris = measure(scale, self.effects.debris, 1)?;
        if let Some(hazard) = &mut self.hazard {
            hazard.radius = measure(scale, hazard.radius, 1)?;
        }
        Ok(ResolvedConfluence {
            rule,
            enabled: self.enabled,
            systems: self.systems,
            floor: self.floor,
            strain_scale: self.strain_scale,
            effects: self.effects,
            ground_material: self.ground_material,
            hazard: self.hazard,
        })
    }
    fn validate(&self) -> Result<(), &'static str> {
        if self.systems.len() < 2
            || self.systems.iter().any(|id| id.is_empty())
            || !self.strain_scale.is_finite()
            || self.strain_scale < 0.0
            || !self.floor.is_finite()
            || !(0.0..=1.0).contains(&self.floor)
        {
            return Err("Invalid confluence participants or coverage");
        }
        self.effects.validate()?;
        if let Some(h) = &self.hazard {
            if h.kind.is_empty()
                || h.cause.is_empty()
                || !h.rate.is_finite()
                || h.rate < 0.0
                || !h.severity.is_finite()
                || !(0.0..=1.0).contains(&h.severity)
                || !h.radius.is_finite()
                || h.radius <= 0.0
            {
                return Err("Invalid confluence hazard");
            }
        }
        for condition in self
            .seeds
            .iter()
            .chain(self.retains.iter().flatten())
            .flatten()
        {
            if condition.field.starts_with("source:")
                || OWN_CHANNELS.contains(&condition.field.as_str())
            {
                return Err("Confluence cannot read its own channels");
            }
        }
        Ok(())
    }
}
const OWN_CHANNELS: &[&str] = &[
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
];
pub fn resolve_all(
    definitions: Vec<Confluence>,
    scale: &MapScale,
) -> Result<Vec<ResolvedConfluence>, &'static str> {
    for (index, definition) in definitions.iter().enumerate() {
        if definitions[..index]
            .iter()
            .any(|other| other.id == definition.id)
        {
            return Err("Confluences require distinct identities");
        }
    }
    definitions
        .into_iter()
        .map(|definition| definition.resolve(scale))
        .collect()
}
