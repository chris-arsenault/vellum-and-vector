//! Choose class identities before applying natural colours and magical tints.
use super::{channel::Reading, colors::Colors, Source};
use crate::{spatial::SpatialKernel, storage::Coverage};
use std::{cell::RefCell, io};

pub struct Paint<'a> {
    surface: Option<Reading<'a>>,
    natural: Option<Reading<'a>>,
    colors: Colors,
}
impl<'a> Paint<'a> {
    pub fn new(
        source: &'a Source<'a>,
        storage: &'a RefCell<Coverage>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Self> {
        let reading = |name| {
            source
                .surface
                .filter(|s| s.channels.contains_key(name))
                .map(|s| Reading::new(s, name, storage, spatial))
                .transpose()
        };
        Ok(Self {
            surface: reading("finalSurface")?,
            natural: reading("naturalSurface")?,
            colors: Colors::new(source.colors)?,
        })
    }
    pub fn codes(
        &mut self,
        points: &[[f64; 2]],
        step: f64,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<(Vec<f64>, Vec<f64>)> {
        let values = |reading: &mut Option<Reading<'_>>| -> io::Result<Vec<f64>> {
            reading.as_mut().map_or_else(
                || Ok(vec![-1.0; points.len()]),
                |r| Ok(r.batch(points, None, step, spatial)?.values),
            )
        };
        Ok((values(&mut self.surface)?, values(&mut self.natural)?))
    }
    pub fn pixel(&self, surface: f64, natural: f64) -> [f32; 4] {
        // owner-direction(2026-11-17): the deployed version must look like the approved surface screenshots
        self.colors.pixel(surface, natural)
    }
}
