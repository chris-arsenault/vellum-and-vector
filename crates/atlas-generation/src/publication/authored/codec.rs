//! The viewer's terrain GeoTIFF for an authored height grid: sixteen bands, all derived from
//! the height, written through the same codec as generated maps.
use super::Terrain;
use crate::{
    control::{ControlResult, GenerationControl, GenerationProgress},
    publication::{
        fields::display,
        geotiff,
        raster::{MapRaster, RasterGrid, Resampling},
        terrain::gradients,
    },
    storage::{BlockCache, BlockScratch, Coverage, RandomAccessFile},
};
use atlas_map::{DisplayUnit, RasterBand, RasterSource};
use std::{
    future::Future,
    io::{self, Cursor, Read, Seek, SeekFrom, Write},
    task::{Context, Poll, Waker},
};
use tiff::decoder::{Decoder, DecodingResult};

/// Display bands in the order the viewer reads them, with their units; coverage follows.
const BANDS: [(&str, &str, Resampling); 15] = [
    ("value", "metre", Resampling::Mean),
    ("relative-height", "metre", Resampling::Mean),
    ("water", "category", Resampling::Category),
    ("ice", "ratio", Resampling::Mean),
    ("sample-span", "metre", Resampling::Mean),
    ("surface", "category", Resampling::Category),
    ("natural-surface", "category", Resampling::Category),
    ("display-height", "metre", Resampling::Mean),
    ("east-gradient", "ratio", Resampling::Mean),
    ("north-gradient", "ratio", Resampling::Mean),
    ("log-value", "log-value", Resampling::Mean),
    ("paint-red", "color", Resampling::Mean),
    ("paint-green", "color", Resampling::Mean),
    ("paint-blue", "color", Resampling::Mean),
    ("paint-alpha", "ratio", Resampling::Mean),
];
const DISPLAY_HEIGHT: usize = 7;

/// The encoded file and the raster source describing it; `asset_id` is left empty for the caller.
#[derive(Clone, Debug)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub source: RasterSource,
}

struct Memory(Cursor<Vec<u8>>);
impl RandomAccessFile for Memory {
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
struct Immediate;
impl GenerationControl for Immediate {
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
fn ready<T>(future: impl Future<Output = T>) -> io::Result<T> {
    match Box::pin(future)
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(result) => Ok(result),
        Poll::Pending => Err(io::Error::other("The terrain writer waited on its host")),
    }
}
fn band(id: &str, unit: &str, range: Option<(f64, f64)>) -> RasterBand {
    RasterBand {
        id: id.into(),
        name: if range.is_some() && id == "value" {
            "Elevation".into()
        } else {
            id.replace('-', " ")
        },
        unit: unit.into(),
        display: display(unit),
        nodata: None,
        categories: vec![],
        range,
    }
}
fn definitions(range: (f64, f64)) -> Vec<(RasterBand, Resampling)> {
    BANDS
        .iter()
        .map(|&(id, unit, how)| (band(id, unit, (id == "value").then_some(range)), how))
        .collect()
}
/// The 15 display bands at one cell; sea level is 0 and the paint is transparent.
fn pixel(height: f32, span: f32) -> [f32; 15] {
    let log = (f64::from(height).signum() * f64::from(height).abs().ln_1p()) as f32;
    let water = f32::from(u8::from(height < 0.0));
    [
        height, height, water, 0.0, span, 0.0, 0.0, height, 0.0, 0.0, log, 0.0, 0.0, 0.0, 0.0,
    ]
}
fn raster_of(terrain: &Terrain, storage: &mut Coverage) -> io::Result<MapRaster> {
    let (low, high) = terrain
        .heights
        .iter()
        .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), &h| {
            (lo.min(h), hi.max(h))
        });
    let mut raster = MapRaster::new(
        terrain.grid,
        definitions((f64::from(low), f64::from(high))),
        storage,
    )?;
    let span = terrain.grid.pixel_span()[0] as f32;
    for (cell, &height) in terrain.heights.iter().enumerate() {
        raster.coverage.set(cell, 1.0)?;
        for (plane, value) in raster.planes.iter_mut().zip(pixel(height, span)) {
            plane.values.set(cell, value)?;
        }
    }
    let count = terrain.heights.len();
    let (mut east, mut north) = (storage.scratch(count, 0.0), storage.scratch(count, 0.0));
    gradients(&raster, DISPLAY_HEIGHT, &mut east, &mut north)?;
    raster.planes[DISPLAY_HEIGHT + 1].values = east;
    raster.planes[DISPLAY_HEIGHT + 2].values = north;
    Ok(raster)
}
fn source_of(raster: &MapRaster) -> RasterSource {
    let mut bands: Vec<_> = raster.planes.iter().map(|p| p.definition.clone()).collect();
    bands.push(RasterBand {
        id: "coverage".into(),
        name: "Coverage".into(),
        unit: "ratio".into(),
        display: DisplayUnit {
            unit: "%".into(),
            factor: 100.0,
        },
        nodata: None,
        categories: vec![],
        range: Some((0.0, 1.0)),
    });
    let [dx, dy] = raster.grid.pixel_span();
    RasterSource {
        asset_id: String::new(),
        media_type: geotiff::MEDIA_TYPE.into(),
        width: raster.grid.width,
        height: raster.grid.height,
        cell_span: dx.max(dy),
        band_indices: (1..=bands.len()).map(|i| i as u16).collect(),
        bands,
        overviews: vec![],
    }
}
fn other(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}
impl Terrain {
    /// The terrain GeoTIFF with its overviews and the source that describes it.
    pub fn encode(&self) -> io::Result<Encoded> {
        let count = self.grid.count()?;
        let budget = count.saturating_mul(4 * 20).saturating_add(1 << 20);
        let scratch = BlockScratch::new(Memory(Cursor::new(Vec::new())));
        let mut storage = Coverage::samples(0, BlockCache::resident(budget, scratch));
        let raster = raster_of(self, &mut storage)?;
        let mut bytes = Cursor::new(Vec::new());
        ready(geotiff::write(
            &mut bytes,
            &raster,
            &mut storage,
            &Immediate,
        ))??;
        Ok(Encoded {
            bytes: bytes.into_inner(),
            source: source_of(&raster),
        })
    }
    /// Read the `value` band of the full-resolution image of a file `encode` wrote.
    pub fn decode(grid: RasterGrid, bytes: &[u8]) -> io::Result<Self> {
        let mut decoder = Decoder::new(Cursor::new(bytes)).map_err(other)?;
        if decoder.dimensions().map_err(other)? != (grid.width, grid.height) {
            return Err(io::Error::other(
                "The terrain file does not match the map's size",
            ));
        }
        let (tile_width, tile_height) = decoder.chunk_dimensions();
        let across = grid.width.div_ceil(tile_width);
        let mut heights = vec![0.0; grid.count()?];
        for chunk in 0..across * grid.height.div_ceil(tile_height) {
            let DecodingResult::F32(values) = decoder.read_chunk(chunk).map_err(other)? else {
                return Err(io::Error::other("Terrain files hold 32-bit floats"));
            };
            let (width, rows) = decoder.chunk_data_dimensions(chunk);
            let (col0, row0) = (
                (chunk % across) * tile_width,
                (chunk / across) * tile_height,
            );
            for row in 0..rows as usize {
                let at = (row0 as usize + row) * grid.width as usize + col0 as usize;
                heights[at..at + width as usize]
                    .copy_from_slice(&values[row * width as usize..(row + 1) * width as usize]);
            }
        }
        Self::from_heights(grid, heights)
    }
}

#[cfg(test)]
mod tests {
    use super::super::fixtures::grid;
    use super::*;
    use atlas_map::Bounds;

    fn varied(grid: RasterGrid) -> Terrain {
        let count = grid.count().unwrap();
        let heights = (0..count)
            .map(|i| (i % 97) as f32 * 31.5 - 1500.25)
            .collect();
        Terrain::from_heights(grid, heights).unwrap()
    }
    #[test]
    fn encoded_file_has_sixteen_ordered_bands() {
        let encoded = varied(grid()).encode().unwrap();
        let ids: Vec<_> = encoded.source.bands.iter().map(|b| b.id.as_str()).collect();
        assert_eq!(ids.len(), 16);
        assert_eq!(&ids[..4], ["value", "relative-height", "water", "ice"]);
        assert_eq!(
            &ids[10..],
            [
                "log-value",
                "paint-red",
                "paint-green",
                "paint-blue",
                "paint-alpha",
                "coverage"
            ]
        );
        assert_eq!(encoded.source.band_indices, (1..=16).collect::<Vec<u16>>());
        assert_eq!(encoded.source.media_type, geotiff::MEDIA_TYPE);
        assert_eq!(encoded.source.cell_span, 10.0);
        assert!(encoded.source.asset_id.is_empty() && encoded.source.overviews.is_empty());
        assert_eq!(
            encoded.source.bands[0].range,
            Some((-1500.25, 31.5 * 96.0 - 1500.25))
        );
        let mut source = encoded.source;
        source.asset_id = "terrain".into();
        source.validate().unwrap();
    }
    #[test]
    fn heights_round_trip_exactly_across_tile_edges() {
        for (width, height) in [(40, 30), (300, 20)] {
            let g = RasterGrid {
                width,
                height,
                bounds: Bounds(0.0, 0.0, f64::from(width) * 10.0, f64::from(height) * 10.0),
            };
            let terrain = varied(g);
            let back = Terrain::decode(g, &terrain.encode().unwrap().bytes).unwrap();
            assert_eq!(back.heights(), terrain.heights());
        }
    }
    #[test]
    fn decode_refuses_a_file_of_another_size() {
        let bytes = varied(grid()).encode().unwrap().bytes;
        let mut other = grid();
        other.width = 41;
        assert!(Terrain::decode(other, &bytes).is_err());
        assert!(Terrain::decode(grid(), &bytes[..40]).is_err());
    }
    #[test]
    fn derived_bands_follow_the_height() {
        let terrain = varied(grid());
        let bytes = terrain.encode().unwrap().bytes;
        let mut decoder = Decoder::new(Cursor::new(bytes)).unwrap();
        let per_band = 1; // 40 by 30 pixels fit one 256-pixel tile
        let mut band = |n: u32| match decoder.read_chunk(n * per_band).unwrap() {
            DecodingResult::F32(v) => v,
            _ => panic!("floats expected"),
        };
        let (value, water, coverage) = (band(0), band(2), band(15));
        for (i, &h) in terrain.heights().iter().enumerate() {
            assert_eq!(value[i], h);
            assert_eq!(water[i], if h < 0.0 { 1.0 } else { 0.0 });
            assert_eq!(coverage[i], 1.0);
        }
    }
}
