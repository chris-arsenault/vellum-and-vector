use super::state::State;
use crate::{
    lattice::TriangularLattice,
    spatial::{SpatialIndex, SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Position};

pub(super) struct Sites<'a> {
    ids: Vec<usize>,
    index: Option<Box<dyn SpatialIndex + 'a>>,
}
impl<'a> Sites<'a> {
    pub fn new(
        kernel: &'a dyn SpatialKernel,
        mesh: &TriangularLattice,
        state: &State,
        includes: impl Fn(usize) -> bool,
    ) -> SpatialResult<Self> {
        let ids: Vec<_> = (0..state.sites.len()).filter(|&i| includes(i)).collect();
        if ids.is_empty() {
            return Ok(Self { ids, index: None });
        }
        let width = mesh.coordinate_width().unwrap_or(0.0);
        let offsets: &[f64] = if width == 0.0 {
            &[0.0]
        } else {
            &[-width, 0.0, width]
        };
        let mut points = Vec::new();
        for offset in offsets {
            for &id in &ids {
                let [x, y] = state.sites[id].province.position;
                points.push(Geometry::Point {
                    coordinates: Position::xy(mesh.delta_x(x) + offset, y),
                });
            }
        }
        Ok(Self {
            ids,
            index: Some(kernel.index(&points)?),
        })
    }
    pub fn nearest(&self, points: &[Position]) -> SpatialResult<Vec<Option<usize>>> {
        let Some(index) = &self.index else {
            return Ok(vec![None; points.len()]);
        };
        Ok(index
            .nearest_many(points)?
            .into_iter()
            .map(|id| id.map(|id| self.ids[id % self.ids.len()]))
            .collect())
    }
}
