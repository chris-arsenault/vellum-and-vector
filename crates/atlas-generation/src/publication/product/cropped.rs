//! A captured child's rasters are windows of its parent's published raster assets.
use super::{Assets, Product, Target};
use crate::{
    control::{GenerationControl, GenerationProgress},
    publication::{crop, geotiff, raster::RasterGrid},
};
use atlas_map::{regions::as_geometry, LayerSource, MapDescriptor, MapLayer, Publisher};
use std::io;

impl Product<'_> {
    /// Each parent raster asset is read once and written once for the child, with every layer
    /// it holds; the pixels stay on the parent's lattice and nothing is sampled again.
    pub(super) async fn cropped_rasters(
        &self,
        map: &mut MapDescriptor,
        parent: &crop::ParentRasters,
        target: &mut Target<'_, impl Publisher, impl Assets>,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        let spatial = self.vectors.registry.spatial;
        let footprint = as_geometry(&map.footprint);
        let assets = parent_assets(&parent.layers);
        for (index, asset_id) in assets.iter().enumerate() {
            control
                .progress(&GenerationProgress {
                    path: vec!["map-publication".into()],
                    fraction: index as f64 / assets.len() as f64,
                    message: "Copying the parent map's layers".into(),
                })
                .map_err(|error| io::Error::other(format!("{error:?}")))?;
            let held: Vec<&MapLayer> = parent
                .layers
                .iter()
                .filter(|layer| raster_asset(layer) == Some(asset_id.as_str()))
                .collect();
            let (LayerSource::Raster(source) | LayerSource::Attributes(source)) = &held[0].source
            else {
                continue;
            };
            let grid = RasterGrid {
                width: source.width,
                height: source.height,
                bounds: held[0].bounds,
            };
            let Some(window) = crop::window(grid, map.bounds) else {
                continue;
            };
            let mut storage = target.assets.scratch()?;
            let mut raster = crop::read_window((parent.open)(asset_id)?, &window, &mut storage)?;
            crop::clear_outside(&mut raster, &footprint, spatial)?;
            let id = target.assets.identity()?;
            let mut writer = target.assets.create(&id, "image/tiff")?;
            geotiff::write(&mut writer, &raster, &mut storage, control).await?;
            let asset = target.assets.close(&id, "image/tiff", false, writer)?;
            let layers: Vec<MapLayer> = held
                .into_iter()
                .map(|layer| child_layer(layer, map, &id, &window))
                .collect();
            target
                .publisher
                .add_layers(&map.reference, &layers, asset)?;
            map.layers.extend(layers);
        }
        Ok(())
    }
}
fn raster_asset(layer: &MapLayer) -> Option<&str> {
    match &layer.source {
        LayerSource::Raster(source) | LayerSource::Attributes(source) => Some(&source.asset_id),
        LayerSource::Vector(_) => None,
    }
}
/// Distinct raster assets in the order the parent published them.
fn parent_assets(layers: &[MapLayer]) -> Vec<String> {
    // hpc-exempt: a handful of asset identities, not numerical field storage.
    let mut assets: Vec<String> = Vec::new();
    for id in layers.iter().filter_map(raster_asset) {
        if !assets.iter().any(|held| held == id) {
            assets.push(id.into());
        }
    }
    assets
}
fn child_layer(layer: &MapLayer, map: &MapDescriptor, id: &str, window: &crop::Window) -> MapLayer {
    let mut layer = layer.clone();
    layer.space_id = map.primary_space_id.clone();
    layer.bounds = window.grid.bounds;
    if let LayerSource::Raster(source) | LayerSource::Attributes(source) = &mut layer.source {
        source.asset_id = id.into();
        source.width = window.grid.width;
        source.height = window.grid.height;
    }
    layer
}
