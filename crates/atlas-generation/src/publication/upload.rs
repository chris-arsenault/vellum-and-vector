//! A bounded same-host publication stream. Only finalized map pixels cross this boundary.
use super::{
    geotiff,
    raster::{MapRaster, RasterGrid, Resampling},
};
use crate::{control::GenerationControl, storage::Coverage};
use atlas_map::{DisplayUnit, RasterBand, RasterSource};
use serde::{Deserialize, Serialize};
use std::io::{self, Seek, Write};
use ts_rs::TS;

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationPlane {
    pub band: RasterBand,
    pub resampling: Resampling,
}
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterPublicationInput {
    pub asset_id: String,
    pub grid: RasterGrid,
    pub planes: Vec<PublicationPlane>,
}
pub struct RasterPublication {
    raster: MapRaster,
    storage: Coverage,
    asset_id: String,
    rows: u32,
}
impl RasterPublication {
    pub fn new(input: RasterPublicationInput, mut storage: Coverage) -> io::Result<Self> {
        let result = Self {
            raster: MapRaster::new(
                input.grid,
                input
                    .planes
                    .into_iter()
                    .map(|p| (p.band, p.resampling))
                    .collect(),
                &mut storage,
            )?,
            storage,
            asset_id: input.asset_id,
            rows: 0,
        };
        result.source().validate().map_err(io::Error::other)?;
        Ok(result)
    }
    /// Interleaved complete rows in north-first order, coverage after the declared display bands.
    pub fn append(&mut self, pixels: &[f32]) -> io::Result<()> {
        let stride = self.raster.planes.len() + 1;
        let row_samples = (self.raster.grid.width as usize)
            .checked_mul(stride)
            .ok_or_else(|| io::Error::other("Map row exceeds address space"))?;
        if pixels.is_empty() || !pixels.len().is_multiple_of(row_samples) {
            return Err(io::Error::other(
                "Publication batches must contain complete map rows",
            ));
        }
        let rows = u32::try_from(pixels.len() / row_samples).map_err(io::Error::other)?;
        let end = self
            .rows
            .checked_add(rows)
            .filter(|&end| end <= self.raster.grid.height)
            .ok_or_else(|| io::Error::other("Publication batch exceeds map raster"))?;
        // Validate the whole supplied batch before modifying owned pixels.
        for pixel in pixels.chunks_exact(stride) {
            let coverage = pixel[stride - 1];
            if !coverage.is_finite()
                || !(0.0..=1.0).contains(&coverage)
                || (coverage > 0.0 && pixel[..stride - 1].iter().any(|v| !v.is_finite()))
            {
                return Err(io::Error::other("Invalid covered map pixel"));
            }
        }
        let start = self.rows as usize * self.raster.grid.width as usize;
        for (index, pixel) in pixels.chunks_exact(stride).enumerate() {
            let cell = start + index;
            self.raster.coverage.set(cell, pixel[stride - 1])?;
            for (plane, value) in self.raster.planes.iter_mut().zip(pixel) {
                plane.values.set(cell, *value)?;
            }
        }
        self.rows = end;
        Ok(())
    }
    pub async fn finish<W: Write + Seek>(
        mut self,
        writer: W,
        control: &impl GenerationControl,
    ) -> io::Result<RasterSource> {
        if self.rows != self.raster.grid.height {
            return Err(io::Error::other("Cannot publish an incomplete map raster"));
        }
        geotiff::write(writer, &self.raster, &mut self.storage, control).await?;
        Ok(self.source())
    }
    pub fn into_raster(self) -> io::Result<(MapRaster, Coverage)> {
        if self.rows != self.raster.grid.height {
            return Err(io::Error::other("Cannot publish an incomplete map raster"));
        }
        Ok((self.raster, self.storage))
    }
    pub fn source(&self) -> RasterSource {
        let mut bands: Vec<_> = self
            .raster
            .planes
            .iter()
            .map(|plane| plane.definition.clone())
            .collect();
        bands.push(RasterBand {
            id: "coverage".into(),
            name: "Coverage".into(),
            unit: "ratio".into(),
            display: DisplayUnit {
                unit: "%".into(),
                factor: 100.0,
            },
            nodata: None,
            categories: vec![],
            range: Some((0.0, 1.0)),
        });
        let [dx, dy] = self.raster.grid.pixel_span();
        RasterSource {
            asset_id: self.asset_id.clone(),
            media_type: geotiff::MEDIA_TYPE.into(),
            width: self.raster.grid.width,
            height: self.raster.grid.height,
            cell_span: dx.max(dy),
            band_indices: (1..=bands.len()).map(|i| i as u16).collect(),
            bands,
            overviews: vec![], // Reduced images are embedded in this GeoTIFF.
        }
    }
}
