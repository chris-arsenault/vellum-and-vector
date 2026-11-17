//! Finite triangular control-volume overlap from world/triangleOverlap.ts.
use crate::{
    hpc::SmallIntSet,
    lattice::{Ghost, TriangularLattice},
    tectonics::transport::SourceMotion,
};
type Point = [f64; 2];

fn triangle(mesh: &TriangularLattice, inverted: bool, [x, y]: Point) -> [Point; 3] {
    let sign = if inverted { 1.0 } else { -1.0 };
    let sx = mesh.spacing();
    let sy = if mesh.closed_poles() {
        mesh.spacing_y()
    } else {
        sx
    };
    [
        [x + sign * sx, y],
        [x - sign * sx / 2.0, y + sign * 3.0_f64.sqrt() * sy / 2.0],
        [x - sign * sx / 2.0, y - sign * 3.0_f64.sqrt() * sy / 2.0],
    ]
}
fn area(points: &[Point]) -> f64 {
    let Some(a) = points.first() else {
        return 0.0;
    };
    let mut sum = 0.0;
    for pair in points[1..].windows(2) {
        let [b, c] = [pair[0], pair[1]];
        sum += (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    }
    sum.abs() / 2.0
}
fn clip(points: &[Point], a: Point, b: Point) -> Vec<Point> {
    let signed = |p: Point| (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    let mut result = Vec::new();
    for i in 0..points.len() {
        let p = points[i];
        let q = points[(i + 1) % points.len()];
        let first = signed(p);
        let second = signed(q);
        if first >= 0.0 {
            result.push(p);
        }
        if (first >= 0.0) != (second >= 0.0) {
            let t = first / (first - second);
            result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
    }
    result
}
fn covered(mesh: &TriangularLattice, cell: usize, polygon: &[Point], [x, y]: Point) -> f64 {
    let center = mesh.position(cell);
    let cx = x + mesh.delta_x(center[0] - x);
    if (cx - x).abs() > mesh.spacing() * 2.0 || (center[1] - y).abs() > mesh.spacing() * 2.0 {
        return 0.0;
    }
    let target = triangle(mesh, mesh.inverted(cell), [cx, center[1]]);
    let mut result = polygon.to_vec();
    for i in 0..3 {
        result = clip(&result, target[i], target[(i + 1) % 3]);
    }
    if result.len() >= 3 {
        area(&result)
    } else {
        0.0
    }
}
/// None selects the source's topology scatter at a reflected pole.
pub fn triangle_overlap(
    mesh: &TriangularLattice,
    source: usize,
    center: Point,
    motion: &SourceMotion<'_>,
) -> Option<Vec<(usize, f64)>> {
    if mesh.closed_poles() {
        let reach = 3.0_f64.sqrt() * mesh.spacing_y();
        if center[1].abs() + reach >= mesh.bounds().3
            || mesh.position(source)[1].abs() + reach >= mesh.bounds().3
        {
            return None;
        }
    }
    Some(overlap_from(
        mesh,
        mesh.inverted(source),
        mesh.position(source),
        center,
        motion,
    ))
}
/// Zero-gradient inflow: a ghost beyond the edge carries its owner's column with its owner's
/// motion; whatever it covers on the map arrives from that edge cell.
pub fn ghost_overlap(
    mesh: &TriangularLattice,
    ghost: &Ghost,
    motion: &SourceMotion<'_>,
) -> Vec<(usize, f64)> {
    let center = motion.move_point(mesh, ghost.position);
    overlap_from(mesh, ghost.inverted, ghost.position, center, motion)
}
fn overlap_from(
    mesh: &TriangularLattice,
    inverted: bool,
    position: Point,
    center: Point,
    motion: &SourceMotion<'_>,
) -> Vec<(usize, f64)> {
    // Material whose centre leaves the map still covers the edge cells it overlaps; the
    // rest is carried out.
    let Some(nearest) = mesh.edge_cell(center[0], center[1]) else {
        return Vec::new();
    };
    let polygon = triangle(mesh, inverted, position).map(|p| motion.move_point(mesh, p));
    let source_area = area(&polygon);
    let mut queue = vec![nearest];
    let mut seen = SmallIntSet::default();
    let mut result = Vec::new();
    seen.add(nearest as i32);
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        let overlap = covered(mesh, cell, &polygon, center);
        if overlap > source_area * 1e-12 {
            result.push((cell, overlap / source_area));
        }
        if head == 0 || overlap > source_area * 1e-12 {
            for edge in 0..3 {
                if let Some(target) = mesh.neighbor(cell, edge) {
                    if seen.add(target as i32) {
                        queue.push(target);
                    }
                }
            }
        }
        head += 1;
    }
    result
}
