//! A captured child shows its parent's published geography until it is refined, so its rasters
//! are pixel windows of the parent's published rasters. Nothing is sampled again: each parent
//! asset is read once, cleared outside the child's footprint and written as the child's asset.
use super::raster::{MapRaster, RasterGrid, Resampling};
use crate::storage::{Band, Coverage};
use atlas_map::{spatial::SpatialKernel, Bounds, Geometry, MapLayer, Position, RasterBand};
use std::io::{self, Read, Seek};
use tiff::{
    decoder::{Decoder, DecodingResult},
    tags::Tag,
};

pub trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}
/// Opens one of the parent's published assets by identity.
pub type OpenAsset = Box<dyn Fn(&str) -> io::Result<Box<dyn ReadSeek>>>;

/// The parent's published raster layers, and their assets opened by identity.
pub struct ParentRasters {
    pub layers: Vec<MapLayer>,
    pub open: OpenAsset,
}
/// Parent pixels in rows and columns from the parent's north-west corner.
#[derive(Clone, Copy, PartialEq)]
pub struct Window {
    pub col: u32,
    pub row: u32,
    pub grid: RasterGrid,
}
fn error(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}
/// The parent pixels whose extent meets `bounds`, kept on the parent's own pixel lattice.
pub fn window(parent: RasterGrid, bounds: Bounds) -> Option<Window> {
    let [dx, dy] = parent.pixel_span();
    let Bounds(west, _, _, north) = parent.bounds;
    let first_col = ((bounds.0 - west) / dx).floor().max(0.0);
    let last_col = ((bounds.2 - west) / dx).ceil().min(f64::from(parent.width));
    let first_row = ((north - bounds.3) / dy).floor().max(0.0);
    let last_row = ((north - bounds.1) / dy)
        .ceil()
        .min(f64::from(parent.height));
    if last_col <= first_col || last_row <= first_row {
        return None;
    }
    Some(Window {
        col: first_col as u32,
        row: first_row as u32,
        grid: RasterGrid {
            width: (last_col - first_col) as u32,
            height: (last_row - first_row) as u32,
            bounds: Bounds(
                west + first_col * dx,
                north - last_row * dy,
                west + last_col * dx,
                north - first_row * dy,
            ),
        },
    })
}
/// Overviews average measured bands and keep the dominant class of categorical ones.
fn resampling(band: &RasterBand) -> Resampling {
    if band.unit == "category" || !band.categories.is_empty() {
        Resampling::Category
    } else {
        Resampling::Mean
    }
}
/// The window of a published GeoTIFF's full-resolution image: its display bands, then coverage.
pub fn read_window(
    reader: impl Read + Seek,
    window: &Window,
    storage: &mut Coverage,
) -> io::Result<MapRaster> {
    let mut decoder = Decoder::new(reader).map_err(error)?;
    let definitions: Vec<RasterBand> = serde_json::from_str(
        &decoder
            .get_tag_ascii_string(Tag::ImageDescription)
            .map_err(error)?,
    )?;
    let definitions = definitions
        .into_iter()
        .map(|band| {
            let resampling = resampling(&band);
            (band, resampling)
        })
        .collect();
    let mut raster = MapRaster::new(window.grid, definitions, storage)?;
    let (width, height) = decoder.dimensions().map_err(error)?;
    let (tile_width, tile_height) = decoder.chunk_dimensions();
    let layout = Tiles {
        across: width.div_ceil(tile_width),
        per_plane: width.div_ceil(tile_width) * height.div_ceil(tile_height),
        size: [tile_width, tile_height],
    };
    for plane in 0..=raster.planes.len() {
        let target = match raster.planes.get_mut(plane) {
            Some(plane) => &mut plane.values,
            None => &mut raster.coverage,
        };
        copy_plane(&mut decoder, &layout, plane as u32, window, target)?;
    }
    Ok(raster)
}
struct Tiles {
    across: u32,
    per_plane: u32,
    size: [u32; 2],
}
fn copy_plane<R: Read + Seek>(
    decoder: &mut Decoder<R>,
    tiles: &Tiles,
    plane: u32,
    window: &Window,
    target: &mut Band<f32>,
) -> io::Result<()> {
    let [tile_width, tile_height] = tiles.size;
    let (rows, cols) = (window.grid.height, window.grid.width);
    for tile_row in window.row / tile_height..=(window.row + rows - 1) / tile_height {
        for tile_col in window.col / tile_width..=(window.col + cols - 1) / tile_width {
            let index = plane * tiles.per_plane + tile_row * tiles.across + tile_col;
            let (data_width, data_height) = decoder.chunk_data_dimensions(index);
            let DecodingResult::F32(values) = decoder.read_chunk(index).map_err(error)? else {
                return Err(io::Error::other("Published map rasters hold 32-bit floats"));
            };
            for y in 0..data_height {
                let row = tile_row * tile_height + y;
                if row < window.row || row >= window.row + rows {
                    continue;
                }
                for x in 0..data_width {
                    let col = tile_col * tile_width + x;
                    if col < window.col || col >= window.col + cols {
                        continue;
                    }
                    let cell = ((row - window.row) * cols + col - window.col) as usize;
                    target.set(cell, values[(y * data_width + x) as usize])?;
                }
            }
        }
    }
    Ok(())
}
/// A map has no outside: pixels whose centre lies beyond the child's footprint carry no coverage.
pub fn clear_outside(
    raster: &mut MapRaster,
    footprint: &Geometry,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    let grid = raster.grid;
    let [dx, dy] = grid.pixel_span();
    for row in 0..grid.height {
        // hpc-exempt: one row of pixel centres for a batched geometry query.
        let centres: Vec<_> = (0..grid.width)
            .map(|col| {
                Position::xy(
                    grid.bounds.0 + (f64::from(col) + 0.5) * dx,
                    grid.bounds.3 - (f64::from(row) + 0.5) * dy,
                )
            })
            .collect();
        let inside = spatial
            .covers_points(footprint, &centres)
            .map_err(io::Error::other)?;
        for (col, inside) in inside.into_iter().enumerate() {
            if inside {
                continue;
            }
            let cell = row as usize * grid.width as usize + col;
            raster.coverage.set(cell, 0.0)?;
            for plane in &mut raster.planes {
                let id = &plane.definition.id;
                if id == "coverage" || id.ends_with(":coverage") {
                    plane.values.set(cell, 0.0)?;
                }
            }
        }
    }
    Ok(())
}
