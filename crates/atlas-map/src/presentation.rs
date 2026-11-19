use crate::{MapError, MapErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayUnit {
    // Shared, since each published sample attribute carries its band's display unit.
    pub unit: std::sync::Arc<str>,
    pub factor: f64,
}

/// Resolved layer discovery and styling metadata, available without loading its asset.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerCatalog {
    pub path: Vec<String>,
    pub common: bool,
    pub feature_types: Vec<MapFeatureType>,
    pub default_style: Option<MapVectorStyle>,
    pub presets: Vec<String>,
    pub properties: BTreeMap<String, MapProperty>,
    /// One published feature identity per geometry kind for the symbol editor.
    pub examples: Vec<crate::Id>,
    /// Geometry kinds for default symbols, including an empty network's line representation.
    pub geometries: Vec<GeometryType>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapFeatureType {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub path: Vec<String>,
    pub magic_depiction: Option<MagicDepiction>,
    pub count: u32,
    pub geometries: Vec<GeometryType>,
    pub footprints: bool,
    /// The real size of one thing of this kind, from the catalogue's true-size slot, for
    /// kinds a creator places or draws at their size (an object, a stream's width).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub true_size: Option<KindSize>,
}

/// A kind's real size in metres: its breadth across with a long tail (least, typical,
/// largest), how many times longer than wide one runs, and whether its outline is round.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KindSize {
    pub least: f64,
    pub typical: f64,
    pub largest: f64,
    pub elongation: f64,
    pub round: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum GeometryType {
    Point,
    MultiPoint,
    LineString,
    MultiLineString,
    Polygon,
    MultiPolygon,
    GeometryCollection,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PropertyType {
    String,
    Number,
    Boolean,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MapProperty {
    #[serde(rename = "type")]
    pub kind: PropertyType,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum MagicDepiction {
    Site,
    Course,
    Area,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapVectorStyle {
    pub visible: bool,
    pub opacity: f64,
    pub color: String,
    pub labels: bool,
    pub min_scale: f64,
    pub types: BTreeMap<String, MapFeatureTypeStyle>,
    pub groups: BTreeMap<String, bool>,
    /// GeoStyler's standard symbol specification.
    pub symbols: Option<Value>,
    pub filter: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapFeatureTypeStyle {
    pub footprints: Option<bool>,
    pub visible: Option<bool>,
    pub labels: Option<bool>,
    pub color: Option<String>,
    pub opacity: Option<f64>,
}

impl LayerCatalog {
    pub fn validate(&self) -> Result<(), MapError> {
        let mut ids = std::collections::BTreeSet::new();
        for feature in &self.feature_types {
            if feature.id.is_empty()
                || feature.label.is_empty()
                || feature.kind.is_empty()
                || !ids.insert(&feature.id)
                || feature.path.iter().any(String::is_empty)
            {
                return Err(MapError::new(
                    MapErrorCode::InvalidMap,
                    "Feature types need distinct identities and resolved labels",
                ));
            }
        }
        if let Some(style) = &self.default_style {
            if !style.opacity.is_finite()
                || !(0.0..=1.0).contains(&style.opacity)
                || !style.min_scale.is_finite()
                || style.min_scale < 0.0
                || style.color.is_empty()
                || style.types.values().any(|value| {
                    value.opacity.is_some_and(|opacity| {
                        !opacity.is_finite() || !(0.0..=1.0).contains(&opacity)
                    })
                })
            {
                return Err(MapError::new(
                    MapErrorCode::InvalidMap,
                    "Vector styles need finite opacity and scale and a color",
                ));
            }
        }
        Ok(())
    }
}
