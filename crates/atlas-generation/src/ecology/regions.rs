//! Landscape rules and area-weighted attributes from ecologyBiomes/ecologyFeatures.
use super::{environment::environment, groups, Forcing, Habitat, ReadHabitat};
use crate::{
    field::shared::Scalar as S,
    magic::{channels::Channel, state::MagicField},
    rock::{
        catalogue,
        ground::{queries::surface_fact, query::Fact, GroundField},
    },
    scale::{LengthUnit, MapScale},
};
use std::io;
#[derive(Clone, Copy)]
pub enum TermValue {
    Field(S),
    Canopy,
    LivingCover,
    NaturalCover,
    Resistance,
}
pub struct Term {
    pub value: TermValue,
    pub threshold: f64,
    pub above: bool,
}
impl Term {
    pub fn margin(&self, map: &Habitat<'_>, cell: usize) -> io::Result<f64> {
        let value = match self.value {
            TermValue::Field(name) => map.get(name, cell)?,
            TermValue::Canopy => groups::canopy(map, cell)?,
            TermValue::LivingCover => {
                map.get(S::TreeCover, cell)?
                    + map.get(S::GrassCover, cell)?
                    + map.get(S::WetlandCover, cell)?
            }
            TermValue::NaturalCover => {
                groups::canopy(map, cell)?
                    + map.get(S::GrassCover, cell)?
                    + map.get(S::WetlandCover, cell)?
            }
            TermValue::Resistance => {
                map.ground
                    .fold(cell, &surface_fact(Fact::Resistance), None)?
            }
        };
        Ok(if self.above {
            value - self.threshold
        } else {
            self.threshold - value
        })
    }
}
pub struct Rule {
    pub kind: &'static str,
    pub terms: Vec<Term>,
    pub systems: Vec<String>,
}
fn above(value: TermValue, threshold: f64) -> Term {
    Term {
        value,
        threshold,
        above: true,
    }
}
fn below(value: TermValue, threshold: f64) -> Term {
    Term {
        value,
        threshold,
        above: false,
    }
}
fn rule(kind: &'static str, terms: Vec<Term>, systems: &[String]) -> Rule {
    Rule {
        kind,
        terms,
        systems: systems.to_vec(),
    }
}
pub fn rules(fields: &[MagicField]) -> Vec<Rule> {
    use TermValue::*;
    let mut rules = Vec::new();
    let systems = |effect: fn(&crate::magic::configuration::Effects) -> f64| {
        fields
            .iter()
            .filter(|f| f.definition().enabled && effect(&f.definition().effects) > 0.0)
            .map(|f| f.definition().id.clone())
            .collect::<Vec<_>>()
    };
    let quickening = systems(|e| e.quickening);
    if !quickening.is_empty() {
        rules.push(rule(
            "ember",
            vec![above(Field(S::Quickening), 0.25), above(Canopy, 0.3)],
            &quickening,
        ));
        rules.push(rule(
            "thaw",
            vec![
                above(Field(S::Quickening), 0.25),
                below(Canopy, 0.3),
                above(LivingCover, 0.12),
            ],
            &quickening,
        ));
    }
    let stillness = systems(|e| e.stillness);
    if !stillness.is_empty() {
        rules.push(rule(
            "rime",
            vec![above(Field(S::Stillness), 0.45), above(Canopy, 0.3)],
            &stillness,
        ));
        rules.push(rule(
            "glow",
            vec![above(Field(S::Stillness), 0.45), below(LivingCover, 0.12)],
            &stillness,
        ));
    }
    let fog = systems(|e| e.fog);
    if !fog.is_empty() {
        rules.push(rule(
            "fog",
            vec![above(Field(S::FogForcing), 0.3), above(LivingCover, 0.12)],
            &fog,
        ));
    }
    verdant(&mut rules, &systems(|e| e.verdure));
    salted(&mut rules, &systems(|e| e.salting));
    rules.push(rule("forest", vec![above(Canopy, 0.4)], &[]));
    rules.push(rule(
        "grassland",
        vec![above(Field(S::GrassCover), 0.15)],
        &[],
    ));
    rules.push(rule("barren", vec![below(NaturalCover, 0.12)], &[]));
    rules
}
fn verdant(rules: &mut Vec<Rule>, systems: &[String]) {
    use TermValue::*;
    if systems.is_empty() {
        return;
    }
    rules.push(rule(
        "deepwood",
        vec![above(Field(S::Verdure), 0.3), above(Canopy, 0.5)],
        systems,
    ));
    rules.push(rule(
        "wending",
        vec![
            above(Field(S::Verdure), 0.3),
            above(Field(S::WetlandCover), 0.3),
        ],
        systems,
    ));
    rules.push(rule(
        "well",
        vec![
            above(Field(S::Verdure), 0.3),
            below(Canopy, 0.5),
            above(LivingCover, 0.12),
        ],
        systems,
    ));
}
fn salted(rules: &mut Vec<Rule>, systems: &[String]) {
    use TermValue::*;
    if systems.is_empty() {
        return;
    }
    rules.push(rule(
        "flat",
        vec![
            above(Field(S::Salting), 0.3),
            above(
                Resistance,
                catalogue::CATALOGUE[catalogue::STRATA].facts.resistance * 0.95,
            ),
            below(LivingCover, 0.12),
        ],
        systems,
    ));
    rules.push(rule(
        "pan",
        vec![above(Field(S::Salting), 0.3), below(LivingCover, 0.12)],
        systems,
    ));
    rules.push(rule(
        "barrow",
        vec![above(Field(S::Salting), 0.3), above(LivingCover, 0.12)],
        systems,
    ));
}
pub fn family(code: i32) -> Option<&'static str> {
    Some(match code {
        4 | 5 => "barren",
        6..=8 => "grassland",
        9..=12 => "forest",
        13 | 14 => "wetland",
        15 => "ember",
        16 => "thaw",
        17 => "rime",
        18 => "glow",
        19 | 20 => "fog",
        21 => "deepwood",
        22 => "wending",
        23 => "well",
        24 => "barrow",
        25 => "pan",
        26 => "flat",
        _ => return None,
    })
}
pub struct SystemMean {
    pub id: String,
    pub intensity: f64,
}
pub struct Summary {
    pub broadleaf: f64,
    pub conifer: f64,
    pub grass: f64,
    pub wetland: f64,
    pub fire: f64,
    pub flood: f64,
    pub peat: f64,
    pub temperature: f64,
    pub moisture: f64,
    pub wetness: f64,
    pub slope: f64,
    pub elevation: f64,
    pub systems: Vec<SystemMean>,
}
pub fn summarize(
    map: &impl ReadHabitat,
    members: &[usize],
    fields: &[MagicField],
) -> io::Result<Summary> {
    let mut sums = [0.0; 12];
    let mut total = 0.0;
    for &cell in members {
        let area = map.mesh().area(cell);
        total += area;
        let e = environment(map, cell, &Forcing::default())?;
        let values = [
            map.get(S::BroadleafCover, cell)?,
            map.get(S::ConiferCover, cell)?,
            map.get(S::GrassCover, cell)?,
            map.get(S::WetlandCover, cell)?,
            map.get(S::FireActivity, cell)?,
            map.get(S::FloodFrequency, cell)?,
            map.get(S::PeatCarbon, cell)?,
            e.temperature,
            e.moisture,
            e.wetness,
            map.get(S::Slope, cell)?,
            MapScale::metres(
                map.substrate(GroundField::Elevation, cell)?
                    - map.with_water(|water| water.effective_sea_level),
                LengthUnit::Native,
            ),
        ];
        for (sum, value) in sums.iter_mut().zip(values) {
            *sum += value * area;
        }
    }
    for sum in &mut sums {
        *sum /= total;
    }
    let mut systems = Vec::new();
    for field in fields.iter().filter(|f| f.definition().enabled) {
        let intensity = field.channel(Channel::Intensity);
        let mut sum = 0.0;
        for &cell in members {
            sum += intensity.get(cell)? * map.mesh().area(cell);
        }
        systems.push(SystemMean {
            id: field.definition().id.clone(),
            intensity: sum / total,
        });
    }
    Ok(Summary {
        broadleaf: sums[0],
        conifer: sums[1],
        grass: sums[2],
        wetland: sums[3],
        fire: sums[4],
        flood: sums[5],
        peat: sums[6],
        temperature: sums[7],
        moisture: sums[8],
        wetness: sums[9],
        slope: sums[10],
        elevation: sums[11],
        systems,
    })
}
impl Rule {
    pub fn system<'a>(&self, summary: &'a Summary) -> Option<&'a str> {
        let mut best = None;
        let mut peak = 0.0;
        for id in &self.systems {
            if let Some(system) = summary.systems.iter().find(|s| s.id == *id) {
                if system.intensity > peak {
                    best = Some(system.id.as_str());
                    peak = system.intensity;
                }
            }
        }
        best
    }
    pub fn name(&self, r: &Summary, scale: &MapScale) -> io::Result<&'static str> {
        let length = |fraction| {
            scale
                .resolve(crate::scale::RelativeMeasure::length(fraction).map_err(io::Error::other)?)
                .map(|v| v.value())
                .map_err(io::Error::other)
        };
        Ok(match self.kind {
            "ember" => "Ember grove",
            "thaw" => "Thaw meadow",
            "rime" => "Rime forest",
            "glow" => "Glow-lichen barrens",
            "fog" => {
                if r.broadleaf + r.conifer >= 0.4 {
                    "Moss forest"
                } else {
                    "Fog heath"
                }
            }
            "deepwood" => "Deepwood",
            "wending" => "Wending fen",
            "well" => "Well meadow",
            "flat" => "Glass flat",
            "pan" => "Salt pan",
            "barrow" => "Barrow heath",
            "forest" => forest_name(r, length(0.000375)?),
            "grassland" => grass_name(r),
            "barren" => barren_name(r, length(0.0005)?),
            "wetland" => wetland_name(r),
            _ => return Err(io::Error::other("Unknown biome rule")),
        })
    }
}
fn forest_name(r: &Summary, montane: f64) -> &'static str {
    let conifer = r.conifer / (r.conifer + r.broadleaf).max(1e-9);
    if conifer > 0.6 {
        return if r.temperature < 5.0 {
            "Boreal forest"
        } else if r.elevation > montane {
            "Montane forest"
        } else {
            "Conifer forest"
        };
    }
    if conifer > 0.4 {
        return "Mixed forest";
    }
    if r.temperature > 22.0 && r.moisture > 0.7 {
        return "Rainforest";
    }
    if r.temperature > 18.0 {
        "Dry forest"
    } else {
        "Temperate forest"
    }
}
fn grass_name(r: &Summary) -> &'static str {
    if r.temperature < 2.0 {
        "Tundra"
    } else if r.temperature > 18.0 && (r.fire > 0.2 || r.moisture > 0.3) {
        "Savanna"
    } else if r.moisture < 0.3 {
        "Steppe"
    } else {
        "Prairie"
    }
}
pub fn wetland_name(r: &Summary) -> &'static str {
    wetland_kind(r.peat, r.flood, r.broadleaf, r.conifer)
}
pub fn wetland_kind(peat: f64, flood: f64, broadleaf: f64, conifer: f64) -> &'static str {
    if peat >= 10.0 {
        "Bog"
    } else if flood > 0.1 {
        "Floodplain marsh"
    } else if broadleaf + conifer > 0.2 {
        "Swamp"
    } else {
        "Marsh"
    }
}
fn barren_name(r: &Summary, rock: f64) -> &'static str {
    if r.temperature < 2.0 {
        "Polar desert"
    } else if r.slope > 0.015 || r.elevation > rock {
        "Rock barrens"
    } else if r.temperature > 18.0 {
        "Hot desert"
    } else {
        "Cold desert"
    }
}
