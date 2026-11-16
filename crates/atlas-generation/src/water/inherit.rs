//! Resolve captured rivers onto the child's own lattice without constraining later geography.
use super::{
    balance::MONTHS,
    captured::{DrainageNetwork, RetainedRiver, RiverIdentity},
    import_geometry::{ImportGeometry, Stations},
    reaches::{BoundaryEntry, FormerCourse, Reach, ReachStore},
};
use crate::{
    lattice::TriangularLattice,
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Position};
// hpc-exempt: sparse retained reach IDs, independent of numerical cell count
type ImportedReaches = std::collections::BTreeMap<usize, Imported>;

struct Imported {
    ids: Vec<usize>,
    outlet: Option<usize>,
}
pub struct RiverInheritance<'a> {
    pub mesh: &'a TriangularLattice,
    pub spatial: &'a dyn SpatialKernel,
    pub elevation: &'a dyn Fn(usize) -> SpatialResult<f64>,
}
impl ReachStore {
    /// Install captured supply and independently owned courses once. Projection belongs to the field.
    pub fn inherit(
        &mut self,
        input: &DrainageNetwork,
        context: RiverInheritance<'_>,
        feature: impl Fn(&str) -> Option<RiverIdentity>,
    ) -> SpatialResult<()> {
        if self.reaches().next().is_some() || !self.entries.is_empty() || !input.input {
            return Ok(());
        }
        let geometry = ImportGeometry::new(context.mesh, context.spatial);
        if let Some(kept) = &input.kept {
            for entry in &kept.entries {
                if let Some(cell) = geometry.cell(entry.position) {
                    self.entries.push(BoundaryEntry {
                        cell,
                        monthly: entry.monthly,
                        catchment: entry.catchment,
                    });
                }
            }
        }
        let records = input.inputs(&feature);
        let mut imported = ImportedReaches::new();
        for record in &records {
            imported.insert(
                record.id,
                self.import_record(record, &geometry, context.elevation)?,
            );
        }
        for record in &records {
            self.link_junction(record, &imported, &geometry)?;
        }
        Ok(())
    }
    fn link_junction(
        &mut self,
        input: &RetainedRiver,
        imported: &ImportedReaches,
        geometry: &ImportGeometry<'_>,
    ) -> SpatialResult<()> {
        let Some(outlet) = imported.get(&input.id).and_then(|i| i.outlet) else {
            return Ok(());
        };
        let (Some(downstream), Some(junction)) = (input.downstream, input.junction) else {
            return Ok(());
        };
        let Some(cell) = geometry.cell(junction) else {
            return Ok(());
        };
        let receiving = imported.get(&downstream).and_then(|i| {
            i.ids
                .iter()
                .copied()
                .find(|&id| self.get(id).unwrap().cells.first() == Some(&cell))
        });
        let reach = self.get_mut(outlet).unwrap();
        if let (Some(receiving), Some(&last)) = (receiving, reach.cells.last()) {
            if (0..3).any(|edge| geometry.mesh.neighbor(last, edge) == Some(cell)) {
                reach.downstream = Some(receiving);
            }
        }
        Ok(())
    }
    fn import_record(
        &mut self,
        input: &RetainedRiver,
        geometry: &ImportGeometry<'_>,
        elevation: &dyn Fn(usize) -> SpatialResult<f64>,
    ) -> SpatialResult<Imported> {
        let mut imported = Imported {
            ids: Vec::new(),
            outlet: None,
        };
        if let Some(directed) = input.directed() {
            for line in geometry.clipped(&directed.course)? {
                imported.outlet = self.import_line(&directed, &line, geometry, elevation)?;
                if let Some(id) = imported.outlet {
                    imported.ids.push(id);
                }
            }
        } else if let Some(id) = self.import_point(input, geometry, elevation)? {
            imported.ids.push(id);
        }
        if match input.junction {
            Some(junction) => geometry.cell(junction).is_none(),
            None => true,
        } {
            imported.outlet = None;
        }
        if !imported.ids.is_empty() {
            return Ok(imported);
        }
        for former in &input.former {
            let mut dry = input.clone();
            dry.course = former.course.clone();
            dry.junction = None;
            dry.downstream = None;
            dry.dry = true;
            dry.dried_in = Some(former.left_in);
            dry.flow = 0.0;
            dry.least = 0.0;
            dry.flood = 0.0;
            dry.months = 0;
            dry.monthly = vec![0.0; former.course.len() * MONTHS];
            dry.bed.clear();
            dry.width.clear();
            dry.depth.clear();
            dry.leakage.clear();
            dry.catchment.clear();
            dry.former.clear();
            for line in geometry.clipped(&former.course)? {
                self.import_line(&dry, &line, geometry, elevation)?;
            }
        }
        // Former paths have no present downstream relationship.
        Ok(imported)
    }
    fn import_line(
        &mut self,
        input: &RetainedRiver,
        line: &[Position],
        geometry: &ImportGeometry<'_>,
        elevation: &dyn Fn(usize) -> SpatialResult<f64>,
    ) -> SpatialResult<Option<usize>> {
        let sampled = geometry.sampled(line)?;
        let mut cells: Vec<_> = sampled
            .iter()
            .enumerate()
            .filter_map(|(at, cell)| cell.filter(|_| at == 0 || *cell != sampled[at - 1]))
            .collect();
        if let Some(junction) = input.junction {
            if cells.last().copied() == geometry.cell(junction) {
                cells.pop();
            }
        }
        if cells.is_empty() {
            return Ok(None);
        }
        let id = self.initialize(input, cells, geometry)?;
        let reach = self.get_mut(id).unwrap();
        let target: Vec<_> = reach
            .cells
            .iter()
            .map(|&cell| geometry.position(cell))
            .collect();
        let stations = Stations::new(geometry.spatial, &input.course, &target)?;
        for month in 0..MONTHS {
            let profile: Vec<_> = input
                .course
                .iter()
                .enumerate()
                .map(|(at, _)| {
                    input
                        .monthly
                        .get(at * MONTHS + month)
                        .copied()
                        .unwrap_or(f64::NAN)
                })
                .collect();
            for (at, value) in stations.interpolate(&profile)?.into_iter().enumerate() {
                reach.monthly[at * MONTHS + month] = if input.dry { 0.0 } else { value };
            }
        }
        import_profiles(reach, input, &stations, elevation)?;
        if !input.dry
            && geometry.spatial.line_fraction(
                &Geometry::LineString {
                    coordinates: input.course.clone(),
                },
                line[0],
            )? > 0.0
        {
            let entry = BoundaryEntry {
                cell: reach.cells[0],
                monthly: reach.monthly[..MONTHS].try_into().unwrap(),
                catchment: reach.catchment[0],
            };
            self.entries.push(entry);
        }
        Ok(Some(id))
    }
    fn import_point(
        &mut self,
        input: &RetainedRiver,
        geometry: &ImportGeometry<'_>,
        elevation: &dyn Fn(usize) -> SpatialResult<f64>,
    ) -> SpatialResult<Option<usize>> {
        if input.course.len() != 1 {
            return Ok(None);
        }
        let Some(cell) = geometry.cell(input.course[0]) else {
            return Ok(None);
        };
        let id = self.initialize(input, vec![cell], geometry)?;
        let reach = self.get_mut(id).unwrap();
        if !input.dry {
            if input.monthly.len() > MONTHS {
                return Err("An isolated river sample holds at most twelve months".into());
            }
            reach.monthly[..input.monthly.len()].copy_from_slice(&input.monthly);
        }
        reach.bed[0] = match input.bed.first() {
            Some(&bed) => bed,
            None => elevation(cell)?,
        };
        for (target, source) in [
            (&mut reach.width, &input.width),
            (&mut reach.depth, &input.depth),
            (&mut reach.leakage, &input.leakage),
            (&mut reach.catchment, &input.catchment),
        ] {
            target[0] = source.first().copied().unwrap_or(0.0);
        }
        Ok(Some(id))
    }
    fn initialize(
        &mut self,
        input: &RetainedRiver,
        cells: Vec<usize>,
        geometry: &ImportGeometry<'_>,
    ) -> SpatialResult<usize> {
        let id = self.add(cells);
        let reach = self.get_mut(id).unwrap();
        reach.order = input.order;
        reach.dry = input.dry;
        reach.dried_in = input.dried_in;
        reach.drawn = input.drawn;
        reach.river = input.river.clone();
        reach.name = input.name.clone();
        reach.record = input
            .river
            .as_ref()
            .map(|id| format!("river:{id}:0"))
            .or_else(|| input.record.clone());
        reach.months = input.months;
        reach.flow = input.flow;
        reach.least = input.least;
        reach.flood = input.flood;
        for former in &input.former {
            for line in geometry.clipped(&former.course)? {
                reach.former.push(FormerCourse {
                    cells: geometry.sampled(&line)?.into_iter().flatten().collect(),
                    left_in: former.left_in,
                });
            }
        }
        Ok(id)
    }
}
fn import_profiles(
    reach: &mut Reach,
    input: &RetainedRiver,
    stations: &Stations,
    elevation: &dyn Fn(usize) -> SpatialResult<f64>,
) -> SpatialResult<()> {
    for (target, source) in [
        (&mut reach.bed, &input.bed),
        (&mut reach.width, &input.width),
        (&mut reach.depth, &input.depth),
        (&mut reach.leakage, &input.leakage),
        (&mut reach.catchment, &input.catchment),
    ] {
        if !source.is_empty() {
            *target = stations.interpolate(source)?;
        }
    }
    if input.bed.is_empty() {
        reach.bed = reach
            .cells
            .iter()
            .map(|&cell| elevation(cell))
            .collect::<SpatialResult<_>>()?;
    }
    Ok(())
}
