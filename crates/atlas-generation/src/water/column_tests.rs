use super::column::*;
use crate::storage::*;
use crate::transport::{TransportShares, TRANSPORT_WEIGHT_SCALE};
use std::{
    io::{self, Cursor, Read, Seek, SeekFrom, Write},
    rc::Rc,
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
struct File(Cursor<Vec<u8>>);
impl RandomAccessFile for File {
    fn read(&mut self, into: &mut [u8], offset: u64) -> io::Result<usize> {
        self.0.seek(SeekFrom::Start(offset))?;
        self.0.read(into)
    }
    fn write(&mut self, bytes: &[u8], offset: u64) -> io::Result<usize> {
        self.0.seek(SeekFrom::Start(offset))?;
        self.0.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn fixture() -> (Coverage, Band<f64>, WaterColumn) {
    let cache = BlockCache::new(
        1024 * 1024,
        BlockScratch::new(File(Cursor::new(Vec::new()))),
    );
    let mut coverage = Coverage::samples(4, cache);
    let elevation = coverage.allocate(100.0 * 1024.0);
    let column = WaterColumn::new(
        &mut coverage,
        WaterMedium {
            elevation: elevation.read_only(),
            soil_capacity: Rc::new(|_| Ok(0.12)),
            groundwater_capacity: Rc::new(|_| Ok(10.0)),
        },
    );
    (coverage, elevation, column)
}
#[test]
fn inherited_column_is_not_clipped_or_developed_and_reads_stay_live() {
    let (_coverage, mut elevation, mut column) = fixture();
    let view = column.read_only();
    let captured = CapturedColumn {
        snow: 0.4,
        soil: 0.2,
        ground: 2.0,
        standing: 20.0 * 1024.0,
        surface: 120.0 * 1024.0,
        kind: 2,
        body: 7,
    };
    column.inherit(0, captured).unwrap();
    assert_eq!(column.capture(0).unwrap(), captured);
    assert_eq!(view.store(Store::Soil).held(0).unwrap(), 0.2);
    assert_eq!(view.store(Store::Standing).held(0).unwrap(), 20.0);
    elevation.set(0, 130.0 * 1024.0).unwrap();
    column.reconcile(0).unwrap();
    assert_eq!(view.kind.get(0).unwrap(), 0);
    assert_eq!(view.surface.get(0).unwrap(), NO_WATER_SURFACE);
}
#[test]
fn column_stores_release_and_receive_against_their_media() {
    let (_coverage, _elevation, mut column) = fixture();
    column.put_soil_water(0, 0.06).unwrap();
    let released = column.store(Store::Soil).give(0, 0.12).unwrap();
    assert!(released > 0.0 && released < 0.06);
    column.put_snow(0, 0.3).unwrap();
    let transfer = column.transfer(Store::Snow, Store::Soil, 0, 0.2).unwrap();
    assert!(transfer.overflow > 0.0);
    assert!((column.read_only().store(Store::Snow).held(0).unwrap() - 0.1).abs() < 1e-12);
    assert_eq!(column.read_only().store(Store::Soil).held(0).unwrap(), 0.12);
}
#[test]
fn crust_transport_carries_stocks_lakes_and_the_established_water_year() {
    let (mut coverage, _elevation, mut column) = fixture();
    column.put_snow(0, 0.3).unwrap();
    column.put_groundwater(0, 5.0).unwrap();
    column
        .stand(0, StandingKind::Lake, 120.0 * 1024.0, Some(7))
        .unwrap();
    column
        .stand(3, StandingKind::Sea, 110.0 * 1024.0, Some(1))
        .unwrap();
    let mut year = [0.0; 14];
    year[0] = 12.0;
    year[12] = 8.0;
    year[13] = 3.0;
    column.set_year(0, year).unwrap();
    let mut offsets = coverage.scratch(5, 0u32);
    let mut targets = coverage.scratch(4, 0i32);
    let weights = coverage.scratch(4, TRANSPORT_WEIGHT_SCALE);
    let mut dominant = coverage.scratch(4, 0i32);
    for (i, target) in [1, 0, 2, 3].into_iter().enumerate() {
        offsets.set(i, i as u32).unwrap();
        targets.set(i, target).unwrap();
        dominant.set(target as usize, i as i32).unwrap();
    }
    offsets.set(4, 4).unwrap();
    let plan = TransportShares {
        offsets: offsets.read_only(),
        targets: targets.read_only(),
        weights: weights.read_only(),
        dominant: dominant.read_only(),
    };
    column.carry(&plan, &mut coverage, |_| 1.0).unwrap();
    let view = column.read_only();
    assert_eq!(view.store(Store::Snow).held(1).unwrap(), 0.3);
    assert_eq!(view.store(Store::Ground).held(1).unwrap(), 5.0);
    assert_eq!(view.store(Store::Ground).held(0).unwrap(), 0.0);
    assert_eq!(
        (
            view.kind.get(0).unwrap(),
            view.kind.get(1).unwrap(),
            view.body.get(1).unwrap(),
            view.kind.get(3).unwrap()
        ),
        (0, 2, 7, 1)
    );
    assert_eq!(
        (
            view.year[0].get(1).unwrap(),
            view.year[12].get(1).unwrap(),
            view.year[13].get(1).unwrap()
        ),
        (12.0, 8.0, 3.0)
    );
}
