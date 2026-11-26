//! Real-scale hexes grouped from the shared triangular lattice; never a lattice of their own.
//!
//! The lattice's triangles stand on a vertical edge, so every corner has edges at 30°, 90°,
//! 150°, 210°, 270° and 330°. Taking the corner at the frame offset as a hex centre and
//! stepping by whole hex widths keeps every centre on one corner class. A pointy-topped hex
//! whose side is `n` triangle edges then has its boundary on lattice edges and holds `6n²`
//! triangles; each triangle's centroid lies strictly inside exactly one hex.
use super::TriangularLattice;
use atlas_map::hexes::{Hex, HexGrid};

const ROOT_THREE: f64 = 1.7320508075688772;

/// The world-coordinate hex grid whose sides are `edges` triangle edges of `lattice`.
pub fn grid(lattice: &TriangularLattice, edges: u32) -> Result<HexGrid, &'static str> {
    if edges == 0 {
        return Err("A hex side needs at least one triangle edge");
    }
    let spacing = lattice.spacing();
    if (lattice.spacing_y() - spacing).abs() > spacing * 1e-9 {
        return Err("Hexes need a lattice with equal row and column spacing");
    }
    let [ox, oy] = lattice.origin();
    let [fx, fy] = lattice.offset();
    HexGrid::new(f64::from(edges) * ROOT_THREE * spacing, [ox + fx, oy + fy])
}
/// The hex holding a lattice triangle.
pub fn hex_of(grid: &HexGrid, lattice: &TriangularLattice, cell: usize) -> Hex {
    grid.hex_at(world(lattice, lattice.position(cell)))
}
/// The three corners of a lattice triangle in world coordinates.
pub fn triangle_corners(lattice: &TriangularLattice, cell: usize) -> [[f64; 2]; 3] {
    let [x, y] = lattice.position(cell);
    let s = lattice.spacing();
    let h = ROOT_THREE / 2.0 * lattice.spacing_y();
    let side = if lattice.inverted(cell) { -1.0 } else { 1.0 };
    [
        [x - side * s, y],
        [x + side * s / 2.0, y - h],
        [x + side * s / 2.0, y + h],
    ]
    .map(|corner| world(lattice, corner))
}
pub(crate) fn triangle_polygon(mesh: &TriangularLattice, cell: usize) -> atlas_map::Geometry {
    let [a, b, c] = triangle_corners(mesh, cell);
    atlas_map::Geometry::Polygon {
        coordinates: vec![[a, b, c, a]
            .map(|[x, y]| atlas_map::Position::xy(x, y))
            .to_vec()],
    }
}

fn world(lattice: &TriangularLattice, [x, y]: [f64; 2]) -> [f64; 2] {
    let [ox, oy] = lattice.origin();
    [x + ox, y + oy]
}
