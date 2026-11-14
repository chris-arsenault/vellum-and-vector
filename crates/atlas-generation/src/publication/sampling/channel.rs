use super::display;
use crate::{
    features::chart::working,
    field::{
        inheritance::resources::Resource, projection::channels::Quantity, schema::NumericValues,
    },
    reconstruction::{classes, mapping::Location, Interpolator, Layout},
    spatial::SpatialKernel,
    storage::{Coverage, ReadValues},
};
use atlas_map::{Bounds, Geometry, Position};
use std::{cell::RefCell, io};

enum Interpolation<'a> {
    Continuous(Interpolator<'a>),
    Class(classes::Sampler<'a>),
}
pub struct Reading<'a> {
    source: &'a Resource,
    values: NumericValues<'a>,
    active: ReadValues<'a, u8>,
    interpolation: Interpolation<'a>,
    overlays: Vec<(Geometry, Reading<'a>)>,
    display: Option<display::Display<'a>>,
}
pub struct Samples {
    pub values: Vec<f64>,
    pub active: Vec<bool>,
    pub edited: Vec<bool>,
    pub display: Vec<f64>,
}
impl<'a> Reading<'a> {
    pub fn new(
        source: &'a Resource,
        name: &str,
        coverage: &'a RefCell<Coverage>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Self> {
        let values = source
            .channels
            .get(name)
            .ok_or_else(|| io::Error::other(format!("Publication requires {name}")))?;
        let category = values.quantity == Quantity::Category
            || matches!(values.unit.as_str(), "category" | "cell-index");
        let interpolation = if category {
            Interpolation::Class(classes::Sampler::new(
                &classes::Surface {
                    grid: &source.grid,
                    values: values.values.clone(),
                    active: source.active.clone(),
                    overlays: Vec::new(),
                },
                coverage,
            ))
        } else {
            Interpolation::Continuous(Interpolator::new(
                &source.grid,
                values.quantity == Quantity::Extensive,
                &mut coverage.borrow_mut(),
            ))
        };
        let overlays = source
            .overlays
            .iter()
            .filter(|o| o.channels.iter().any(|c| c == name))
            .map(|o| {
                let [w, s, e, n] = o.resource.grid.bounds;
                let footprint = working(
                    &o.footprint,
                    Bounds(w, s, e, n),
                    o.resource.grid.periodic_width,
                    spatial,
                )
                .map_err(io::Error::other)?;
                Ok((footprint, Self::new(&o.resource, name, coverage, spatial)?))
            })
            .collect::<io::Result<_>>()?;
        Ok(Self {
            source,
            values: values.values.read_values()?,
            active: source.active.read_values()?,
            interpolation,
            overlays,
            display: (name == "Elevation").then(|| display::Display::new(source)),
        })
    }
    fn value(
        &mut self,
        point: [f64; 2],
        mapped: Option<Location>,
        pixel_span: f64,
    ) -> io::Result<f64> {
        if self.overlays.is_empty() {
            if let Layout::Adaptive(tree) = &self.source.grid.layout {
                let [w, s, e, n] = tree.bounds;
                let point = [point[0].clamp(w, e), point[1].clamp(s, n)];
                let cell = match mapped {
                    Some(at) => Some(at.cell),
                    None => tree.at(point)?,
                };
                if let Some(cell) = cell {
                    let bounds = tree.cell(cell)?;
                    if bounds[2] - bounds[0] < 1.5 * pixel_span {
                        return self.values.get(cell);
                    }
                }
            }
        }
        match &mut self.interpolation {
            Interpolation::Continuous(sampler) => match mapped {
                Some(at) => sampler.sample_mapped(at, &|cell| self.values.get(cell)),
                None => sampler.sample(point, &|cell| self.values.get(cell)),
            },
            Interpolation::Class(sampler) => sampler.sample(point, None),
        }
    }
    pub fn batch(
        &mut self,
        points: &[[f64; 2]],
        locations: Option<&[Location]>,
        pixel_span: f64,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Samples> {
        let mut samples = Samples {
            values: Vec::with_capacity(points.len()),
            active: Vec::with_capacity(points.len()),
            edited: vec![false; points.len()],
            display: Vec::with_capacity(points.len()),
        };
        for (i, &point) in points.iter().enumerate() {
            let point = self.source.grid.chart(point);
            let value = self.value(point, locations.map(|locations| locations[i]), pixel_span)?;
            samples.values.push(value);
            samples.active.push(self.active(point)?);
            samples
                .display
                .push(if let Some(display) = &mut self.display {
                    display.sample(point, value)?
                } else {
                    value
                });
        }
        for (footprint, overlay) in &mut self.overlays {
            let charted: Vec<_> = points
                .iter()
                .map(|&p| {
                    let [x, y] = overlay.source.grid.chart(p);
                    Position::xy(x, y)
                })
                .collect();
            let covered = spatial
                .covers_points(footprint, &charted)
                .map_err(io::Error::other)?;
            let indices: Vec<_> = covered
                .iter()
                .enumerate()
                .filter_map(|(i, yes)| yes.then_some(i))
                .collect();
            let selected: Vec<_> = indices.iter().map(|&i| points[i]).collect();
            let patch = overlay.batch(&selected, None, pixel_span, spatial)?;
            for (offset, cell) in indices.into_iter().enumerate() {
                samples.values[cell] = patch.values[offset];
                samples.active[cell] = patch.active[offset];
                samples.edited[cell] = true;
                samples.display[cell] = patch.display[offset];
            }
        }
        Ok(samples)
    }
    fn active(&self, point: [f64; 2]) -> io::Result<bool> {
        if let Layout::Adaptive(tree) = &self.source.grid.layout {
            return tree
                .at(point)?
                .map_or(Ok(false), |i| Ok(self.active.get(i)? == 1));
        }
        let [w, s, e, n] = self.source.grid.bounds;
        if point[0] < w || point[0] > e || point[1] < s || point[1] > n {
            return Ok(false);
        }
        Ok(self.active.get(self.source.grid.sample_index(point)?)? == 1)
    }
}
