//! Standard tiled BigTIFF with Deflate, planar bands, geographic tags and reduced images.
use super::raster::{MapRaster, RasterGrid};
use crate::{
    control::GenerationControl,
    storage::{Coverage, ReadValues},
};
use std::fmt::Write as FmtWrite;
use std::io::{self, Seek, Write};
use tiff::{
    encoder::{
        compression::{CompressionAlgorithm, Deflate, DeflateLevel},
        DirectoryEncoder, TiffEncoder, TiffKindBig,
    },
    tags::Tag,
};

pub const TILE_SIZE: u32 = 256;
pub const MEDIA_TYPE: &str = "image/tiff; application=geotiff";
const LOCAL_CRS: &str = "Vellum & Vector fictional planar metre coordinates|";
fn error(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}

/// Encode independent native tiles concurrently, then write their ordered TIFF directory entries.
pub async fn write<W: Write + Seek>(
    writer: W,
    source: &MapRaster,
    storage: &mut Coverage,
    control: &impl GenerationControl,
) -> io::Result<()> {
    source.validate()?;
    let mut encoder = TiffEncoder::new_big(writer).map_err(error)?;
    write_level(&mut encoder, source, false, control).await?;
    let mut overview = None;
    while {
        let current = overview.as_ref().unwrap_or(source);
        current.grid.width > TILE_SIZE || current.grid.height > TILE_SIZE
    } {
        let next = overview
            .as_ref()
            .unwrap_or(source)
            .overview(storage, control)
            .await?;
        write_level(&mut encoder, &next, true, control).await?;
        overview = Some(next);
    }
    Ok(())
}
async fn write_level<W: Write + Seek>(
    encoder: &mut TiffEncoder<W, TiffKindBig>,
    raster: &MapRaster,
    reduced: bool,
    control: &impl GenerationControl,
) -> io::Result<()> {
    let mut directory = encoder.image_directory().map_err(error)?;
    metadata(&mut directory, raster, reduced)?;
    let mut offsets = Vec::new();
    let mut lengths = Vec::new();
    let covered = raster.coverage.read_only();
    let covered = covered.read_values()?;
    let tiles = raster.grid.width.div_ceil(TILE_SIZE) as usize
        * raster.grid.height.div_ceil(TILE_SIZE) as usize;
    #[cfg(not(target_arch = "wasm32"))]
    let batch = rayon::current_num_threads();
    #[cfg(target_arch = "wasm32")]
    let batch = 1;
    for plane in 0..=raster.planes.len() {
        let values = raster
            .planes
            .get(plane)
            .map_or(&raster.coverage, |plane| &plane.values)
            .read_only();
        let values = values.read_values()?;
        for start in (0..tiles).step_by(batch) {
            control
                .cooperate()
                .await
                .map_err(|e| error(format!("{e:?}")))?;
            for bytes in compress_tiles(
                raster.grid,
                &covered,
                &values,
                start..tiles.min(start + batch),
            )? {
                offsets.push(directory.write_data(bytes.as_slice()).map_err(error)?);
                lengths.push(bytes.len() as u64);
            }
        }
    }
    directory
        .write_tag(Tag::TileOffsets, offsets.as_slice())
        .map_err(error)?;
    directory
        .write_tag(Tag::TileByteCounts, lengths.as_slice())
        .map_err(error)?;
    directory.finish().map_err(error)
}
fn metadata<W: Write + Seek>(
    directory: &mut DirectoryEncoder<'_, W, TiffKindBig>,
    raster: &MapRaster,
    reduced: bool,
) -> io::Result<()> {
    let samples = u16::try_from(raster.planes.len() + 1).map_err(error)?;
    for (tag, value) in [
        (Tag::ImageWidth, raster.grid.width),
        (Tag::ImageLength, raster.grid.height),
        (Tag::TileWidth, TILE_SIZE),
        (Tag::TileLength, TILE_SIZE),
        (Tag::NewSubfileType, u32::from(reduced)),
    ] {
        directory.write_tag(tag, value).map_err(error)?;
    }
    for (tag, value) in [
        (Tag::Compression, 8u16),
        (Tag::PhotometricInterpretation, 1),
        (Tag::PlanarConfiguration, 2),
        (Tag::SamplesPerPixel, samples),
    ] {
        directory.write_tag(tag, value).map_err(error)?;
    }
    directory
        .write_tag(Tag::BitsPerSample, vec![32u16; samples as usize].as_slice())
        .map_err(error)?;
    directory
        .write_tag(Tag::SampleFormat, vec![3u16; samples as usize].as_slice())
        .map_err(error)?;
    let mut extra = vec![0u16; samples as usize - 1];
    *extra
        .last_mut()
        .expect("Coverage follows at least one display band") = 2;
    directory
        .write_tag(Tag::ExtraSamples, extra.as_slice())
        .map_err(error)?;
    let [dx, dy] = raster.grid.pixel_span();
    directory
        .write_tag(Tag::ModelPixelScaleTag, &[dx, dy, 0.0][..])
        .map_err(error)?;
    directory
        .write_tag(
            Tag::ModelTiepointTag,
            &[
                0.0,
                0.0,
                0.0,
                raster.grid.bounds.0,
                raster.grid.bounds.3,
                0.0,
            ][..],
        )
        .map_err(error)?;
    directory
        .write_tag(Tag::GeoAsciiParamsTag, LOCAL_CRS)
        .map_err(error)?;
    directory
        .write_tag(
            Tag::GeoKeyDirectoryTag,
            &[
                1u16,
                1,
                0,
                3,
                1024,
                0,
                1,
                32767,
                1025,
                0,
                1,
                1,
                1026,
                34737,
                LOCAL_CRS.len() as u16,
                0,
            ][..],
        )
        .map_err(error)?;
    let definitions: Vec<_> = raster
        .planes
        .iter()
        .map(|plane| &plane.definition)
        .collect();
    let description = ascii_json(&definitions)?;
    directory
        .write_tag(Tag::ImageDescription, description.as_str())
        .map_err(error)
}
/// TIFF ASCII tags carry Unicode labels through JSON's standard UTF-16 escape syntax.
fn ascii_json(value: &impl serde::Serialize) -> io::Result<String> {
    let json = serde_json::to_string(value).map_err(error)?;
    let mut ascii = String::with_capacity(json.len());
    for character in json.chars() {
        if character.is_ascii() {
            ascii.push(character);
        } else {
            for unit in character.encode_utf16(&mut [0; 2]) {
                write!(&mut ascii, "\\u{unit:04x}").expect("Writing to a string cannot fail");
            }
        }
    }
    Ok(ascii)
}
fn compress_tiles(
    grid: RasterGrid,
    coverage: &ReadValues<'_, f32>,
    values: &ReadValues<'_, f32>,
    tiles: std::ops::Range<usize>,
) -> io::Result<Vec<Vec<u8>>> {
    #[cfg(not(target_arch = "wasm32"))]
    if let (Some(coverage), Some(values)) = (coverage.as_slice(), values.as_slice()) {
        use rayon::prelude::*;
        return tiles
            .into_par_iter()
            .map(|tile| compress_tile(grid, tile, |cell| Ok((coverage[cell], values[cell]))))
            .collect();
    }
    tiles
        .map(|tile| {
            compress_tile(grid, tile, |cell| {
                Ok((coverage.get(cell)?, values.get(cell)?))
            })
        })
        .collect()
}
fn compress_tile(
    grid: RasterGrid,
    index: usize,
    read: impl Fn(usize) -> io::Result<(f32, f32)>,
) -> io::Result<Vec<u8>> {
    let columns = grid.width.div_ceil(TILE_SIZE) as usize;
    let mut pixels = vec![0.0; (TILE_SIZE * TILE_SIZE) as usize];
    tile(
        grid,
        (index % columns) as u32,
        (index / columns) as u32,
        read,
        &mut pixels,
    )?;
    let mut bytes = Vec::new();
    // Every published band is compressed on each map; the fastest level reads the same.
    Deflate::with_level(DeflateLevel::Fast).write_to(&mut bytes, bytemuck::cast_slice(&pixels))?;
    Ok(bytes)
}
fn tile(
    grid: RasterGrid,
    col: u32,
    row: u32,
    read: impl Fn(usize) -> io::Result<(f32, f32)>,
    pixels: &mut [f32],
) -> io::Result<()> {
    pixels.fill(0.0);
    for y in 0..TILE_SIZE.min(grid.height - row * TILE_SIZE) {
        for x in 0..TILE_SIZE.min(grid.width - col * TILE_SIZE) {
            let cell = ((row * TILE_SIZE + y) as usize) * grid.width as usize
                + (col * TILE_SIZE + x) as usize;
            let (coverage, sample) = read(cell)?;
            if !coverage.is_finite() || !(0.0..=1.0).contains(&coverage) {
                return Err(io::Error::other(
                    "Map pixel coverage must be a finite fraction",
                ));
            }
            let value = if coverage > 0.0 { sample } else { 0.0 };
            if !value.is_finite() {
                return Err(io::Error::other("Non-finite covered map pixel"));
            }
            pixels[(y * TILE_SIZE + x) as usize] = value;
        }
    }
    Ok(())
}
