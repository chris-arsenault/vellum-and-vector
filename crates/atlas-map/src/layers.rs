use crate::{Bounds, DisplayUnit, LayerCatalog, MapError, MapErrorCode};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapLayer {
    pub id: String,
    pub space_id: crate::Id,
    pub name: String,
    pub bounds: Bounds,
    pub source: LayerSource,
    pub attribution: Vec<String>,
    pub catalog: LayerCatalog,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum LayerSource {
    Raster(RasterSource),
    Vector(VectorSource),
    /// Inspectable values held in a raster the viewer does not draw.
    Attributes(RasterSource),
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
    /// One-based TIFF band addresses for this layer's logical bands.
    pub band_indices: Vec<u16>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterBand {
    pub id: String,
    pub name: String,
    pub unit: String,
    pub display: DisplayUnit,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Category {
    pub value: i32,
    pub label: String,
    pub color: Option<String>,
    pub surface: Option<SurfaceAppearance>,
    pub present: bool,
    /// For a rock class: whether moving groundwater dissolves this rock into passages (karst),
    /// published so tools that cut rock can read it without the rock catalogue.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub soluble: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SurfaceAppearance {
    pub bathymetric: bool,
    pub tint: f64,
    pub system: Option<String>,
    pub system_name: Option<String>,
}

impl MapLayer {
    pub fn validate(&self) -> Result<(), MapError> {
        self.catalog.validate()?;
        match self.source {
            LayerSource::Raster(_) | LayerSource::Attributes(_) => self.bounds.validate()?,
            LayerSource::Vector(_) => self.bounds.validate_window()?,
        }
        if self.id.is_empty() || self.name.is_empty() {
            return Err(MapError::new(
                MapErrorCode::InvalidMap,
                "A layer needs an identity and name",
            ));
        }
        match &self.source {
            LayerSource::Raster(source) | LayerSource::Attributes(source) => source.validate(),
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
            || self.band_indices.len() != self.bands.len()
            || self.band_indices.contains(&0)
        {
            return Err(MapError::new(
                MapErrorCode::InvalidMap,
                "A raster needs a map asset, dimensions, resolution and bands",
            ));
        }
        validate_bands(&self.bands)
    }
}

fn validate_bands(bands: &[RasterBand]) -> Result<(), MapError> {
    let mut ids = std::collections::BTreeSet::new();
    for band in bands {
        if band.id.is_empty()
            || band.name.is_empty()
            || band.unit.is_empty()
            || !band.display.factor.is_finite()
            || band.display.factor <= 0.0
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
        for category in &band.categories {
            if category.label.is_empty()
                || category.surface.as_ref().is_some_and(|surface| {
                    !surface.tint.is_finite() || !(0.0..=1.0).contains(&surface.tint)
                })
            {
                return Err(MapError::new(
                    MapErrorCode::InvalidMap,
                    "Map categories need labels and surface tint fractions",
                ));
            }
        }
    }
    Ok(())
}
