use super::{Grid, Interpolator};
use crate::storage::{Coverage, ReadBand, ReadValues};
use std::io;
/// Prepared geometry coverage is supplied by the shared spatial adapter.
pub struct Surface<'a> {
    pub grid: &'a Grid,
    pub values: ReadBand<f64>,
    pub overlays: Vec<Overlay<'a>>,
}
pub struct Overlay<'a> {
    pub surface: Surface<'a>,
    pub covers: &'a dyn Fn([f64; 2]) -> io::Result<bool>,
}
pub struct Sampler<'a> {
    source: &'a Surface<'a>,
    values: ReadValues<'a, f64>,
    measures: ReadValues<'a, f64>,
    base: Interpolator<'a>,
    density: bool,
    overlays: Vec<Sampler<'a>>,
}
impl<'a> Sampler<'a> {
    pub fn new(
        source: &'a Surface<'a>,
        discrete: bool,
        density: bool,
        coverage: &mut Coverage,
    ) -> io::Result<Self> {
        Ok(Self {
            source,
            values: source.values.read_values()?,
            measures: source.grid.measures.read_values()?,
            base: Interpolator::new(source.grid, discrete, coverage),
            density,
            overlays: source
                .overlays
                .iter()
                .map(|o| Self::new(&o.surface, discrete, density, coverage))
                .collect::<io::Result<_>>()?,
        })
    }
    pub fn sample(&mut self, point: [f64; 2]) -> io::Result<f64> {
        for (overlay, sampler) in self.source.overlays.iter().zip(&mut self.overlays).rev() {
            if (overlay.covers)(overlay.surface.grid.chart(point))? {
                return sampler.sample(point);
            }
        }
        self.base.sample(point, &|cell| {
            let value = self.values.get(cell)?;
            if !self.density {
                return Ok(value);
            }
            let area = self.measures.get(cell)?;
            Ok(if area > 0.0 { value / area } else { 0.0 })
        })
    }
}
