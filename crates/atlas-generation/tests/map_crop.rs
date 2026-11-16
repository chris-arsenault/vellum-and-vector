use atlas_generation::{
    control::{ControlResult, GenerationControl, GenerationProgress},
    publication::{
        crop, geotiff,
        raster::{MapRaster, RasterGrid, Resampling},
    },
    storage::{BlockCache, BlockScratch, Coverage, RandomAccessFile},
};
use atlas_map::{Bounds, DisplayUnit, RasterBand};
use std::{
    future::Future,
    io::{self, Cursor, Read, Seek, SeekFrom, Write},
    task::{Context, Poll, Waker},
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
struct Control;
impl GenerationControl for Control {
    fn cancelled(&self) -> ControlResult<bool> {
        Ok(false)
    }
    fn progress(&self, _: &GenerationProgress) -> ControlResult<()> {
        Ok(())
    }
    async fn yield_control(&self) -> ControlResult<()> {
        Ok(())
    }
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    match Box::pin(future)
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(result) => result,
        Poll::Pending => panic!("Supplied host yields immediately"),
    }
}
fn storage() -> Coverage {
    Coverage::samples(
        0,
        BlockCache::new(400_000, BlockScratch::new(File(Cursor::new(Vec::new())))),
    )
}
fn band(id: &str, unit: &str) -> (RasterBand, Resampling) {
    let resampling = if unit == "category" {
        Resampling::Category
    } else {
        Resampling::Mean
    };
    (
        RasterBand {
            id: id.into(),
            name: id.into(),
            unit: unit.into(),
            display: DisplayUnit {
                unit: unit.into(),
                factor: 1.0,
            },
            nodata: None,
            categories: vec![],
            range: None,
        },
        resampling,
    )
}

#[test]
fn window_keeps_the_parent_pixel_lattice_and_stays_inside_it() {
    let parent = RasterGrid {
        width: 8,
        height: 8,
        bounds: Bounds(0.0, 0.0, 100.0, 100.0),
    };
    let window = crop::window(parent, Bounds(26.0, 26.0, 74.0, 74.0)).unwrap();
    assert_eq!((window.col, window.row), (2, 2));
    assert_eq!((window.grid.width, window.grid.height), (4, 4));
    assert_eq!(window.grid.bounds, Bounds(25.0, 25.0, 75.0, 75.0));
    let edge = crop::window(parent, Bounds(-10.0, 90.0, 10.0, 120.0)).unwrap();
    assert_eq!(
        (edge.col, edge.row, edge.grid.width, edge.grid.height),
        (0, 0, 1, 1)
    );
    assert!(crop::window(parent, Bounds(120.0, 0.0, 130.0, 10.0)).is_none());
}

#[test]
fn read_window_copies_every_band_across_tile_boundaries() {
    let mut storage = storage();
    let (width, height) = (300u32, 270u32);
    let grid = RasterGrid {
        width,
        height,
        bounds: Bounds(0.0, 0.0, f64::from(width), f64::from(height)),
    };
    let mut raster = MapRaster::new(
        grid,
        vec![band("height", "metre"), band("surface", "category")],
        &mut storage,
    )
    .unwrap();
    for cell in 0..(width * height) as usize {
        let (col, row) = (cell % width as usize, cell / width as usize);
        raster.coverage.set(cell, 1.0).unwrap();
        raster.planes[0]
            .values
            .set(cell, (col * 1000 + row) as f32)
            .unwrap();
        raster.planes[1].values.set(cell, (col % 7) as f32).unwrap();
    }
    let mut file = Cursor::new(Vec::new());
    ready(geotiff::write(&mut file, &raster, &mut storage, &Control)).unwrap();
    // A window spanning all four tiles of the full-resolution image.
    let window = crop::window(grid, Bounds(250.0, 10.0, 270.0, 30.0)).unwrap();
    file.set_position(0);
    let cropped = crop::read_window(file, &window, &mut storage).unwrap();
    assert_eq!(cropped.grid, window.grid);
    assert_eq!(cropped.planes.len(), 2);
    assert_eq!(cropped.planes[1].resampling, Resampling::Category);
    for y in 0..window.grid.height {
        for x in 0..window.grid.width {
            let cell = (y * window.grid.width + x) as usize;
            let (col, row) = ((window.col + x) as usize, (window.row + y) as usize);
            assert_eq!(cropped.coverage.get(cell).unwrap(), 1.0);
            assert_eq!(
                cropped.planes[0].values.get(cell).unwrap(),
                (col * 1000 + row) as f32
            );
            assert_eq!(
                cropped.planes[1].values.get(cell).unwrap(),
                (col % 7) as f32
            );
        }
    }
}
