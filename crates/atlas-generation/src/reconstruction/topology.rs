//! Captured adaptive resource topology, not a second generation lattice.
use crate::storage::{Coverage, ReadBand};
use std::{io, rc::Rc};
#[derive(Clone)]
pub struct Topology {
    pub bounds: [f64; 4],
    pub boxes: ReadBand<f64>,
    pub children: ReadBand<i32>,
    pub levels: ReadBand<u32>,
    pub leaves: ReadBand<u32>,
    pub leaf_index: ReadBand<i32>,
    pub offsets: ReadBand<u32>,
    pub neighbors: ReadBand<u32>,
    pub face_lengths: ReadBand<f64>,
    pub distances: ReadBand<f64>,
    pub direction_x: ReadBand<f64>,
    pub direction_y: ReadBand<f64>,
    pub normal_x: ReadBand<i8>,
    pub normal_y: ReadBand<i8>,
    pub vertices: Rc<super::vertices::Vertices>,
    pub coverage: Rc<Coverage>,
}
pub struct Vertex {
    pub point: [f64; 2],
    pub epsilon: f64,
    pub cells: Vec<usize>,
    pub hanging: Option<usize>,
    pub coarse: Option<usize>,
}
impl Topology {
    /// Resolve a point batch with one borrow of each immutable tree array.
    pub fn locations(&self, points: &[[f64; 2]]) -> io::Result<Vec<super::mapping::Location>> {
        let boxes = self.boxes.read_values()?;
        let children = self.children.read_values()?;
        let indices = self.leaf_index.read_values()?;
        let [w, s, e, n] = self.bounds;
        points
            .iter()
            .map(|&[x, y]| {
                let (x, y) = (x.clamp(w, e), y.clamp(s, n));
                let mut node = 0;
                loop {
                    let at = node * 4;
                    let b = [
                        boxes.get(at)?,
                        boxes.get(at + 1)?,
                        boxes.get(at + 2)?,
                        boxes.get(at + 3)?,
                    ];
                    let child = children.get(node)?;
                    if child < 0 {
                        return Ok(super::mapping::Location {
                            cell: usize::try_from(indices.get(node)?).map_err(io::Error::other)?,
                            x: (x - b[0]) / (b[2] - b[0]),
                            y: (y - b[1]) / (b[3] - b[1]),
                        });
                    }
                    node = child as usize
                        + usize::from(x >= (b[0] + b[2]) / 2.0)
                        + 2 * usize::from(y >= (b[1] + b[3]) / 2.0);
                }
            })
            .collect()
    }
    pub(super) fn corner(&self, cell: usize, point: [f64; 2], epsilon: f64) -> io::Result<Vertex> {
        let Some(at) = self.corner_index(cell, point)? else {
            return self.vertex(point, epsilon);
        };
        if let Some(vertex) = self.vertices.get(at, point, epsilon)? {
            return Ok(vertex);
        }
        let vertex = self.vertex(point, epsilon)?;
        self.vertices.put(at, &vertex)?;
        Ok(vertex)
    }
    fn corner_index(&self, cell: usize, point: [f64; 2]) -> io::Result<Option<usize>> {
        let [west, south, east, north] = self.cell(cell)?;
        Ok(
            ((point[0] == west || point[0] == east) && (point[1] == south || point[1] == north))
                .then_some(
                    cell * 4 + usize::from(point[0] == east) + 2 * usize::from(point[1] == north),
                ),
        )
    }
    /// Incident cells have a stable traversal order. The first actual corner gives all
    /// readers of the same vertex one dense identity, including at a coarse/fine edge.
    pub(super) fn vertex_key(&self, vertex: &Vertex) -> io::Result<Option<usize>> {
        for &cell in &vertex.cells {
            if let Some(key) = self.corner_index(cell, vertex.point)? {
                return Ok(Some(key));
            }
        }
        Ok(None)
    }
    /// Stream the captured tree's overlapping leaves with a stack proportional to depth.
    pub fn visit_overlap(
        &self,
        bounds: [f64; 4],
        mut visit: impl FnMut(usize) -> io::Result<()>,
    ) -> io::Result<()> {
        let mut pending = vec![0];
        while let Some(node) = pending.pop() {
            let b = self.node(node)?;
            if b[0] >= bounds[2] || b[2] <= bounds[0] || b[1] >= bounds[3] || b[3] <= bounds[1] {
                continue;
            }
            let child = self.children.get(node)?;
            if child < 0 {
                visit(self.leaf_index.get(node)? as usize)?;
            } else {
                pending.extend((child as usize)..(child as usize + 4));
            }
        }
        Ok(())
    }
    pub fn cell(&self, leaf: usize) -> io::Result<[f64; 4]> {
        self.node(self.leaves.get(leaf)? as usize)
    }
    fn node(&self, node: usize) -> io::Result<[f64; 4]> {
        let at = node * 4;
        Ok([
            self.boxes.get(at)?,
            self.boxes.get(at + 1)?,
            self.boxes.get(at + 2)?,
            self.boxes.get(at + 3)?,
        ])
    }
    pub fn at(&self, [x, y]: [f64; 2]) -> io::Result<Option<usize>> {
        let [x0, y0, x1, y1] = self.bounds;
        if !x.is_finite() || !y.is_finite() || x < x0 || x > x1 || y < y0 || y > y1 {
            return Ok(None);
        }
        let mut node = 0;
        loop {
            let child = self.children.get(node)?;
            if child < 0 {
                break;
            }
            let b = self.node(node)?;
            node = child as usize
                + usize::from(x >= (b[0] + b[2]) / 2.0)
                + 2 * usize::from(y >= (b[1] + b[3]) / 2.0);
        }
        let leaf = self.leaf_index.get(node)?;
        Ok((leaf >= 0).then_some(leaf as usize))
    }
    pub fn vertex(&self, point: [f64; 2], epsilon: f64) -> io::Result<Vertex> {
        let [x, y] = point;
        let mut cells = Vec::with_capacity(4);
        for dx in [-epsilon, epsilon] {
            for dy in [-epsilon, epsilon] {
                if let Some(leaf) = self.at([x + dx, y + dy])? {
                    if !cells.contains(&leaf) {
                        cells.push(leaf);
                    }
                }
            }
        }
        let mut hanging = None;
        let mut coarse = None;
        let mut level = u32::MAX;
        for &cell in &cells {
            let b = self.cell(cell)?;
            if (x > b[0] && x < b[2]) || (y > b[1] && y < b[3]) {
                hanging.get_or_insert(cell);
                let candidate = self.levels.get(self.leaves.get(cell)? as usize)?;
                if candidate < level {
                    coarse = Some(cell);
                    level = candidate;
                }
            }
        }
        Ok(Vertex {
            point,
            epsilon,
            cells,
            hanging,
            coarse,
        })
    }
}
