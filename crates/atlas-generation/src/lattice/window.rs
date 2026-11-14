use super::TriangularLattice;
use atlas_map::Bounds;

impl TriangularLattice {
    /// Centroid candidates from the lattice address index, in the source's address order.
    pub fn window_cells(&self, bounds: Bounds) -> Vec<usize> {
        let origin = self.origin();
        let offset = self.offset();
        let x0 = (bounds.0 - origin[0] - offset[0]) / self.spacing();
        let x1 = (bounds.2 - origin[0] - offset[0]) / self.spacing();
        let scale_y = 3.0f64.sqrt() * self.spacing_y() / 2.0;
        let d0 = (bounds.1 - origin[1] - offset[1]) / scale_y;
        let d1 = (bounds.3 - origin[1] - offset[1]) / scale_y;
        let mut found = Vec::new();
        for inverted in [false, true] {
            let shift = if inverted { 2.0 } else { 1.0 };
            let s0 = (x0 - shift) / 1.5;
            let s1 = (x1 - shift) / 1.5;
            let first = ((s0 - d1) / 2.0).floor() as i32 - 1;
            let last = ((s1 - d0) / 2.0).ceil() as i32 + 1;
            for u in first..=last {
                let low = (s0 - f64::from(u)).max(d0 + f64::from(u)).floor() as i32 - 1;
                let high = (s1 - f64::from(u)).min(d1 + f64::from(u)).ceil() as i32 + 1;
                for v in low..=high {
                    if let Some(cell) = self.window_cell(u, v, inverted, bounds) {
                        found.push(cell);
                    }
                }
            }
        }
        found
    }
    fn window_cell(&self, u: i32, v: i32, inverted: bool, bounds: Bounds) -> Option<usize> {
        let cell = self.address_cell(u, v, inverted)?;
        if self.address(cell) != (u, v, inverted) {
            return None;
        }
        let p = self.position(cell);
        let origin = self.origin();
        let [x, y] = [p[0] + origin[0], p[1] + origin[1]];
        (x >= bounds.0 && x <= bounds.2 && y >= bounds.1 && y <= bounds.3).then_some(cell)
    }
}
