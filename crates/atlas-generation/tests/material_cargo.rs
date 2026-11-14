use atlas_generation::{rock::cargo::*, storage::*};
use std::io;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[test]
fn selective_extraction_keeps_hosted_and_aggregate_cargo_distinct() {
    let cargo = MaterialCargo::from_entries([(1, 12, 3.0), (2, 13, 5.0), (3, 0, 7.0)]);
    let partition = cargo.partition(12, 0.5, 0.5);
    assert_eq!(
        partition.taken.unwrap(),
        MaterialCargo::from_entries([(1, 12, 6.0), (3, 0, 7.0)])
    );
    assert_eq!(
        partition.remaining.unwrap(),
        MaterialCargo::from_entries([(2, 13, 10.0), (3, 0, 7.0)])
    );
    assert_eq!(
        cargo.entries().collect::<Vec<_>>(),
        [(1, 12, 3.0), (2, 13, 5.0), (3, 0, 7.0)]
    );
}

#[test]
fn coarsening_rekeys_and_blends_without_mutating_captured_parcels() {
    let source = MaterialCargo::from_entries([(1, 12, 3.0), (1, 13, 4.0), (1, 14, 5.0)]);
    let coarse = source.aggregate_hosts(14, 15).unwrap();
    assert_eq!(
        coarse,
        MaterialCargo::from_entries([(1, 0, 7.0), (1, 14, 5.0)])
    );
    let moved = coarse.rekey(1, 2, 1.0).unwrap();
    let added = MaterialCargo::from_entries([(2, 0, 9.0)]);
    assert_eq!(
        blend(Some(&moved), Some(&added), 1.0, 1.0).unwrap(),
        MaterialCargo::from_entries([(2, 0, 8.0), (2, 14, 2.5)])
    );
    assert_eq!(
        coarse,
        MaterialCargo::from_entries([(1, 0, 7.0), (1, 14, 5.0)])
    );
    assert_eq!(source.without(1).len(), 0);
    let joined = MaterialCargo::from_entries([(1, 12, 3.0), (2, 12, 4.0)])
        .map_keys(|_| 9)
        .unwrap();
    assert_eq!(joined, MaterialCargo::from_entries([(9, 12, 7.0)]));
}

#[test]
fn represented_basement_cargo_and_reusable_mixtures_remain_finite() {
    let cargo = MaterialCargo::from_entries([(4, 12, 8.0)]);
    assert_eq!(
        cargo.finite_slice(11.0, 20.0, true, 0.0).unwrap(),
        MaterialCargo::from_entries([(4, 12, 4.0)])
    );
    assert!(cargo.finite_slice(11.0, 5.0, true, 15.0).is_none());
    let many =
        MaterialCargo::from_entries((0..256).map(|key| (key + 1, key % 7, key as f64 + 0.5)));
    let mut mixture = CargoMixture::default();
    mixture.add(Some(&many), 1.0);
    mixture.add_entry(256, 3, 10.0);
    let first = mixture.finish(2.0).unwrap();
    assert_eq!(first.entries().last(), Some((256, 3, 132.75)));
    mixture.clear();
    mixture.add_entry(256, 0, 2.0);
    assert_eq!(
        mixture.finish(1.0).unwrap(),
        MaterialCargo::from_entries([(256, 0, 2.0)])
    );
    assert_eq!(first.len(), 256);
}

struct SuppliedFile;
impl RandomAccessFile for SuppliedFile {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Small supplied cargo fits in cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Small supplied cargo fits in cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
#[test]
fn sparse_slot_chains_reuse_records_without_sharing_snapshot_mutations() {
    let cache = BlockCache::new(1 << 20, BlockScratch::new(SuppliedFile));
    let mut coverage = Coverage::samples(4, cache);
    let from = coverage.begin_process();
    let mut store = CargoStore::new(&mut coverage, 4);
    let original = MaterialCargo::from_entries([(1, 0, 2.0), (1, 12, 7.0), (2, 12, 13.0)]);
    store.set(1, Some(&original)).unwrap();
    assert_eq!(store.density(1, 1, None).unwrap(), 9.0);
    assert_eq!(store.density(1, 1, Some(0)).unwrap(), 2.0);
    let mut captured = store.snapshot(&mut coverage).unwrap();
    store.clear(1).unwrap();
    store
        .set(2, Some(&MaterialCargo::from_entries([(9, 3, 11.0)])))
        .unwrap();
    captured.clear(2).unwrap();
    coverage.release_process(from);
    assert_eq!(captured.get(1).unwrap(), Some(original));
    assert_eq!(store.get(1).unwrap(), None);
    assert_eq!(store.density(2, 9, None).unwrap(), 11.0);
    assert!(store.get(4).is_err());
}
