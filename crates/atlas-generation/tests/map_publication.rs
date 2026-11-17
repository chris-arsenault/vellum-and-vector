use atlas_generation::{
    control::{ControlResult, GenerationControl, GenerationProgress},
    publication::{
        geotiff,
        raster::{MapRaster, RasterGrid, Resampling},
        terrain,
    },
    storage::{BlockCache, BlockScratch, Coverage, RandomAccessFile},
};
use atlas_map::{Bounds, DisplayUnit, RasterBand};
use std::{
    future::Future,
    io::{self, Cursor, Read, Seek, SeekFrom, Write},
    task::{Context, Poll, Waker},
};
use tiff::{
    decoder::{Decoder, DecodingResult},
    tags::Tag,
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
struct Control(bool);
impl GenerationControl for Control {
    fn cancelled(&self) -> ControlResult<bool> {
        Ok(self.0)
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
        BlockCache::new(200_000, BlockScratch::new(File(Cursor::new(Vec::new())))),
    )
}
fn plane(id: &str, resampling: Resampling) -> (RasterBand, Resampling) {
    (
        RasterBand {
            id: id.into(),
            name: id.into(),
            unit: "metre".into(),
            display: DisplayUnit {
                unit: "m".into(),
                factor: 1.0,
            },
            nodata: None,
            categories: vec![],
            range: None,
        },
        resampling,
    )
}
fn pixels(width: u32, height: u32, storage: &mut Coverage) -> MapRaster {
    MapRaster::new(
        RasterGrid {
            width,
            height,
            bounds: Bounds(
                70.0,
                -30.0,
                70.0 + f64::from(width) * 2.0,
                -30.0 + f64::from(height) * 3.0,
            ),
        },
        vec![plane("height", Resampling::Mean)],
        storage,
    )
    .unwrap()
}
#[test]
fn tiled_geotiff_has_scoped_tiles_geography_transparency_and_overviews() {
    for resident in [false, true] {
        let mut storage = if resident {
            Coverage::samples(
                0,
                BlockCache::resident(200_000, BlockScratch::new(File(Cursor::new(Vec::new())))),
            )
        } else {
            storage()
        };
        let mut raster = pixels(257, 3, &mut storage);
        for cell in 0..771 {
            raster.coverage.set(cell, 1.0).unwrap();
            raster.planes[0]
                .values
                .set(cell, (cell % 257) as f32 + 10.0)
                .unwrap();
        }
        raster.coverage.set(0, 0.0).unwrap();
        raster.planes[0].values.set(0, f32::NAN).unwrap();
        let mut output = Cursor::new(Vec::new());
        ready(geotiff::write(
            &mut output,
            &raster,
            &mut storage,
            &Control(false),
        ))
        .unwrap();
        // Optional generated asset for independent consumer checks; never source content.
        #[cfg(not(target_arch = "wasm32"))]
        if let Ok(path) = std::env::var("ATLAS_TIFF_FIXTURE") {
            std::fs::write(path, output.get_ref()).unwrap();
        }
        output.set_position(0);
        let mut decoder = Decoder::new(output).unwrap();
        assert_tiff_layout(&mut decoder);
        assert_tiff_pixels(&mut decoder);
    }
}

#[test]
fn geotiff_metadata_retains_unicode_category_labels() {
    let mut storage = storage();
    let mut raster = pixels(1, 1, &mut storage);
    raster.planes[0]
        .definition
        .categories
        .push(atlas_map::Category {
            value: 1,
            label: "Boisé · 氷 🌋".into(),
            color: Some("#123456".into()),
            present: true,
            surface: None,
            soluble: None,
        });
    let mut output = Cursor::new(Vec::new());
    ready(geotiff::write(
        &mut output,
        &raster,
        &mut storage,
        &Control(false),
    ))
    .unwrap();
    let mut decoder = Decoder::new(Cursor::new(output.into_inner())).unwrap();
    let text = decoder.get_tag_ascii_string(Tag::ImageDescription).unwrap();
    assert!(text.is_ascii());
    let bands: Vec<RasterBand> = serde_json::from_str(text.trim_end_matches('\0')).unwrap();
    assert_eq!(bands[0].categories[0].label, "Boisé · 氷 🌋");
}
fn assert_tiff_layout(decoder: &mut Decoder<Cursor<Vec<u8>>>) {
    assert_eq!(decoder.dimensions().unwrap(), (257, 3));
    assert_eq!(decoder.chunk_dimensions(), (256, 256));
    assert_eq!(decoder.get_tag_u16_vec(Tag::ExtraSamples).unwrap(), [2]);
    assert_eq!(
        decoder.get_tag_f64_vec(Tag::ModelPixelScaleTag).unwrap(),
        [2.0, 3.0, 0.0]
    );
    assert_eq!(
        decoder.get_tag_f64_vec(Tag::ModelTiepointTag).unwrap(),
        [0.0, 0.0, 0.0, 70.0, -21.0, 0.0]
    );
}
fn assert_tiff_pixels(decoder: &mut Decoder<Cursor<Vec<u8>>>) {
    let DecodingResult::F32(first) = decoder.read_chunk(0).unwrap() else {
        panic!("Float map samples")
    };
    assert_eq!(&first[..2], [0.0, 11.0]);
    let DecodingResult::F32(edge) = decoder.read_chunk(1).unwrap() else {
        panic!("Float edge samples")
    };
    assert_eq!(edge[0], 266.0);
    let DecodingResult::F32(mask) = decoder.read_chunk(2).unwrap() else {
        panic!("Coverage samples")
    };
    assert_eq!(&mask[..2], [0.0, 1.0]);
    decoder.next_image().unwrap();
    assert_eq!(decoder.dimensions().unwrap(), (129, 2));
    assert_eq!(decoder.get_tag_u32(Tag::NewSubfileType).unwrap(), 1);
    assert!(!decoder.more_images());
}
#[test]
fn overview_preserves_geographic_coverage_and_categories_on_odd_dimensions() {
    let mut storage = storage();
    let mut raster = pixels(3, 2, &mut storage);
    let class = plane("surface", Resampling::Category);
    let mut categories = MapRaster::new(raster.grid, vec![class], &mut storage)
        .unwrap()
        .planes
        .remove(0);
    for cell in 0..6 {
        raster.coverage.set(cell, 1.0).unwrap();
        raster.planes[0]
            .values
            .set(cell, (cell % 3 * 6) as f32)
            .unwrap();
        categories
            .values
            .set(cell, if cell % 3 == 0 { 1.0 } else { 2.0 })
            .unwrap();
    }
    raster.planes.push(categories);
    let overview = ready(raster.overview(&mut storage, &Control(false))).unwrap();
    assert_overview_values(&overview);
    for cell in [0, 3] {
        raster.coverage.set(cell, 0.0).unwrap();
    }
    let masked = ready(raster.overview(&mut storage, &Control(false))).unwrap();
    assert!((masked.coverage.get(0).unwrap() - 1.0 / 3.0).abs() < 1e-6);
    assert_eq!(masked.planes[0].values.get(0).unwrap(), 6.0);
    assert_eq!(masked.planes[1].values.get(0).unwrap(), 2.0);
}
fn assert_overview_values(overview: &MapRaster) {
    assert_eq!(overview.planes[0].values.get(0).unwrap(), 2.0);
    assert_eq!(overview.planes[0].values.get(1).unwrap(), 10.0);
    assert_eq!(overview.planes[1].values.get(0).unwrap(), 1.0);
    assert_eq!(overview.planes[1].values.get(1).unwrap(), 2.0);
}
#[test]
fn publication_requires_complete_rows_and_returns_only_map_asset_metadata() {
    use atlas_generation::publication::upload::{
        PublicationPlane, RasterPublication, RasterPublicationInput,
    };
    let input = RasterPublicationInput {
        asset_id: "map/revision/terrain.tif".into(),
        grid: RasterGrid {
            width: 2,
            height: 2,
            bounds: Bounds(10.0, 20.0, 14.0, 24.0),
        },
        planes: vec![PublicationPlane {
            band: plane("height", Resampling::Mean).0,
            resampling: Resampling::Mean,
        }],
    };
    let incomplete = RasterPublication::new(input.clone(), storage()).unwrap();
    assert!(ready(incomplete.finish(Cursor::new(Vec::new()), &Control(false))).is_err());
    let mut publication = RasterPublication::new(input, storage()).unwrap();
    assert!(publication.append(&[5.0, 1.0]).is_err());
    assert!(publication.append(&[5.0, 2.0, 7.0, 1.0]).is_err());
    publication.append(&[5.0, 1.0, 7.0, 1.0]).unwrap();
    publication.append(&[9.0, 1.0, f32::NAN, 0.0]).unwrap();
    assert!(publication.append(&[0.0; 4]).is_err());
    let source = ready(publication.finish(Cursor::new(Vec::new()), &Control(false))).unwrap();
    assert_eq!(source.asset_id, "map/revision/terrain.tif");
    assert_eq!(source.bands.last().unwrap().id, "coverage");
    source.validate().unwrap();
}
#[test]
fn gradients_use_map_units_and_publication_observes_cancellation() {
    let mut storage = storage();
    let mut raster = pixels(3, 3, &mut storage);
    for cell in 0..9 {
        raster.coverage.set(cell, 1.0).unwrap();
        raster.planes[0]
            .values
            .set(cell, ((cell % 3) * 2 + (cell / 3) * 6) as f32)
            .unwrap();
    }
    let mut east = storage.scratch(9, 0.0);
    let mut north = storage.scratch(9, 0.0);
    terrain::gradients(&raster, 0, &mut east, &mut north).unwrap();
    assert_eq!(east.get(4).unwrap(), 1.0);
    assert_eq!(north.get(4).unwrap(), -2.0);
    let error = ready(geotiff::write(
        Cursor::new(Vec::new()),
        &raster,
        &mut storage,
        &Control(true),
    ))
    .unwrap_err();
    assert!(error.to_string().contains("Cancelled"));
}

#[test]
fn terrain_overview_rebuilds_slopes_and_pixel_span_at_its_own_scale() {
    check_terrain_overview("");
}

#[test]
fn grouped_terrain_overview_rebuilds_slopes_and_pixel_span() {
    check_terrain_overview("Elevation:");
}

fn check_terrain_overview(prefix: &str) {
    let mut storage = storage();
    let grid = RasterGrid {
        width: 4,
        height: 4,
        bounds: Bounds(0.0, 0.0, 8.0, 12.0),
    };
    let mut raster = MapRaster::new(
        grid,
        [
            "display-height",
            "east-gradient",
            "north-gradient",
            "sample-span",
        ]
        .map(|id| plane(&format!("{prefix}{id}"), Resampling::Mean))
        .to_vec(),
        &mut storage,
    )
    .unwrap();
    for cell in 0..16 {
        raster.coverage.set(cell, 1.0).unwrap();
        raster.planes[0]
            .values
            .set(cell, ((cell % 4) * 2 + (cell / 4) * 6) as f32)
            .unwrap();
        raster.planes[1].values.set(cell, 99.0).unwrap();
        raster.planes[2].values.set(cell, 99.0).unwrap();
        raster.planes[3].values.set(cell, 2.0).unwrap();
    }
    let overview = ready(raster.overview(&mut storage, &Control(false))).unwrap();
    for cell in 0..4 {
        assert_eq!(overview.planes[1].values.get(cell).unwrap(), 1.0);
        assert_eq!(overview.planes[2].values.get(cell).unwrap(), -2.0);
        assert_eq!(overview.planes[3].values.get(cell).unwrap(), 4.0);
    }
}
