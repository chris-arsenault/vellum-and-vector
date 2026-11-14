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
        if lattice.membership(cell) == Membership::NoData {
            continue;
        }
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
