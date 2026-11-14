//! The finalized GIS raster producer. No numerical samplers are needed by the map reader.
mod channel;
mod colors;
mod display;
mod prepared;
pub use prepared::Prepared;
mod tile;
use super::{raster::RasterGrid, upload::RasterPublication};
use crate::{
    control::GenerationControl, field::inheritance::resources::Resource, reconstruction::Layout,
    spatial::SpatialKernel, storage::Coverage,
};
use atlas_map::{Bounds, Geometry};
use std::{cell::RefCell, io};

pub struct Lake {
    pub geometry: Geometry,
    pub level: f64,
}
pub struct Source<'a> {
    pub field: &'a Resource,
    pub channel: &'a str,
    pub footprint: &'a Geometry,
    pub bounds: Bounds,
    pub wrap: Option<[f64; 2]>,
    pub water: Option<&'a Resource>,
    pub ice: Option<&'a Resource>,
    pub surface: Option<&'a Resource>,
    pub colors: &'a [atlas_map::Category],
    pub ocean: Option<&'a Geometry>,
    pub lakes: &'a [Lake],
}
/// Two display pixels per declared map sample span, independent of capture-tree subdivisions.
pub fn grid(source: &Source<'_>) -> io::Result<RasterGrid> {
    let span = display_span(source.field)? / 2.0;
    let Bounds(w, s, e, n) = source.bounds;
    let width = ((e - w) / span).ceil();
    let height = ((n - s) / span).ceil();
    if !width.is_finite()
        || !height.is_finite()
        || width < 1.0
        || height < 1.0
        || width > u32::MAX as f64
        || height > u32::MAX as f64
    {
        return Err(io::Error::other(
            "Map pixel dimensions exceed raster representation",
        ));
    }
    Ok(RasterGrid {
        width: width as u32,
        height: height as u32,
        bounds: Bounds(w, n - height * span, w + width * span, n),
    })
}
fn display_span(source: &Resource) -> io::Result<f64> {
    let span = match (source.resolution, &source.grid.layout) {
        (Some(span), _) => span,
        (None, Layout::Raster { width, height }) => {
            let [w, s, e, n] = source.grid.bounds;
            ((e - w) / (width - 1) as f64).min((n - s) / (height - 1) as f64)
        }
        (None, Layout::Adaptive(_)) => {
            return Err(io::Error::other(
                "Adaptive captured fields require their map resolution",
            ));
        }
    };
    if !span.is_finite() || span <= 0.0 {
        return Err(io::Error::other(
            "Map display resolution must be positive and finite",
        ));
    }
    Ok(span)
}
/// Publication stays on the generation host. It emits north-first GIS rows into the Rust encoder.
pub async fn publish(
    source: &Source<'_>,
    prepared: &Prepared,
    publication: &mut RasterPublication,
    coverage: &RefCell<Coverage>,
    spatial: &dyn SpatialKernel,
    control: &impl GenerationControl,
) -> io::Result<()> {
    let grid = prepared.grid;
    grid.count()?;
    let mut sampler = tile::Sampler::new(source, coverage, spatial)?;
    let width = grid.width as usize;
    let height = grid.height as usize;
    let bands = if source.channel == "Elevation" { 16 } else { 3 };
    for row in (0..height).step_by(256) {
        let rows = (height - row).min(256);
        let mut stripe = vec![0.0f32; width * rows * bands];
        for col in (0..width).step_by(256) {
            let columns = (width - col).min(256);
            control
                .cooperate()
                .await
                .map_err(|e| io::Error::other(format!("{e:?}")))?;
            let points = prepared.tile(col, row, columns + 2, rows + 2)?;
            let values = sampler.tile(prepared, &points, spatial)?;
            for y in 0..rows {
                for x in 0..columns {
                    let from = ((y + 1) * (columns + 2) + x + 1) * bands;
                    let to = (y * width + col + x) * bands;
                    stripe[to..to + bands].copy_from_slice(&values[from..from + bands]);
                }
            }
        }
        publication.append(&stripe)?;
    }
    Ok(())
}
