use super::Surface;
use crate::{field::protection::Input, reconstruction::Interpolator, spatial::SpatialKernel};
use atlas_map::Position;
use std::io;

impl Surface {
    /// Restore effective captured samples before a non-workspace publication is observed.
    pub fn compose_authored(
        &mut self,
        inputs: &[Input],
        space: &str,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        if inputs.is_empty() {
            return Ok(());
        }
        let positions = (0..self.active.len())
            .map(|cell| self.grid.position(cell).map(|[x, y]| Position::xy(x, y)))
            .collect::<io::Result<Vec<_>>>()?;
        for input in inputs {
            if input.space.as_ref().is_some_and(|s| s != space) {
                continue;
            }
            let covers = spatial
                .covers_points(&input.footprint, &positions)
                .map_err(io::Error::other)?;
            let source_covers = spatial
                .covers_points(&input.source_footprint, &positions)
                .map_err(io::Error::other)?;
            for name in &input.channels {
                let Some(target) = self.channels.get_mut(name) else {
                    continue;
                };
                let source = input
                    .source
                    .channels
                    .get(name)
                    .filter(|c| c.unit == target.unit)
                    .ok_or_else(|| {
                        io::Error::other(format!("Authored {name} samples must retain their units"))
                    })?;
                let mut sampler = Interpolator::new(
                    &input.source.grid,
                    source.unit == "category",
                    &mut self.coverage,
                );
                for (cell, position) in positions.iter().enumerate() {
                    if !covers[cell] || !source_covers[cell] {
                        continue;
                    }
                    let [x, y, _] = position.coordinates();
                    target.values.write(
                        cell,
                        &[sampler.sample([x, y], &|at| source.values.get(at))?],
                    )?;
                }
            }
        }
        Ok(())
    }
}
