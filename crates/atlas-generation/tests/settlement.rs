use atlas_generation::{bindings::*, settlement::*, storage::*};
use std::io;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

struct File;
impl RandomAccessFile for File {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied columns fit in cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied columns fit in cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn columns(coverage: &mut Coverage, values: &[f64]) -> Band<f64> {
    let mut band = coverage.scratch(values.len(), 0.0);
    band.with_block_mut(0, |into| into.copy_from_slice(values))
        .unwrap();
    band
}

#[test]
fn simultaneous_scarcity_is_local_to_each_source_and_its_routes() {
    let cache = BlockCache::new(1024, BlockScratch::new(File));
    let mut coverage = Coverage::samples(2, cache);
    let a = columns(&mut coverage, &[8.0, 2.0]);
    let b = columns(&mut coverage, &[8.0, 2.0]);
    let supply = columns(&mut coverage, &[4.0, 20.0]);
    let demands = [
        Demand {
            amount: a.read_only(),
            available: supply.read_only(),
        },
        Demand {
            amount: b.read_only(),
            available: supply.read_only(),
        },
    ];
    let grants = allocate(&demands, Sharing::Simultaneous, &mut coverage).unwrap();
    assert_eq!(grants[0].get(0).unwrap(), 2.0);
    assert_eq!(grants[1].get(0).unwrap(), 2.0);
    assert_eq!(grants[0].get(1).unwrap(), 2.0);
    assert_eq!(
        route_grant(8.0, grants[0].get(0).unwrap(), 12.0).unwrap(),
        3.0
    );
    assert_eq!(
        route_grant(2.0, grants[0].get(1).unwrap(), 12.0).unwrap(),
        12.0
    );
}

#[test]
fn sequential_allocation_observes_submission_order_without_a_shared_scaling_factor() {
    let cache = BlockCache::new(1024, BlockScratch::new(File));
    let mut coverage = Coverage::samples(1, cache);
    let amount = columns(&mut coverage, &[4.0]);
    let supply = columns(&mut coverage, &[5.0]);
    let demands = [
        Demand {
            amount: amount.read_only(),
            available: supply.read_only(),
        },
        Demand {
            amount: amount.read_only(),
            available: supply.read_only(),
        },
    ];
    let grants = allocate(&demands, Sharing::Sequential, &mut coverage).unwrap();
    assert_eq!(grants[0].get(0).unwrap(), 4.0);
    assert_eq!(grants[1].get(0).unwrap(), 1.0);
}

#[test]
fn elapsed_time_and_work_are_explicit_nonnegative_bindings() {
    assert_eq!(DurationBinding::Years(7.0).years(None).unwrap(), 7.0);
    assert_eq!(
        DurationBinding::EpochFraction(0.25)
            .years(Some(20.0))
            .unwrap(),
        5.0
    );
    assert!(DurationBinding::EpochFraction(0.25).years(None).is_err());
    assert!(work_exposure(-1.0).is_err());
    assert_eq!(work_exposure(0.0).unwrap(), 0.0);
}
