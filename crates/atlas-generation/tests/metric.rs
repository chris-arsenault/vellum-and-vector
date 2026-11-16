use atlas_generation::{
    lattice::{Membership, TriangularLattice, WorldLatticeOptions},
    metric::{operator::Operator, search::physical_distance, smoothing::smooth},
    storage::*,
};
use atlas_map::Bounds;
use std::{io, rc::Rc};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

struct File;
impl RandomAccessFile for File {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Explicit operator fits cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Explicit operator fits cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn input() -> (Rc<TriangularLattice>, Coverage) {
    let mesh = Rc::new(
        WorldLatticeOptions::default()
            .build(Bounds(-20.0, -20.0, 20.0, 20.0), 100.0, 0.0, |_, _| true)
            .unwrap(),
    );
    let coverage = Coverage::new(
        mesh.clone(),
        BlockCache::new(20_000_000, BlockScratch::new(File)),
    );
    (mesh, coverage)
}
#[test]
fn distance_uses_the_physical_face_and_stops_before_the_requested_reach() {
    let (mesh, mut coverage) = input();
    let start = mesh.cell_at(0.0, 0.0).unwrap();
    let next = mesh.neighbor(start, 0).unwrap();
    let length = mesh.edge_length(start, 0);
    let mut distance = coverage.allocate(f64::INFINITY);
    distance.set(start, 0.0).unwrap();
    physical_distance(&mesh, [start], &mut distance, length / 2.0, |_, _| Ok(())).unwrap();
    assert!(distance.get(next).unwrap().is_infinite());
    physical_distance(&mesh, [start], &mut distance, length, |_, _| Ok(())).unwrap();
    assert_eq!(distance.get(next).unwrap(), length);
}
#[test]
fn excluded_faces_do_not_enter_the_operator() {
    let (mesh, mut coverage) = input();
    let cell = mesh.cell_at(0.0, 0.0).unwrap();
    let mut active = coverage.allocate(0u8);
    active.set(cell, 1).unwrap();
    let matrix = Operator::new(&mesh, &mut coverage, 100.0, Some(&active.read_only())).unwrap();
    assert_eq!(matrix.count, 1);
    assert!(matrix.neighbors.is_empty());
    let values = coverage.scratch(1, 7.0);
    let mut product = coverage.scratch(1, 0.0);
    matrix.product(&values.read_only(), &mut product).unwrap();
    assert_eq!(product.get(0).unwrap(), mesh.area(cell) * 7.0);
}
fn spread(samples: f64, resident: bool) {
    let mesh = Rc::new(
        WorldLatticeOptions::default()
            .build(Bounds(-20.0, -20.0, 20.0, 20.0), samples, 0.0, |_, _| true)
            .unwrap(),
    );
    let mut coverage = Coverage::new(
        mesh.clone(),
        if resident {
            BlockCache::resident(20_000_000, BlockScratch::new(File))
        } else {
            BlockCache::new(20_000_000, BlockScratch::new(File))
        },
    );
    let source = mesh.cell_at(0.0, 0.0).unwrap();
    let mut values = coverage.allocate(0.0);
    values.set(source, 100.0).unwrap();
    let result = smooth(&mesh, &mut coverage, &values.read_only(), 5.0, None).unwrap();
    assert!(result.get(source).unwrap() < 100.0);
    assert!(result.get(mesh.neighbor(source, 0).unwrap()).unwrap() > 0.0);
    for cell in 0..mesh.len() {
        assert!(
            result.get(cell).unwrap().is_finite(),
            "Non-finite cell {cell}, membership {:?}",
            mesh.membership(cell)
        );
    }
}
#[test]
fn small_solve_spreads_a_supplied_peak() {
    spread(16.0, false);
    spread(16.0, true);
}
#[test]
fn multigrid_solve_spreads_a_supplied_peak() {
    spread(100.0, false);
    spread(100.0, true);
}
#[test]
fn inactive_gap_stops_diffusion_between_components() {
    let (mesh, mut coverage) = input();
    let mut active = coverage.allocate(0u8);
    let mut values = coverage.allocate(0.0);
    for cell in 0..mesh.len() {
        let x = mesh.position(cell)[0];
        if mesh.membership(cell) != Membership::NoData && x.abs() > 5.0 {
            active.set(cell, 1).unwrap();
        }
        values
            .set(
                cell,
                if x < -5.0 {
                    20.0
                } else if x > 5.0 {
                    0.0
                } else {
                    90.0
                },
            )
            .unwrap();
    }
    let result = smooth(
        &mesh,
        &mut coverage,
        &values.read_only(),
        100.0,
        Some(&active.read_only()),
    )
    .unwrap();
    for cell in 0..mesh.len() {
        if active.get(cell).unwrap() == 0 {
            assert_eq!(result.get(cell).unwrap(), values.get(cell).unwrap());
        } else if mesh.position(cell)[0] > 5.0 {
            assert_eq!(result.get(cell).unwrap(), 0.0);
        }
    }
}
