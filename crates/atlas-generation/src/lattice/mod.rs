//! Shared triangular topology for every map; no regional representation fork.
mod boundary;
pub mod fans;
pub mod hexes;
pub mod sampling;
mod triangular;
mod window;
mod world;
pub use boundary::{BoundarySupport, Crossing, Ghost, GhostChannel};
pub use triangular::{
    LatticeInput, PeriodicFrame, TriangularFrame, TriangularLattice, TRIANGLE_AREA,
};
pub use world::{world_shape, WorldLatticeOptions};

pub const BLOCK_SHIFT: usize = 14;
pub const BLOCK_CELLS: usize = 1 << BLOCK_SHIFT;

#[cfg(test)]
mod tests {
    use super::WorldLatticeOptions;
    use atlas_map::Bounds;

    #[test]
    fn cells_within_a_radius_match_a_full_scan() {
        let lattice = WorldLatticeOptions::default()
            .build(Bounds(0.0, 0.0, 4000.0, 3000.0), 5000.0, 0.0, |_, _| true)
            .unwrap();
        let spacing = lattice.spacing();
        for (centre, radius) in [
            ([0.0, 0.0], 400.0),
            ([1500.0, -1200.0], 900.0),
            ([-1990.0, 1490.0], 300.0),
            ([10.0, 20.0], 0.3 * spacing),
            // Off the map, reaching in.
            ([2150.0, 0.0], 400.0),
            ([0.0, 0.0], 10_000.0),
        ] {
            let mut walked = lattice.cells_within(centre, radius);
            walked.sort_unstable();
            let scanned: Vec<_> = (0..lattice.len())
                .filter(|&cell| {
                    let [x, y] = lattice.position(cell);
                    (x - centre[0]).hypot(y - centre[1]) < radius
                })
                .collect();
            assert!(radius < spacing || !scanned.is_empty(), "centre {centre:?}");
            assert_eq!(walked, scanned, "centre {centre:?} radius {radius}");
        }
        assert!(lattice.cells_within([9000.0, 0.0], 100.0).is_empty());
    }

    #[test]
    fn cells_within_reach_across_a_chart_seam() {
        let lattice = WorldLatticeOptions {
            coordinate_width: Some(4100.0),
            ..Default::default()
        }
        .build(Bounds(0.0, 0.0, 4000.0, 3000.0), 5000.0, 0.0, |_, _| true)
        .unwrap();
        let centre = [-1980.0, 0.0];
        let mut walked = lattice.cells_within(centre, 250.0);
        walked.sort_unstable();
        let scanned: Vec<_> = (0..lattice.len())
            .filter(|&cell| {
                let [x, y] = lattice.position(cell);
                lattice.delta_x(x - centre[0]).hypot(y - centre[1]) < 250.0
            })
            .collect();
        assert!(scanned
            .iter()
            .any(|&cell| lattice.position(cell)[0] > 1800.0));
        assert_eq!(walked, scanned);
    }
}
