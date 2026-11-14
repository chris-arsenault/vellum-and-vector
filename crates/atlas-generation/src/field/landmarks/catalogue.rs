//! Landmark catalogue measures, with procedural dimensions resolved by MapScale.
use crate::scale::{LengthUnit, MapScale, RelativeMeasure};
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
// hpc-exempt: named measures on sparse landmark records, never terrain-cell state.
use std::collections::BTreeMap;
use std::io;
// hpc-exempt: named measures preserve catalogue keys in the map's landmark records.
pub type Measures = BTreeMap<String, f64>;
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "LandmarkKind")]
pub enum Kind {
    VolcanicMountain,
    ResistantMountain,
    Canyon,
    DomeRing,
    ImpactRing,
    Escarpment,
    Falls,
    FireWellspring,
    AuroraVault,
    PressureLocus,
    GreenwoodHeart,
    SaltPan,
}
#[derive(Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields = nullable)]
pub struct Landmark {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub geometry: Geometry,
    pub parameters: Measures,
    pub emplaced_at_epoch: i32,
    pub origin: Option<String>,
    pub area_id: Option<String>,
    pub space_id: Option<String>,
}
#[derive(Clone, Copy, PartialEq)]
pub enum Unit {
    Metre,
    Kilometre,
    Rings,
    Discharge,
    Intensity,
}
pub struct Parameter {
    pub key: &'static str,
    pub unit: Unit,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    pub generated: Option<[f64; 3]>,
    pub advisory: bool,
}
fn length(key: &'static str, unit: Unit, recorded: [f64; 3], generated: [f64; 3]) -> Parameter {
    Parameter {
        key,
        unit,
        min: recorded[0],
        max: recorded[1],
        default: recorded[2],
        generated: Some(generated),
        advisory: false,
    }
}
fn fixed(key: &'static str, unit: Unit, values: [f64; 3]) -> Parameter {
    Parameter {
        key,
        unit,
        min: values[0],
        max: values[1],
        default: values[2],
        generated: None,
        advisory: false,
    }
}
fn capture(default: f64, fraction: f64) -> Parameter {
    length(
        "captureDistance",
        Unit::Kilometre,
        [0.0, 1000.0, default],
        [0.0, 0.25, fraction],
    )
}
impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Self::VolcanicMountain => "Volcanic mountain",
            Self::ResistantMountain => "Resistant-core mountain",
            Self::Canyon => "Canyon",
            Self::DomeRing => "Eroded dome",
            Self::ImpactRing => "Impact structure",
            Self::Escarpment => "Escarpment or rift edge",
            Self::Falls => "Great falls",
            Self::FireWellspring => "Great wellspring",
            Self::AuroraVault => "Great vault",
            Self::PressureLocus => "Deep locus",
            Self::GreenwoodHeart => "Heartwood",
            Self::SaltPan => "Great salt pan",
        }
    }
    pub fn id(self) -> &'static str {
        match self {
            Self::VolcanicMountain => "volcanic-mountain",
            Self::ResistantMountain => "resistant-mountain",
            Self::Canyon => "canyon",
            Self::DomeRing => "dome-ring",
            Self::ImpactRing => "impact-ring",
            Self::Escarpment => "escarpment",
            Self::Falls => "falls",
            Self::FireWellspring => "fire-wellspring",
            Self::AuroraVault => "aurora-vault",
            Self::PressureLocus => "pressure-locus",
            Self::GreenwoodHeart => "greenwood-heart",
            Self::SaltPan => "salt-pan",
        }
    }
    pub fn system(self) -> Option<&'static str> {
        match self {
            Self::FireWellspring => Some("fire"),
            Self::AuroraVault => Some("aurora"),
            Self::PressureLocus => Some("pressure"),
            Self::GreenwoodHeart => Some("greenwood"),
            Self::SaltPan => Some("salt"),
            _ => None,
        }
    }
    pub fn line(self) -> bool {
        matches!(self, Self::Canyon | Self::Escarpment)
    }
    pub fn parameters(self) -> Vec<Parameter> {
        use Unit::*;
        match self {
            Self::VolcanicMountain => vec![
                length(
                    "summit",
                    Metre,
                    [500.0, 9000.0, 5900.0],
                    [0.000125, 0.00225, 0.001475],
                ),
                length(
                    "prominence",
                    Metre,
                    [300.0, 9000.0, 4000.0],
                    [0.000075, 0.00225, 0.001],
                ),
                length(
                    "baseRadius",
                    Kilometre,
                    [5.0, 200.0, 30.0],
                    [0.00125, 0.05, 0.0075],
                ),
            ],
            Self::ResistantMountain => vec![
                length(
                    "summit",
                    Metre,
                    [300.0, 9000.0, 2000.0],
                    [0.000075, 0.00225, 0.0005],
                ),
                length(
                    "prominence",
                    Metre,
                    [200.0, 9000.0, 1500.0],
                    [0.00005, 0.00225, 0.000375],
                ),
                length(
                    "baseRadius",
                    Kilometre,
                    [2.0, 200.0, 15.0],
                    [0.0005, 0.05, 0.00375],
                ),
            ],
            Self::Canyon => vec![
                length(
                    "depth",
                    Metre,
                    [100.0, 3000.0, 1500.0],
                    [0.000025, 0.00075, 0.000375],
                ),
                length(
                    "rimWidth",
                    Kilometre,
                    [1.0, 30.0, 15.0],
                    [0.00025, 0.0075, 0.00375],
                ),
                capture(150.0, 0.0375),
            ],
            Self::DomeRing => vec![
                length(
                    "diameter",
                    Kilometre,
                    [5.0, 200.0, 45.0],
                    [0.00125, 0.05, 0.01125],
                ),
                fixed("ringCount", Rings, [1.0, 6.0, 3.0]),
                length(
                    "ringRelief",
                    Metre,
                    [20.0, 1000.0, 150.0],
                    [0.000005, 0.00025, 0.0000375],
                ),
            ],
            Self::ImpactRing => vec![
                length(
                    "diameter",
                    Kilometre,
                    [5.0, 300.0, 45.0],
                    [0.00125, 0.075, 0.01125],
                ),
                length(
                    "rimHeight",
                    Metre,
                    [50.0, 3000.0, 400.0],
                    [0.0000125, 0.00075, 0.0001],
                ),
                length(
                    "floorDepth",
                    Metre,
                    [50.0, 5000.0, 600.0],
                    [0.0000125, 0.00125, 0.00015],
                ),
            ],
            Self::Escarpment => vec![
                length(
                    "throw",
                    Metre,
                    [100.0, 4000.0, 1000.0],
                    [0.000025, 0.001, 0.00025],
                ),
                length(
                    "scarpWidth",
                    Kilometre,
                    [1.0, 50.0, 10.0],
                    [0.00025, 0.0125, 0.0025],
                ),
            ],
            Self::Falls => vec![
                length(
                    "drop",
                    Metre,
                    [10.0, 1000.0, 50.0],
                    [0.0000025, 0.00025, 0.0000125],
                ),
                Parameter {
                    advisory: true,
                    ..length(
                        "discharge",
                        Discharge,
                        [0.0, 300000.0, 2400.0],
                        [0.0, 4.6875e-15, 3.75e-17],
                    )
                },
                capture(50.0, 0.0125),
            ],
            _ => vec![
                fixed("intensity", Intensity, [100.0, 1000.0, 900.0]),
                length(
                    "reach",
                    Kilometre,
                    [10.0, 300.0, 60.0],
                    [0.0025, 0.075, 0.015],
                ),
            ],
        }
    }
    pub fn reach(self, p: &Measures) -> f64 {
        let km = match self {
            Self::VolcanicMountain | Self::ResistantMountain => p["baseRadius"],
            Self::Canyon => (p["rimWidth"] / 2.0).max(p["captureDistance"]),
            Self::DomeRing | Self::ImpactRing => p["diameter"] / 2.0,
            Self::Escarpment => p["scarpWidth"],
            Self::Falls => p["captureDistance"],
            _ => p["reach"],
        };
        MapScale::metres(km, LengthUnit::Kilometre)
    }
    pub fn generated(self, scale: MapScale) -> io::Result<Vec<Parameter>> {
        self.parameters()
            .into_iter()
            .map(|mut p| {
                if let Some(values) = p.generated {
                    let mut resolved = [0.0; 3];
                    for (output, value) in resolved.iter_mut().zip(values) {
                        *output = scale
                            .resolve(
                                RelativeMeasure::new(
                                    value,
                                    if p.unit == Unit::Discharge { 3 } else { 1 },
                                    1.0,
                                    LengthUnit::Metre,
                                )
                                .map_err(io::Error::other)?,
                            )
                            .map_err(io::Error::other)?
                            .value();
                        if p.unit == Unit::Kilometre {
                            *output = MapScale::in_units(*output, LengthUnit::Kilometre);
                        }
                    }
                    [p.min, p.max, p.default] = resolved;
                }
                Ok(p)
            })
            .collect()
    }
    pub fn clamp(self, values: &Measures, scale: MapScale) -> io::Result<Measures> {
        Ok(self
            .generated(scale)?
            .into_iter()
            .map(|p| {
                let value = values
                    .get(p.key)
                    .copied()
                    .unwrap_or(p.default)
                    .clamp(p.min, p.max);
                (
                    p.key.to_owned(),
                    if p.unit == Unit::Rings {
                        (value + 0.5).floor()
                    } else {
                        value
                    },
                )
            })
            .collect())
    }
}
