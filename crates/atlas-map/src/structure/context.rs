//! What a structure map shows of the world outside it, read only from published GIS: the
//! magic prevalence at the building's site (the share of each system's published coverage
//! over the samples under the footprint), the magic features near it and the parent's
//! place record (settlement, ward, street, address).
use super::StructureSite;
use crate::{BandValue, Geometry, MapFeature};
use serde::{Deserialize, Serialize};
use serde_json::Value;
// hpc-exempt: a few magic systems per site, keyed by system id.
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteContext {
    /// Magic systems present at the site, most prevalent first.
    pub magic: Vec<MagicShare>,
    /// Magic features near the building, nearest first.
    pub features: Vec<NearbyFeature>,
    pub place: PlaceRecord,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MagicShare {
    /// The system's id, or `confluence:<id>` where systems meet.
    pub system: String,
    pub label: String,
    /// Mean published coverage over the site, 0 to 1.
    pub share: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NearbyFeature {
    pub map_id: crate::Id,
    pub feature_id: crate::Id,
    pub space_id: crate::Id,
    pub name: String,
    pub kind: String,
    /// Metres from the building's centre to the feature.
    pub distance: f64,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaceRecord {
    pub name: Option<String>,
    #[serde(rename = "use")]
    pub use_: Option<String>,
    pub address: Option<String>,
    pub street: Option<String>,
    pub ward: Option<String>,
    pub settlement: Option<String>,
}

/// The system a published magic coverage band belongs to: `magic:<system>:coverage`, or
/// `magic:confluence:<id>:coverage` where systems meet.
fn coverage_system(band: &str) -> Option<String> {
    let rest = band.strip_prefix("magic:")?.strip_suffix(":coverage")?;
    match rest.split(':').collect::<Vec<_>>().as_slice() {
        [system] => Some((*system).into()),
        ["confluence", id] => Some(format!("confluence:{id}")),
        _ => None,
    }
}
/// Every published channel is a raster layer of its own (`raster:magic:aurora:coverage`,
/// band `value`), which names the system.
fn value_system(value: &BandValue) -> Option<String> {
    if value.band_id != "value" {
        return None;
    }
    coverage_system(value.layer_id.strip_prefix("raster:")?)
}
/// "Aurora" for `aurora`, "Confluence ember-frost" for a meeting of systems.
fn system_label(system: &str) -> String {
    let words = system.replace(':', " ");
    let mut chars = words.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}
/// The outside context of a building. `readings` are the band values at points under its
/// footprint; `nearby` are the parent's magic features around it, with the map each was
/// read from.
pub fn site_context(
    site: &StructureSite,
    building: Option<&MapFeature>,
    centre: [f64; 2],
    readings: &[Vec<BandValue>],
    nearby: &[(crate::Id, MapFeature)],
) -> SiteContext {
    SiteContext {
        magic: magic(readings),
        features: features(centre, nearby),
        place: place(site, building),
    }
}
/// A point outside the published map reads no values and does not count.
fn magic(readings: &[Vec<BandValue>]) -> Vec<MagicShare> {
    let active: Vec<_> = readings
        .iter()
        .filter(|reading| !reading.is_empty())
        .collect();
    // hpc-exempt: per-system totals over a handful of points.
    let mut totals: BTreeMap<String, f64> = BTreeMap::new();
    for reading in &active {
        for value in reading.iter() {
            let Some(system) = value_system(value) else {
                continue;
            };
            *totals.entry(system).or_insert(0.0) += value.value.clamp(0.0, 1.0);
        }
    }
    let mut shares: Vec<MagicShare> = totals
        .into_iter()
        .map(|(system, total)| MagicShare {
            label: system_label(&system),
            system,
            share: total / active.len().max(1) as f64,
        })
        .filter(|share| share.share > 0.0)
        .collect();
    shares.sort_by(|a, b| b.share.total_cmp(&a.share).then(a.system.cmp(&b.system)));
    shares
}
fn features(centre: [f64; 2], nearby: &[(crate::Id, MapFeature)]) -> Vec<NearbyFeature> {
    let mut found: Vec<NearbyFeature> = nearby
        .iter()
        .map(|(map_id, feature)| NearbyFeature {
            map_id: *map_id,
            feature_id: feature.id,
            space_id: feature.space_id,
            name: feature.name.clone().unwrap_or_else(|| feature.kind.clone()),
            kind: feature.kind.clone(),
            distance: distance(centre, &feature.geometry),
        })
        .collect();
    found.sort_by(|a, b| a.distance.total_cmp(&b.distance));
    found
}
/// Distance from a point to a feature's nearest vertex; a site panel needs no finer measure.
fn distance([x, y]: [f64; 2], geometry: &Geometry) -> f64 {
    let mut best = f64::INFINITY;
    let mut visit = |p: &crate::Position| {
        let [px, py, _] = p.coordinates();
        best = best.min((px - x).hypot(py - y));
    };
    match geometry {
        Geometry::Point { coordinates } => visit(coordinates),
        Geometry::MultiPoint { coordinates } | Geometry::LineString { coordinates } => {
            coordinates.iter().for_each(visit)
        }
        Geometry::MultiLineString { coordinates } | Geometry::Polygon { coordinates } => {
            coordinates.iter().flatten().for_each(visit)
        }
        Geometry::MultiPolygon { coordinates } => {
            coordinates.iter().flatten().flatten().for_each(visit)
        }
        _ => {}
    }
    (best * 10.0).round() / 10.0
}
/// The parent's live record where it still stands, else the record kept when the floors opened.
fn place(site: &StructureSite, building: Option<&MapFeature>) -> PlaceRecord {
    let text = |key: &str| {
        building
            .and_then(|feature| feature.attributes.get(key))
            .and_then(Value::as_str)
            .map(String::from)
    };
    PlaceRecord {
        name: building
            .and_then(|feature| feature.name.clone())
            .or_else(|| site.name.clone()),
        use_: text("use").or_else(|| site.use_.clone()),
        address: text("address").or_else(|| site.address.clone()),
        street: text("street"),
        ward: text("ward"),
        settlement: text("settlement"),
    }
}
