#![cfg(not(target_arch = "wasm32"))]
//! Captured trace geometry at map boundaries, without running generation.
use atlas_generation::{
    field::{fractures::Fault, FieldSeed},
    lattice::WorldLatticeOptions,
    rock::ground::observers::GroundObservers,
    scale::MapScale,
    storage::{BlockCache, BlockScratch},
};
use atlas_gis::geometry::NativeGeos;
use atlas_host::native::NativeScratch;
use atlas_map::Bounds;
use std::rc::Rc;

#[test]
fn clipped_fault_samples_survive_geometry_precision_at_the_map_edge() {
    let side = 100.0000014;
    let mesh = Rc::new(
        WorldLatticeOptions::default()
            .build(Bounds(0.0, 0.0, side, side), 64.0, 0.0, |_, _| true)
            .unwrap(),
    );
    let bounds = mesh.bounds();
    let path = std::env::temp_dir().join(format!(
        "atlas-captured-fault-{}.blocks",
        std::process::id()
    ));
    let cache = BlockCache::new(
        1_000_000,
        BlockScratch::new(NativeScratch::create_new(path).unwrap()),
    );
    let mut field = FieldSeed::new(
        mesh.clone(),
        MapScale::new(side, side, mesh.cell_span()).unwrap(),
        cache,
    )
    .finish(Box::<GroundObservers>::default())
    .unwrap();
    let faults: Vec<_> = (0..10)
        .map(|i| {
            let y = bounds.1 + (bounds.3 - bounds.1) * (i as f64 + 0.5) / 10.0;
            Fault {
                id: format!("edge-{i}"),
                coordinates: vec![[bounds.0 - 50.0, y], [bounds.2 + 50.0, y]],
                width: 3.0,
            }
        })
        .collect();
    field
        .realize_captured_faults(&faults, 0.0, &NativeGeos::new(1e-6).unwrap())
        .unwrap();
    assert_eq!(field.faults().len(), faults.len());
    assert!(field.faults().iter().all(|fault| fault
        .coordinates
        .iter()
        .all(|p| p[0] >= bounds.0 - 1e-6 && p[0] <= bounds.2 + 1e-6)));
}
