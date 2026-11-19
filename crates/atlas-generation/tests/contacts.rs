use atlas_generation::{
    reconstruction::{Grid, Interpolator, Layout},
    storage::*,
};
use std::io;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
struct File;
impl RandomAccessFile for File {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Explicit grid fits cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Explicit grid fits cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Two donors 1 km apart: the contact between their categories is no longer the straight
/// mid-line, and it stays near it.
#[test]
fn categorical_contacts_bend_instead_of_following_donor_cell_edges() {
    let mut coverage = Coverage::samples(4, BlockCache::new(1_000_000, BlockScratch::new(File)));
    let measures = coverage.allocate(1.0);
    let grid = Grid {
        bounds: [0.0, 0.0, 1000.0, 1000.0],
        periodic_width: None,
        layout: Layout::Raster {
            width: 2,
            height: 2,
        },
        measures: measures.read_only(),
        donors: Default::default(),
    };
    let mut sampler = Interpolator::new(&grid, true, &mut coverage);
    let west = |cell: usize| Ok(if cell.is_multiple_of(2) { 1.0 } else { 0.0 });
    let mut crossings = Vec::new();
    for row in 0..40 {
        let y = 300.0 + 10.0 * f64::from(row);
        let crossing = (0..1000)
            .map(f64::from)
            .find(|&x| sampler.sample([x, y], &west).unwrap() == 0.0)
            .unwrap();
        crossings.push(crossing);
    }
    let low = crossings.iter().copied().fold(f64::INFINITY, f64::min);
    let high = crossings.iter().copied().fold(0.0, f64::max);
    assert!(high - low > 20.0, "contact stays straight: {low}..{high}");
    assert!(low > 100.0 && high < 900.0, "contact strays: {low}..{high}");
}
