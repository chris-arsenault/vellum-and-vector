//! Band values at a point, read from a map's published GeoTIFF rasters. Every published
//! channel is a raster layer whose `value` band holds it; a pixel without coverage holds no
//! value. Only the tile under a point is decoded, and a reader keeps the tiles it decoded
//! for the next points, so reading along a wall or under a footprint decodes each tile once.
use crate::{map_files::MapFiles, map_store::MapAccess};
use atlas_map::{BandValue, Bounds, Id, LayerSource, MapDescriptor, MapLayer, Position};
// hpc-exempt: a few decoded tiles and open files per reading, keyed by chunk and asset.
use std::collections::BTreeMap;
use std::{
    fs::File,
    io::{self, BufReader, Read, Seek},
};
use tiff::decoder::{Decoder, DecodingResult};

fn other(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}
/// One planar tiled GeoTIFF: chunks run band by band, tiles north-first within a band.
pub struct Raster<R: Read + Seek> {
    decoder: Decoder<R>,
    tile: (u32, u32),
    across: u32,
    per_band: u32,
    tiles: BTreeMap<u32, Vec<f32>>,
}
impl<R: Read + Seek> Raster<R> {
    pub fn new(reader: R) -> io::Result<Self> {
        let mut decoder = Decoder::new(reader).map_err(other)?;
        let (width, height) = decoder.dimensions().map_err(other)?;
        let tile = decoder.chunk_dimensions();
        let across = width.div_ceil(tile.0);
        Ok(Self {
            decoder,
            tile,
            across,
            per_band: across * height.div_ceil(tile.1),
            tiles: BTreeMap::new(),
        })
    }
    /// The sample of one-based TIFF band `band` at a pixel.
    pub fn sample(&mut self, band: u16, (column, row): (u32, u32)) -> io::Result<f32> {
        let band = u32::from(band)
            .checked_sub(1)
            .ok_or_else(|| other("TIFF bands are one-based"))?;
        let chunk = band * self.per_band + (row / self.tile.1) * self.across + column / self.tile.0;
        let width = self.decoder.chunk_data_dimensions(chunk).0;
        if !self.tiles.contains_key(&chunk) {
            let DecodingResult::F32(values) = self.decoder.read_chunk(chunk).map_err(other)? else {
                return Err(other("Published map rasters hold 32-bit floats"));
            };
            self.tiles.insert(chunk, values);
        }
        let (x, y) = (column % self.tile.0, row % self.tile.1);
        self.tiles[&chunk]
            .get((y * width + x) as usize)
            .copied()
            .ok_or_else(|| other("Pixel outside its decoded tile"))
    }
}
/// The pixel under a position: columns from the west edge, rows from the north edge. The
/// east and north edges belong to the last pixel.
pub fn pixel(bounds: Bounds, width: u32, height: u32, position: Position) -> Option<(u32, u32)> {
    let [x, y, _] = position.coordinates();
    let Bounds(w, s, e, n) = bounds;
    if !(w..=e).contains(&x) || !(s..=n).contains(&y) || e <= w || n <= s {
        return None;
    }
    let column = (((x - w) / (e - w)) * f64::from(width)).floor() as u32;
    let row = (((n - y) / (n - s)) * f64::from(height)).floor() as u32;
    Some((column.min(width - 1), row.min(height - 1)))
}
/// A raster layer's channel value at a position; none outside it or where it has no coverage.
pub fn layer_value<R: Read + Seek>(
    raster: &mut Raster<R>,
    layer: &MapLayer,
    position: Position,
) -> io::Result<Option<BandValue>> {
    let (LayerSource::Raster(source) | LayerSource::Attributes(source)) = &layer.source else {
        return Ok(None);
    };
    let Some(at) = pixel(layer.bounds, source.width, source.height, position) else {
        return Ok(None);
    };
    let tiff_band = |id: &str| {
        let index = source.bands.iter().position(|band| band.id == id)?;
        Some((&source.bands[index], *source.band_indices.get(index)?))
    };
    if let Some((_, coverage)) = tiff_band("coverage") {
        if raster.sample(coverage, at)? <= 0.0 {
            return Ok(None);
        }
    }
    let Some((band, index)) = tiff_band("value") else {
        return Ok(None);
    };
    let value = f64::from(raster.sample(index, at)?);
    Ok(Some(BandValue {
        layer_id: layer.id.clone(),
        band_id: band.id.clone(),
        value,
        unit: band.unit.clone(),
        label: band.name.clone(),
        display: band.display.clone(),
        category: band
            .categories
            .iter()
            .find(|class| f64::from(class.value) == value)
            .map(|class| class.label.clone()),
    }))
}
/// Readers for a map's published rasters, each opened when a layer first needs it.
pub struct MapRasters<'a> {
    files: &'a MapFiles,
    open: BTreeMap<String, Raster<BufReader<File>>>,
}
impl<'a> MapRasters<'a> {
    pub fn new(files: &'a MapFiles) -> Self {
        Self {
            files,
            open: BTreeMap::new(),
        }
    }
    /// The channel values at a position in one space of `map`, for the layers `wanted` keeps.
    pub fn values(
        &mut self,
        maps: &dyn MapAccess,
        map: &MapDescriptor,
        space: Id,
        position: Position,
        wanted: &dyn Fn(&MapLayer) -> bool,
    ) -> io::Result<Vec<BandValue>> {
        let mut values = Vec::new();
        for layer in map
            .layers
            .iter()
            .filter(|layer| layer.space_id == space && wanted(layer))
        {
            let (LayerSource::Raster(source) | LayerSource::Attributes(source)) = &layer.source
            else {
                continue;
            };
            let location = maps.asset(&map.reference, &source.asset_id)?.location;
            if !self.open.contains_key(&location) {
                let file = BufReader::new(self.files.open(&location)?);
                self.open.insert(location.clone(), Raster::new(file)?);
            }
            let raster = self.open.get_mut(&location).expect("Opened above");
            values.extend(layer_value(raster, layer, position)?);
        }
        Ok(values)
    }
}
