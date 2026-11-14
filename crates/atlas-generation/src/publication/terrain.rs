//! Presentation-only terrain derivatives. Heights are metres in the published map frame.
use super::raster::MapRaster;
use crate::storage::Band;
use std::io;
pub fn gradients(
    raster: &MapRaster,
    height: usize,
    east: &mut Band<f32>,
    north: &mut Band<f32>,
) -> io::Result<()> {
    raster.validate()?;
    let width = raster.grid.width as usize;
    let count = raster.grid.count()?;
    if east.len() != count || north.len() != count || height >= raster.planes.len() {
        return Err(io::Error::other(
            "Terrain derivatives must cover the map raster",
        ));
    }
    let values = &raster.planes[height].values;
    let sample = |cell, fallback| -> io::Result<f32> {
        Ok(if raster.coverage.get(cell)? > 0.99 {
            values.get(cell)?
        } else {
            fallback
        })
    };
    let [dx, dy] = raster.grid.pixel_span();
    for cell in 0..count {
        if raster.coverage.get(cell)? <= 0.0 {
            east.set(cell, 0.0)?;
            north.set(cell, 0.0)?;
            continue;
        }
        let z = values.get(cell)?;
        let row = cell / width;
        let col = cell % width;
        let west = row * width + col.saturating_sub(1);
        let right = row * width + (col + 1).min(width - 1);
        let top = row.saturating_sub(1) * width + col;
        let bottom = (row + 1).min(raster.grid.height as usize - 1) * width + col;
        east.set(
            cell,
            ((f64::from(sample(right, z)?) - f64::from(sample(west, z)?)) / (2.0 * dx)) as f32,
        )?;
        north.set(
            cell,
            ((f64::from(sample(top, z)?) - f64::from(sample(bottom, z)?)) / (2.0 * dy)) as f32,
        )?;
    }
    Ok(())
}
