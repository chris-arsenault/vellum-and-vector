use atlas_generation::{lattice::*, scale::*};
use atlas_map::Bounds;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[test]
fn world_and_region_share_addresses_centroids_and_reciprocal_neighbors() {
    let lattice = WorldLatticeOptions::default()
        .build(Bounds(100.0, 200.0, 180.0, 260.0), 100.0, 10.0, |_, _| true)
        .unwrap();
    assert_eq!(lattice.origin(), [140.0, 230.0]);
    for cell in 0..lattice.len() {
        let (u, v, i) = lattice.address(cell);
        assert_eq!(lattice.address_cell(u, v, i), Some(cell));
        let [x, y] = lattice.position(cell);
        assert_eq!(lattice.cell_at(x, y), Some(cell));
        for edge in 0..3 {
            if let Some(other) = lattice.neighbor(cell, edge) {
                assert!((0..3).any(|back| lattice.neighbor(other, back) == Some(cell)));
            }
        }
    }
}

// Owner direction 2026-11-16: a map has no outside. Every addressable cell is a map cell;
// beyond the bounds only boundary support exists, one crossing for each missing neighbour.
const MAP: Bounds = Bounds(100.0, 200.0, 180.0, 260.0);
fn covers(x: f64, _: f64) -> bool {
    x <= 165.0
}
fn padded_map() -> TriangularLattice {
    WorldLatticeOptions::default()
        .build(MAP, 400.0, 12.0, covers)
        .unwrap()
}
fn on_map(lattice: &TriangularLattice, [x, y]: [f64; 2]) -> bool {
    let [x, y] = [x + lattice.origin()[0], y + lattice.origin()[1]];
    (MAP.0..=MAP.2).contains(&x) && (MAP.1..=MAP.3).contains(&y) && covers(x, y)
}
fn missing_neighbours(lattice: &TriangularLattice) -> Vec<(usize, usize)> {
    (0..lattice.len())
        .flat_map(|cell| (0..3).map(move |side| (cell, side)))
        .filter(|&(cell, side)| lattice.neighbor(cell, side).is_none())
        .collect()
}

#[test]
fn a_map_addresses_only_its_own_cells() {
    let lattice = padded_map();
    assert!(!lattice.is_empty());
    for cell in 0..lattice.len() {
        assert!(on_map(&lattice, lattice.position(cell)), "cell {cell}");
        let open = (0..3).any(|side| lattice.neighbor(cell, side).is_none());
        assert_eq!(lattice.boundary(cell), open);
        assert!((0..3)
            .filter_map(|side| lattice.neighbor(cell, side))
            .all(|next| next < lattice.len()));
    }
    let window = lattice.window_cells(Bounds(0.0, 0.0, 400.0, 400.0));
    assert_eq!(window.len(), lattice.len());
}

#[test]
fn a_point_beyond_the_map_has_no_cell() {
    let lattice = padded_map();
    let [ox, oy] = lattice.origin();
    let spacing = lattice.spacing();
    for [x, y] in [[MAP.0, 230.0], [140.0, MAP.1], [140.0, MAP.3]] {
        let cell = lattice.cell_at(x - ox, y - oy).expect("on the bounds");
        assert!(lattice.boundary(cell));
    }
    for [x, y] in [
        [MAP.2 + 3.0 * spacing, 230.0],
        [140.0, MAP.1 - 3.0 * spacing],
        [MAP.0 - spacing, MAP.3 + spacing],
        [165.0 + 3.0 * spacing, 230.0],
    ] {
        assert_eq!(lattice.cell_at(x - ox, y - oy), None, "{x},{y}");
        let clamped = lattice.edge_cell(x - ox, y - oy).unwrap();
        assert!(lattice.boundary(clamped));
    }
}

#[test]
fn boundary_support_crosses_exactly_the_map_edge() {
    let lattice = padded_map();
    let edge = missing_neighbours(&lattice);
    let support = lattice.support();
    let crossings = support
        .crossings()
        .iter()
        .map(|crossing| (crossing.cell, crossing.edge))
        .collect::<Vec<_>>();
    assert!(!edge.is_empty());
    assert_eq!(crossings, edge);
    for crossing in support.crossings() {
        let count = edge.iter().filter(|(cell, _)| *cell == crossing.cell);
        assert_eq!(support.crossings_of(crossing.cell).len(), count.count());
        assert!(crossing_is_beyond(&lattice, crossing));
    }
    for ghost in support.ghosts() {
        assert!(!on_map(&lattice, ghost.position) && lattice.boundary(ghost.owner));
    }
}
fn crossing_is_beyond(lattice: &TriangularLattice, crossing: &Crossing) -> bool {
    let support = lattice.support();
    !on_map(lattice, crossing.position)
        && crossing.length > 0.0
        && crossing.face > 0.0
        && support.ghosts()[crossing.slot].position == crossing.position
        && support
            .ghost(GhostChannel::Elevation, crossing.slot)
            .is_none()
}

#[test]
fn ghost_values_are_captured_once_per_ghost() {
    let mut lattice = padded_map();
    let count = lattice.support().ghosts().len();
    let values = (0..count).map(|slot| slot as f64).collect();
    lattice
        .capture_ghosts(GhostChannel::Elevation, values)
        .unwrap();
    let slot = lattice.support().crossings()[0].slot;
    assert_eq!(
        lattice.support().ghost(GhostChannel::Elevation, slot),
        Some(slot as f64)
    );
    assert!(lattice
        .capture_ghosts(GhostChannel::Elevation, Vec::new())
        .is_err());
}

#[test]
fn periodic_seam_links_use_local_edge_distances_and_coordinate_aliases() {
    let lattice = WorldLatticeOptions {
        wrap_x: true,
        ..Default::default()
    }
    .build(Bounds(-60.0, -40.0, 60.0, 40.0), 160.0, 0.0, |_, _| true)
    .unwrap();
    let mut seam = false;
    for cell in 0..lattice.len() {
        for edge in 0..3 {
            if let Some(other) = lattice.neighbor(cell, edge) {
                let [x, y] = lattice.position(cell);
                let [nx, _] = lattice.position(other);
                if (nx - x).abs() > 60.0 {
                    seam = true;
                    assert!(lattice.edge_length(cell, edge) < 2.0 * lattice.spacing());
                    assert_eq!(lattice.cell_at(x + 120.0, y), Some(cell));
                }
            }
        }
    }
    assert!(seam);
}

#[test]
fn geographic_size_uses_map_area_while_precision_and_cell_support_stay_explicit() {
    let a = MapScale::new(400.0, 300.0, 2.0).unwrap();
    let b = MapScale::new(400.0, 300.0, 10.0).unwrap();
    let wide = MapScale::new(800.0, 150.0, 2.0).unwrap();
    let measure = RelativeMeasure::length(0.1).unwrap();
    assert_eq!(
        a.resolve(measure).unwrap().value(),
        b.resolve(measure).unwrap().value()
    );
    assert_eq!(
        a.resolve(measure).unwrap().value(),
        wide.resolve(measure).unwrap().value()
    );
    assert_eq!(a.cells(2.0), 4.0);
    assert_eq!(b.cells(2.0), 20.0);
    assert_eq!(MapScale::native(1.0), 1024.0);
    assert!(RelativeMeasure::new(0.1, 1, 0.0, LengthUnit::Metre).is_err());
}

#[test]
fn hexes_group_whole_triangles_and_hold_six_n_squared() {
    use atlas_generation::lattice::hexes::{grid, hex_of, triangle_corners};
    use std::collections::BTreeMap;
    let (width, height) = (60.0, 40.0);
    let samples = width * height / TRIANGLE_AREA;
    let lattice = WorldLatticeOptions::default()
        .build(Bounds(0.0, 0.0, width, height), samples, 0.0, |_, _| true)
        .unwrap();
    assert!((lattice.spacing() - 1.0).abs() < 1e-9);
    let [ox, oy] = lattice.origin();
    let whole = |hexes: &atlas_map::hexes::HexGrid, cell: usize| {
        let hex = hex_of(hexes, &lattice, cell);
        let [cx, cy] = lattice.position(cell);
        let centre = [cx + ox, cy + oy];
        triangle_corners(&lattice, cell).into_iter().all(|[x, y]| {
            hexes.hex_at([x + (centre[0] - x) * 1e-6, y + (centre[1] - y) * 1e-6]) == hex
        })
    };
    for edges in 1..=3 {
        let hexes = grid(&lattice, edges).unwrap();
        let n = f64::from(edges);
        assert!((hexes.across_flats() - 3.0 * n * lattice.spacing()).abs() < 1e-9);
        let mut counts = BTreeMap::new();
        for cell in 0..lattice.len() {
            *counts.entry(hex_of(&hexes, &lattice, cell)).or_insert(0) += 1;
            assert!(whole(&hexes, cell), "triangle {cell} crosses a hex side");
        }
        let inside = |[x, y]: [f64; 2]| x > 1.0 && x < width - 1.0 && y > 1.0 && y < height - 1.0;
        let interior: Vec<_> = counts
            .iter()
            .filter(|(hex, _)| hexes.corners(**hex).into_iter().all(inside))
            .collect();
        assert!(!interior.is_empty());
        for (hex, count) in interior {
            assert_eq!(*count, 6 * edges * edges, "hex {hex:?} at side {edges}");
        }
    }
}
