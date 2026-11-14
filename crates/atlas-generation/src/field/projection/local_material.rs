use super::{
    local_magic::{sources, Activity},
    ProjectedChannel, Quantity, Surface, Values,
};
use crate::{
    atlas::history::Cause,
    field::{landmarks::magic::Source, shared::CellCode, Field},
    reconstruction::Interpolator,
    spatial::SpatialKernel,
};
use atlas_map::{Geometry, Position};
use std::io;

impl Surface {
    pub fn local_material(
        &mut self,
        definitions: &[Source],
        space: &str,
        activity: &Activity,
        spatial: &dyn SpatialKernel,
        react: bool,
    ) -> io::Result<(Vec<Cause>, Vec<String>)> {
        let mut pressure = self.coverage.allocate(0.0);
        let mut causes = Vec::new();
        let mut altered = Vec::new();
        for source in sources(definitions, space, false) {
            let values = self.local_forcing(source, activity, spatial, true)?;
            let key = format!("magic:{}", source.id);
            if source.effect == "erosionResistance" && react {
                altered.push(key.clone());
            }
            if source.effect == "pressure" {
                for cell in 0..values.len() {
                    pressure.set(cell, pressure.get(cell)? + values.get(cell)?.abs())?;
                }
            }
            self.put(&key, "ratio", Quantity::Intensive, Values::F64(values));
            let summary = self.summarize_channel(&key)?;
            causes.push(Cause::Magic {
                process: "magic.material".into(),
                source_id: source.id.clone(),
                activity: 1.0,
                forcing: summary.clone(),
                stored: summary,
            });
        }
        self.put(
            "CoastalPressure",
            "ratio",
            Quantity::Intensive,
            Values::F64(pressure),
        );
        Ok((causes, altered))
    }
    pub fn advect_local_magic(
        &mut self,
        field: &Field,
        footprint: &Geometry,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        let histories = self
            .channels
            .keys()
            .filter(|name| name.starts_with("magic:") && name.ends_with(":stored"))
            .cloned()
            .collect::<Vec<_>>();
        if histories.is_empty() {
            return Ok(());
        }
        let samples = self.samples();
        let sources = field.shared().code(CellCode::AdvectionSourceIndex);
        let mesh = field.mesh();
        let [ox, oy] = mesh.origin();
        let mut positions = Vec::with_capacity(samples.len());
        let mut present = Vec::with_capacity(samples.len());
        for sample in 0..samples.len() {
            let cell = samples.get(sample)?;
            let source = if cell < 0 {
                -1
            } else {
                sources.get(cell as usize)?
            };
            present.push(source >= 0);
            if source >= 0 {
                if source as usize >= mesh.len() {
                    return Err(io::Error::other(
                        "Magic advection source is outside the physical lattice",
                    ));
                }
                let [x, y] = mesh.position(source as usize);
                positions.push(Position::xy(ox + x, oy + y));
            } else {
                positions.push(Position::xy(ox, oy));
            }
        }
        let covered = spatial
            .covers_points(footprint, &positions)
            .map_err(io::Error::other)?;
        for name in histories {
            let old = &self.channels[&name];
            let unit = old.unit.clone();
            let previous = old.values();
            let mut sampler = Interpolator::new(&self.grid, false, &mut self.coverage);
            let mut moved = self.coverage.allocate(0.0);
            for cell in 0..moved.len() {
                if present[cell] && covered[cell] {
                    let [x, y, _] = positions[cell].coordinates();
                    moved.set(cell, sampler.sample([x, y], &|at| previous.get(at))?)?;
                }
            }
            self.channels.insert(
                name,
                ProjectedChannel {
                    unit,
                    quantity: Quantity::Intensive,
                    values: Values::F64(moved),
                },
            );
        }
        Ok(())
    }
}
