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
    let sample = |cell| -> io::Result<Option<f32>> {
        Ok(if raster.coverage.get(cell)? > 0.99 {
            Some(values.get(cell)?)
        } else {
            None
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
            difference(
                z,
                if col > 0 { sample(west)? } else { None },
                if col + 1 < width {
                    sample(right)?
                } else {
                    None
                },
                dx,
            ),
        )?;
        north.set(
            cell,
            difference(
                z,
                if row + 1 < raster.grid.height as usize {
                    sample(bottom)?
                } else {
                    None
                },
                if row > 0 { sample(top)? } else { None },
                dy,
            ),
        )?;
    }
    Ok(())
}
pub(crate) fn difference(center: f32, before: Option<f32>, after: Option<f32>, step: f64) -> f32 {
    let (delta, distance) = match (before, after) {
        (Some(a), Some(b)) => (b - a, 2.0 * step),
        (Some(a), None) => (center - a, step),
        (None, Some(b)) => (b - center, step),
        (None, None) => return 0.0,
    };
    (f64::from(delta) / distance) as f32
}
