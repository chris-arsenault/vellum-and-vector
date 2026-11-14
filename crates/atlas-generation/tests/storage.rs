use atlas_generation::{lattice::BLOCK_CELLS, storage::*};
use std::{io, rc::Rc};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[derive(Default)]
struct SuppliedFile {
    bytes: Vec<u8>,
}
impl RandomAccessFile for SuppliedFile {
    fn read(&mut self, into: &mut [u8], offset: u64) -> io::Result<usize> {
        let start = offset as usize;
        let count = into
            .len()
            .min(37)
            .min(self.bytes.len().saturating_sub(start));
        into[..count].copy_from_slice(&self.bytes[start..start + count]);
        Ok(count)
    }
    fn write(&mut self, bytes: &[u8], offset: u64) -> io::Result<usize> {
        let count = bytes.len().min(37);
        let start = offset as usize;
        self.bytes.resize(self.bytes.len().max(start + count), 0);
        self.bytes[start..start + count].copy_from_slice(&bytes[..count]);
        Ok(count)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn cache(blocks: usize) -> SharedCache {
    BlockCache::new(
        blocks * BLOCK_CELLS * 8,
        BlockScratch::new(SuppliedFile::default()),
    )
}

#[test]
fn spill_reload_and_snapshots_keep_independent_values() {
    let cache = cache(1);
    let mut band = Band::new(BLOCK_CELLS * 3, 0.0, cache.clone());
    band.set(0, 12.0).unwrap();
    band.set(BLOCK_CELLS, 24.0).unwrap();
    let mut copy = band.snapshot().unwrap();
    copy.set(0, 9.0).unwrap();
    band.set(BLOCK_CELLS, 18.0).unwrap();
    assert_eq!(band.get(0).unwrap(), 12.0);
    assert_eq!(copy.get(0).unwrap(), 9.0);
    assert_eq!(copy.get(BLOCK_CELLS).unwrap(), 24.0);
    assert_eq!(band.get(BLOCK_CELLS).unwrap(), 18.0);
    assert!(cache.borrow().stats().evictions > 0);
}

#[test]
fn live_read_views_never_expose_a_mutable_buffer_alias() {
    let cache = cache(2);
    let mut band = Band::new(3, 1.0, cache.clone());
    let view = band.read_only();
    band.set(1, 7.0).unwrap();
    assert_eq!(view.get(1).unwrap(), 7.0);
    let mut values = view.block_copy(0).unwrap();
    values[1] = 400.0;
    assert_eq!(view.get(1).unwrap(), 7.0);
    band.release();
    assert!(view.get(1).is_err());
    assert_eq!(cache.borrow().tracked_blocks(), 0);
    let returned = Band::new(3, 7.0, cache.clone()).read_only();
    assert_eq!(returned.get(1).unwrap(), 7.0);
    assert_eq!(cache.borrow().tracked_blocks(), 1);
    drop(returned);
    assert_eq!(cache.borrow().tracked_blocks(), 0);
}

#[test]
fn pinning_survives_nested_block_work_over_budget() {
    let cache = cache(1);
    let a = Band::new(BLOCK_CELLS, 3.0, cache.clone());
    let mut b = Band::new(BLOCK_CELLS, 0.0, cache.clone());
    a.read_only()
        .with_block(0, |values| {
            b.set(0, values[0] + 2.0).unwrap();
            assert_eq!(values[0], 3.0);
        })
        .unwrap();
    assert_eq!(b.get(0).unwrap(), 5.0);
    assert!(cache.borrow().stats().peak_bytes > BLOCK_CELLS * 8);
    drop(a);
    drop(b);
    assert_eq!(cache.borrow().bytes(), 0);
}

#[test]
fn immutable_sources_need_separate_working_outputs() {
    let cache = cache(1);
    let mut input = Band::from_source(
        4,
        0u32,
        cache,
        Rc::new(|_, into| {
            into.copy_from_slice(&[2, 4, 6, 8]);
            Ok(())
        }),
    );
    assert!(input.set(0, 5).is_err());
    let mut working = input.snapshot().unwrap();
    working.set(0, 5).unwrap();
    assert_eq!(input.get(0).unwrap(), 2);
    assert_eq!(working.get(0).unwrap(), 5);
}

#[test]
fn resident_fields_borrow_contiguous_values_and_keep_snapshot_ownership() {
    let cache = BlockCache::resident(
        BLOCK_CELLS * 8 * 4,
        BlockScratch::new(SuppliedFile::default()),
    );
    let mut band = Band::from_source(
        BLOCK_CELLS * 2 + 3,
        0u32,
        cache.clone(),
        Rc::new(|block, into| {
            for (offset, value) in into.iter_mut().enumerate() {
                *value = (block * BLOCK_CELLS + offset) as u32;
            }
            Ok(())
        }),
    );
    let view = band.read_only();
    {
        let values = view.read_values().unwrap();
        assert_eq!(values.as_slice().unwrap().len(), BLOCK_CELLS * 2 + 3);
        assert_eq!(
            values.get(BLOCK_CELLS + 1).unwrap(),
            (BLOCK_CELLS + 1) as u32
        );
        assert_eq!(view.read_block(2).unwrap().len(), 3);
    }
    let mut copy = band.snapshot().unwrap();
    {
        let mut values = copy.write_values().unwrap();
        values.set(BLOCK_CELLS + 1, 7).unwrap();
        assert_eq!(values.get(BLOCK_CELLS + 1).unwrap(), 7);
    }
    assert!(band.write_values().is_err());
    assert_eq!(view.get(BLOCK_CELLS + 1).unwrap(), (BLOCK_CELLS + 1) as u32);
    assert_eq!(copy.get(BLOCK_CELLS + 1).unwrap(), 7);
    band.release();
    assert!(view.read_values().is_err());
}

struct NoProgress;
impl RandomAccessFile for NoProgress {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        Ok(0)
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        Ok(0)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
#[test]
fn partial_io_completes_and_zero_progress_reports_failure() {
    let mut scratch = BlockScratch::new(SuppliedFile::default());
    let offset = scratch.allocate(100).unwrap();
    scratch.write(offset, &[7; 100]).unwrap();
    let mut result = [0; 100];
    scratch.read(offset, &mut result).unwrap();
    assert_eq!(result, [7; 100]);
    let mut stopped = BlockScratch::new(NoProgress);
    assert!(stopped.write(0, &[1, 2]).is_err());
    assert!(stopped.read(0, &mut [0, 0]).is_err());
}

#[test]
fn coverage_releases_only_new_unretained_process_allocations() {
    let cache = cache(1);
    let mut coverage = Coverage::samples(4, cache.clone());
    let before = coverage.scratch(4, 1.0);
    let from = coverage.begin_process();
    let after = coverage.scratch(4, 2.0);
    let mut retained = coverage.scratch(4, 3.0);
    retained.retain();
    coverage.release_process(from);
    assert_eq!(before.get(0).unwrap(), 1.0);
    assert!(after.get(0).is_err());
    assert_eq!(retained.get(0).unwrap(), 3.0);
    drop(coverage);
    assert!(before.get(0).is_err());
    assert!(retained.get(0).is_err());
}

#[test]
fn band_lists_page_and_finish_without_losing_chunk_edges() {
    let cache = cache(1);
    let mut coverage = Coverage::samples(1, cache);
    let mut list = BandList::<u32>::default();
    for i in 0..BLOCK_CELLS + 9 {
        list.push(i as u32, &mut coverage).unwrap();
    }
    let band = list.finish(&mut coverage).unwrap();
    assert_eq!(band.len(), BLOCK_CELLS + 9);
    for i in [0, 255, 256, BLOCK_CELLS - 1, BLOCK_CELLS, BLOCK_CELLS + 8] {
        assert_eq!(band.get(i).unwrap(), i as u32);
    }
}

#[test]
fn sorted_runs_merge_over_spilled_blocks_and_keep_cell_ties() {
    let cache = cache(1);
    let length = BLOCK_CELLS + 3;
    let mut coverage = Coverage::samples(length, cache.clone());
    let mut band = coverage.allocate(2.0f64);
    band.set(4, -7.0).unwrap();
    band.set(BLOCK_CELLS + 1, -7.0).unwrap();
    let mut order = coverage
        .order(
            &band.read_only(),
            atlas_generation::hpc::Direction::Ascending,
        )
        .unwrap();
    assert_eq!(order.next().unwrap().unwrap(), 4);
    assert_eq!(order.next().unwrap().unwrap(), BLOCK_CELLS + 1);
    assert_eq!(order.next().unwrap().unwrap(), 0);
    drop(order);
    assert_eq!(
        coverage
            .reduce(&band.read_only(), 0usize, |count, _, _| count + 1)
            .unwrap(),
        length
    );
    assert!(cache.borrow().stats().evictions > 0);
}

fn scalar_width<T: Sample + PartialEq + std::fmt::Debug>(first: T, last: T) {
    let cache = BlockCache::new(
        BLOCK_CELLS * T::BYTES,
        BlockScratch::new(SuppliedFile::default()),
    );
    let mut band = Band::new(BLOCK_CELLS + 1, T::default(), cache);
    band.set(0, first).unwrap();
    band.set(BLOCK_CELLS, last).unwrap();
    assert_eq!(band.get(0).unwrap(), first);
    assert_eq!(band.get(BLOCK_CELLS).unwrap(), last);
}
#[test]
fn typed_spill_io_keeps_all_supported_scalar_widths() {
    scalar_width(-1.25f64, 3.5f64);
    scalar_width(-1.25f32, 3.5f32);
    scalar_width(i32::MIN, i32::MAX);
    scalar_width(0u32, u32::MAX);
    scalar_width(0u8, u8::MAX);
    scalar_width(i8::MIN, i8::MAX);
}
