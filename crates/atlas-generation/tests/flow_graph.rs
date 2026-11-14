use atlas_generation::{flow_graph::*, storage::*};
use std::io;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
struct File;
impl RandomAccessFile for File {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied graph fits cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied graph fits cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
#[test]
fn gathering_visits_tributaries_before_receivers_and_applies_local_losses() {
    let mut coverage = Coverage::samples(4, BlockCache::new(100000, BlockScratch::new(File)));
    let mut targets = coverage.allocate(-1i32);
    targets.set(0, 2).unwrap();
    targets.set(1, 2).unwrap();
    targets.set(2, 3).unwrap();
    let mut carried = gathered(
        &mut coverage,
        &targets.read_only(),
        |cell| Ok([10.0, 20.0, 5.0, 1.0][cell]),
        |cell, value| Ok(if cell == 2 { value - 7.0 } else { value }),
    )
    .unwrap();
    assert_eq!(carried.get(2).unwrap(), 28.0);
    assert_eq!(carried.get(3).unwrap(), 29.0);
    let order = target_order(&mut coverage, &targets.read_only()).unwrap();
    let mut seen = [false; 4];
    gather_down(
        &order.read_only(),
        &targets.read_only(),
        &mut carried,
        |cell, value| {
            if cell == 2 {
                assert!(seen[0] && seen[1]);
            }
            if cell == 3 {
                assert!(seen[2]);
            }
            seen[cell] = true;
            Ok(value)
        },
    )
    .unwrap();
}
#[test]
fn cyclic_and_out_of_range_routes_fail_before_gathering() {
    let mut coverage = Coverage::samples(2, BlockCache::new(100000, BlockScratch::new(File)));
    let mut targets = coverage.allocate(-1i32);
    targets.set(0, 1).unwrap();
    targets.set(1, 0).unwrap();
    assert!(target_order(&mut coverage, &targets.read_only())
        .err()
        .expect("A cyclic graph must fail")
        .to_string()
        .contains("cycle"));
    targets.set(1, 7).unwrap();
    assert!(target_order(&mut coverage, &targets.read_only()).is_err());
}
#[test]
fn air_source_loops_start_at_the_last_entering_cell_and_keep_branch_order() {
    let mut coverage = Coverage::samples(5, BlockCache::new(100000, BlockScratch::new(File)));
    let mut sources = coverage.allocate(-1i32);
    for (cell, source) in [1, 2, 0, 1, -1].into_iter().enumerate() {
        sources.set(cell, source).unwrap();
    }
    let result = source_order(&mut coverage, &sources.read_only()).unwrap();
    assert_eq!(
        (0..5)
            .map(|cell| result.order.get(cell).unwrap())
            .collect::<Vec<_>>(),
        [2, 1, 0, 3, 4]
    );
    assert_eq!(
        (0..5)
            .map(|cell| result.boundary.get(cell).unwrap())
            .collect::<Vec<_>>(),
        [0, 0, 1, 0, 0]
    );
}
