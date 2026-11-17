//! Rebuild a published GIS raster's pyramid without generation or resampling its base image.
use atlas_generation::{
    control::CancellationToken,
    publication::{
        crop::{read_window, Window},
        geotiff,
        raster::RasterGrid,
    },
    storage::{BlockCache, BlockScratch, Coverage},
};
use atlas_host::{native::NativeScratch, native_control::NativeControl};
use atlas_map::Bounds;
use std::{
    fs::File,
    io::{self, BufReader, BufWriter},
    path::PathBuf,
};
use tiff::{decoder::Decoder, tags::Tag};

fn main() -> io::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err(io::Error::other("raster_overviews input.tif output.tif"));
    }
    let input = PathBuf::from(&args[0]);
    let output = PathBuf::from(&args[1]);
    if input == output {
        return Err(io::Error::other("Write a new immutable raster asset"));
    }
    let mut decoder =
        Decoder::new(BufReader::new(File::open(&input)?)).map_err(io::Error::other)?;
    let (width, height) = decoder.dimensions().map_err(io::Error::other)?;
    let span = decoder
        .get_tag_f64_vec(Tag::ModelPixelScaleTag)
        .map_err(io::Error::other)?;
    let origin = decoder
        .get_tag_f64_vec(Tag::ModelTiepointTag)
        .map_err(io::Error::other)?;
    let grid = RasterGrid {
        width,
        height,
        bounds: Bounds(
            origin[3],
            origin[4] - f64::from(height) * span[1],
            origin[3] + f64::from(width) * span[0],
            origin[4],
        ),
    };
    let mut storage = Coverage::samples(
        0,
        BlockCache::new(
            64 * 1024 * 1024,
            BlockScratch::new(NativeScratch::create_new(output.with_extension("blocks"))?),
        ),
    );
    let raster = read_window(
        BufReader::new(File::open(input)?),
        &Window {
            col: 0,
            row: 0,
            grid,
        },
        &mut storage,
    )?;
    futures::executor::block_on(geotiff::write(
        BufWriter::new(File::create_new(output)?),
        &raster,
        &mut storage,
        &NativeControl::new(CancellationToken::default(), |_| {}),
    ))
}
