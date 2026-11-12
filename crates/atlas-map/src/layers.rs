use crate::{Bounds, MapError, MapErrorCode};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapLayer {
    pub id: String,
    pub name: String,
    pub bounds: Bounds,
    pub source: LayerSource,
    pub attribution: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum LayerSource {
    Raster(RasterSource),
    Vector(VectorSource),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterSource {
    /// Map-owned opaque asset identity. Never a private generation resource reference.
    pub asset_id: String,
    pub media_type: String,
    pub width: u32,
    pub height: u32,
    pub cell_span: f64,
    pub bands: Vec<RasterBand>,
    pub overviews: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterBand {
    pub id: String,
    pub unit: String,
    pub nodata: Option<f64>,
    pub categories: Vec<Category>,
    pub range: Option<(f64, f64)>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VectorSource {
    pub asset_id: String,
    pub media_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Category {
    pub value: i32,
    pub label: String,
    pub color: Option<String>,
}

impl MapLayer {
    pub fn validate(&self) -> Result<(), MapError> {
        self.bounds.validate()?;
        if self.id.is_empty() || self.name.is_empty() {
            return Err(MapError::new(
                MapErrorCode::InvalidMap,
                "A layer needs an identity and name",
            ));
        }
        match &self.source {
            LayerSource::Raster(source) => source.validate(),
            LayerSource::Vector(source)
                if source.asset_id.is_empty() || source.media_type.is_empty() =>
            {
                Err(MapError::new(
                    MapErrorCode::InvalidMap,
                    "A vector layer needs a map asset and media type",
                ))
            }
            LayerSource::Vector(_) => Ok(()),
        }
    }
}

impl RasterSource {
    pub fn validate(&self) -> Result<(), MapError> {
        if self.asset_id.is_empty()
            || self.media_type.is_empty()
            || self.width == 0
            || self.height == 0
            || !self.cell_span.is_finite()
            || self.cell_span <= 0.0
            || self.bands.is_empty()
        {
            return Err(MapError::new(
                MapErrorCode::InvalidMap,
                "A raster needs a map asset, dimensions, resolution and bands",
            ));
        }
        let mut ids = std::collections::BTreeSet::new();
        for band in &self.bands {
            if band.id.is_empty()
                || band.unit.is_empty()
                || !ids.insert(&band.id)
                || band.nodata.is_some_and(|v| !v.is_finite())
                || band
                    .range
                    .is_some_and(|(low, high)| !low.is_finite() || !high.is_finite() || high < low)
            {
                return Err(MapError::new(
                    MapErrorCode::InvalidMap,
                    "Raster bands need distinct identities, units and finite ranges",
                ));
            }
        }
        Ok(())
    }
}
