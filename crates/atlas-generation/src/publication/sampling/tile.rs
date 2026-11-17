use super::{
    channel::Reading,
    prepared::{Prepared, Tile},
    Source,
};
use crate::{
    field::inheritance::resources::Resource,
    scale::{LengthUnit, MapScale},
    spatial::{SpatialIndex, SpatialKernel},
    storage::Coverage,
};
use atlas_map::{Bounds, Position};
use std::{cell::RefCell, io};

pub struct Sampler<'a> {
    source: &'a Source<'a>,
    value: Reading<'a>,
    sea: Option<Reading<'a>>,
    ice: Option<Reading<'a>>,
    paint: super::paint::Paint<'a>,
    lakes: Box<dyn SpatialIndex + 'a>,
}
fn reading<'a>(
    source: Option<&'a Resource>,
    name: &str,
    storage: &'a RefCell<Coverage>,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Reading<'a>>> {
    source
        .filter(|source| source.channels.contains_key(name))
        .map(|source| Reading::new(source, name, storage, spatial))
        .transpose()
}
impl<'a> Sampler<'a> {
    pub fn new(
        source: &'a Source<'a>,
        storage: &'a RefCell<Coverage>,
        spatial: &'a dyn SpatialKernel,
    ) -> io::Result<Self> {
        let shapes: Vec<_> = source
            .lakes
            .iter()
            .map(|lake| lake.geometry.clone())
            .collect();
        Ok(Self {
            source,
            value: Reading::new(source.field, source.channel, storage, spatial)?,
            sea: reading(source.water, "EffectiveSeaLevel", storage, spatial)?,
            ice: reading(source.ice, "IceThickness", storage, spatial)?,
            paint: super::paint::Paint::new(source, storage, spatial)?,
            lakes: spatial.index(&shapes).map_err(io::Error::other)?,
        })
    }
    pub fn tile(
        &mut self,
        prepared: &Prepared,
        tile: &Tile,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Vec<f32>> {
        let (width, height) = (tile.width, tile.height);
        let points = &tile.points;
        let positions: Vec<_> = points.iter().map(|&[x, y]| Position::xy(x, y)).collect();
        let inside = &tile.inside;
        let step = prepared.grid.pixel_span()[0];
        let locations = prepared.locations(&self.source.field.grid, tile)?;
        let samples = self
            .value
            .batch(points, locations.as_deref(), step, spatial)?;
        if self.source.channel != "Elevation" {
            let mut result = vec![0.0; width * height * 3];
            for i in 0..points.len() {
                let value = samples.values[i] as f32;
                if inside[i] && samples.active[i] && value.is_finite() {
                    result[i * 3..i * 3 + 3].copy_from_slice(&[value, log(samples.values[i]), 1.0]);
                }
            }
            return Ok(result);
        }
        let sea = values(&mut self.sea, points, step, spatial, 0.0)?;
        let ice = values(&mut self.ice, points, step, spatial, 0.0)?;
        let (surface, natural) = self.paint.codes(points, step, spatial)?;
        let marine = self
            .source
            .ocean
            .map(|shape| spatial.covers_points(shape, &positions))
            .transpose()
            .map_err(io::Error::other)?;
        let lakes = self.lake_levels(&positions, spatial)?;
        let mut result = vec![0.0; width * height * 16];
        for i in 0..points.len() {
            if !inside[i] || !samples.active[i] {
                continue;
            }
            let height = samples.values[i];
            let lake = lakes[i]
                .is_some_and(|level| !samples.edited[i] || height < MapScale::native(level));
            let wet = if samples.edited[i] {
                height < sea[i]
            } else {
                marine.as_ref().map_or(height < sea[i], |mask| mask[i])
            };
            let pixel = &mut result[i * 16..i * 16 + 16];
            let color = self.paint.pixel(surface[i], natural[i]);
            pixel.copy_from_slice(&[
                height as f32,
                MapScale::metres(height - sea[i], LengthUnit::Native) as f32,
                if lake { 2.0 } else { u8::from(wet) as f32 },
                (ice[i] / 1000.0).min(1.0) as f32,
                step as f32,
                class(surface[i]),
                class(natural[i]),
                MapScale::metres(samples.display[i], LengthUnit::Native) as f32,
                0.0,
                0.0,
                log(height),
                color[0],
                color[1],
                color[2],
                color[3],
                1.0,
            ]);
            if !pixel.iter().all(|value| value.is_finite()) {
                pixel.fill(0.0)
            }
        }
        gradients(&mut result, width, height);
        Ok(result)
    }
    fn lake_levels(
        &self,
        points: &[Position],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Vec<Option<f64>>> {
        let mut bounds = Bounds(
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for point in points {
            let [x, y, _] = point.coordinates();
            bounds.0 = bounds.0.min(x);
            bounds.1 = bounds.1.min(y);
            bounds.2 = bounds.2.max(x);
            bounds.3 = bounds.3.max(y);
        }
        let mut candidates = self.lakes.query(bounds).map_err(io::Error::other)?;
        candidates.sort_unstable();
        let mut levels = vec![None; points.len()];
        for index in candidates {
            let lake = &self.source.lakes[index];
            let mask = spatial
                .covers_points(&lake.geometry, points)
                .map_err(io::Error::other)?;
            for (level, inside) in levels.iter_mut().zip(mask) {
                if inside {
                    *level = Some(lake.level)
                }
            }
        }
        Ok(levels)
    }
}
fn values(
    reading: &mut Option<Reading<'_>>,
    points: &[[f64; 2]],
    step: f64,
    spatial: &dyn SpatialKernel,
    absent: f64,
) -> io::Result<Vec<f64>> {
    reading.as_mut().map_or_else(
        || Ok(vec![absent; points.len()]),
        |reading| Ok(reading.batch(points, None, step, spatial)?.values),
    )
}
fn class(value: f64) -> f32 {
    if value.is_finite() {
        value as f32
    } else {
        -1.0
    }
}
fn log(value: f64) -> f32 {
    (value.signum() * value.abs().ln_1p()) as f32
}
fn gradients(values: &mut [f32], width: usize, height: usize) {
    for row in 0..height {
        for col in 0..width {
            let cell = row * width + col;
            let at = cell * 16;
            if values[at + 15] == 0.0 {
                continue;
            }
            let step = f64::from(values[at + 4]);
            if step <= 0.0 {
                continue;
            }
            let sample = |cell: usize| {
                if values[cell * 16 + 15] > 0.99 {
                    Some(values[cell * 16 + 7])
                } else {
                    None
                }
            };
            let east = super::super::terrain::difference(
                values[at + 7],
                sample(row * width + col.saturating_sub(1)),
                sample(row * width + (col + 1).min(width - 1)),
                step,
            );
            let north = super::super::terrain::difference(
                values[at + 7],
                sample((row + 1).min(height - 1) * width + col),
                sample(row.saturating_sub(1) * width + col),
                step,
            );
            values[at + 8] = east;
            values[at + 9] = north;
        }
    }
}
