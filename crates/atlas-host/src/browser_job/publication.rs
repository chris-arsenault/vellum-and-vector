use super::{error, BrowserJob};
use crate::{
    browser_control::BrowserControl, browser_generation::BrowserGenerationHost, finished_map,
    native::NativeScratch, native_map_assets::NativeMapAssets, numerical_resource::Store,
};
use atlas_generation::storage::{BlockCache, BlockScratch};
use atlas_gis::geometry::NativeGeos;
use atlas_map::MapRef;
use wasm_bindgen::prelude::*;
impl BrowserJob {
    pub(super) async fn publish(
        &mut self,
        request: finished_map::Request,
        cache_bytes: usize,
        host: &BrowserGenerationHost,
    ) -> Result<(), JsValue> {
        let resources = self.resources.clone();
        host.work_progress(0.0, "Opening captured map geography");
        let mut geography = Vec::new();
        for (_, reference) in request.references().map_err(error)? {
            let descriptor = resources.describe(&reference.resource_id).map_err(error)?;
            let field = descriptor
                .field
                .ok_or_else(|| error("Map fields retain their geography"))?;
            geography.push(
                serde_json::from_value(
                    self.private
                        .geography(&descriptor.scope, &field.geography_id)
                        .map_err(error)?,
                )
                .map_err(error)?,
            );
        }
        let cache = BlockCache::new(
            cache_bytes,
            BlockScratch::new(
                NativeScratch::create_new(self.scratch.join("publication.blocks"))
                    .map_err(error)?,
            ),
        );
        let mut assets = NativeMapAssets::new(self.assets.clone(), cache.clone());
        let spatial = NativeGeos::new(request.world.geography.reference.precision.unwrap_or(1e-6))
            .map_err(error)?;
        host.work_progress(0.0, "Preparing map layers");
        let product = request
            .prepare(
                resources,
                cache,
                &geography,
                &self.records.features(),
                &spatial,
            )
            .map_err(error)?;
        product
            .publish(
                &self.records.features(),
                &spatial,
                &mut crate::observed_publication::Observed {
                    publisher: &mut self.maps,
                    visible: false,
                    changed: |reference: &MapRef| {
                        host.map_changed(&serde_json::to_string(reference)?)
                            .map_err(|e| std::io::Error::other(format!("{e:?}")))
                    },
                },
                &mut assets,
                &BrowserControl::new(host.control()?),
            )
            .await
            .map_err(error)?;
        Ok(())
    }
}
