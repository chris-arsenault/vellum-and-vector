//! Current channel reconstruction, including captured patch precedence and density sampling.
use super::{
    mapping::{Location, Mapping},
    Grid, Interpolator,
};
use crate::{
    features::chart::working,
    field::{
        inheritance::resources::{Channel, Resource},
        projection::{channels::Quantity, values::Values},
        schema::NumericValues,
    },
    spatial::SpatialKernel,
    storage::{Coverage, ReadValues},
};
use atlas_map::{Bounds, Geometry, Position};
use std::io;

pub struct Sampler<'a> {
    source: &'a Resource,
    values: NumericValues<'a>,
    measures: ReadValues<'a, f64>,
    base: Interpolator<'a>,
    density: bool,
    overlays: Vec<(Geometry, Sampler<'a>)>,
}
impl<'a> Sampler<'a> {
    pub fn new(
        source: &'a Resource,
        name: &str,
        discrete: bool,
        density: bool,
        coverage: &mut Coverage,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Self> {
        let channel = source
            .channels
            .get(name)
            .ok_or_else(|| io::Error::other(format!("Field channel {name} is unavailable")))?;
        let categorical = discrete
            || ["category", "cell-index"].contains(&channel.unit.as_str())
            || channel.quantity == Quantity::Category
            || (!density && channel.quantity == Quantity::Extensive);
        let overlays = source
            .overlays
            .iter()
            .filter(|overlay| overlay.channels.iter().any(|c| c == name))
            .map(|overlay| {
                let [w, s, e, n] = overlay.resource.grid.bounds;
                let shape = working(
                    &overlay.footprint,
                    Bounds(w, s, e, n),
                    overlay.resource.grid.periodic_width,
                    spatial,
                )
                .map_err(io::Error::other)?;
                Ok((
                    shape,
                    Self::new(
                        &overlay.resource,
                        name,
                        discrete,
                        density,
                        coverage,
                        spatial,
                    )?,
                ))
            })
            .collect::<io::Result<_>>()?;
        Ok(Self {
            source,
            values: channel.values.read_values()?,
            measures: source.grid.measures.read_values()?,
            base: Interpolator::new(&source.grid, categorical, coverage),
            density,
            overlays,
        })
    }
    /// Inputs stay borrowed across the batch; overlays use the shared spatial kernel.
    pub fn batch(
        &mut self,
        points: &[[f64; 2]],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Vec<f64>> {
        self.sample_batch(points, None, spatial)
    }
    pub fn sample_batch(
        &mut self,
        points: &[[f64; 2]],
        mapped: Option<&[Location]>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Vec<f64>> {
        let mut result = points
            .iter()
            .enumerate()
            .map(|(i, &point)| {
                let read = |cell| {
                    let value = self.values.get(cell)?;
                    if !self.density {
                        return Ok(value);
                    }
                    let area = self.measures.get(cell)?;
                    Ok(if area > 0.0 { value / area } else { 0.0 })
                };
                match mapped {
                    Some(locations) => self.base.sample_mapped(locations[i], &read),
                    None => self.base.sample(point, &read),
                }
            })
            .collect::<io::Result<Vec<_>>>()?;
        // Later overlays win, just as the source's reversed first-match lookup does.
        for (footprint, sampler) in &mut self.overlays {
            let charted = points
                .iter()
                .map(|&point| {
                    let [x, y] = sampler.source.grid.chart(point);
                    Position::xy(x, y)
                })
                .collect::<Vec<_>>();
            let covered = spatial
                .covers_points(footprint, &charted)
                .map_err(io::Error::other)?;
            let selected = points
                .iter()
                .zip(&covered)
                .filter_map(|(&p, &yes)| yes.then_some(p))
                .collect::<Vec<_>>();
            let values = sampler.batch(&selected, spatial)?;
            let mut values = values.into_iter();
            for (index, yes) in covered.into_iter().enumerate() {
                if yes {
                    result[index] = values.next().expect("One value per covered sample");
                }
            }
        }
        Ok(result)
    }
}
pub fn channel(
    source: &Resource,
    name: &str,
    target: &Grid,
    mapping: &Mapping,
    coverage: &mut Coverage,
    spatial: &dyn SpatialKernel,
) -> io::Result<Channel> {
    let original = source
        .channels
        .get(name)
        .ok_or_else(|| io::Error::other(format!("Field channel {name} is unavailable")))?;
    let extensive = original.quantity == Quantity::Extensive;
    let mut sampler = Sampler::new(source, name, false, extensive, coverage, spatial)?;
    let mut values = if extensive {
        Values::F64(coverage.allocate(0.0))
    } else {
        Values::like(&original.values, coverage)
    };
    for start in (0..target.measures.len()).step_by(4096) {
        let end = (start + 4096).min(target.measures.len());
        let points = (start..end)
            .map(|i| target.position(i))
            .collect::<io::Result<Vec<_>>>()?;
        let locations = mapping.batch(start, end - start)?;
        values.write(
            start,
            &sampler.sample_batch(&points, Some(&locations), spatial)?,
        )?;
    }
    if extensive {
        let density = values.read();
        values = Values::like(&original.values, coverage);
        for start in (0..density.len()).step_by(4096) {
            let end = (start + 4096).min(density.len());
            let amounts = (start..end)
                .map(|i| Ok(density.get(i)? * target.measures.get(i)?))
                .collect::<io::Result<Vec<_>>>()?;
            values.write(start, &amounts)?;
        }
    }
    Ok(Channel {
        values: values.read(),
        unit: original.unit.clone(),
        quantity: original.quantity,
    })
}
