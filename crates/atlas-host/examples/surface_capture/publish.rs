//! Reopen captured resources through the same finished-map producer as both application hosts.
use atlas_generation::{
    control::CancellationToken,
    storage::{BlockCache, BlockScratch},
};
use atlas_gis::{geometry::NativeGeos, map_files::MapFiles, map_store::MapStore, sql::Database};
use atlas_host::{
    finished_map, generation_document::Document, native::NativeScratch,
    native_control::NativeControl, native_map_assets::NativeMapAssets,
    native_resources::NativeResources, record_store::Workspace,
};
use atlas_map::{LayerSource, MapRef};
use serde::{Deserialize, Serialize};
use std::{io, path::Path, rc::Rc, time::Instant};

#[derive(Serialize, Deserialize)]
pub struct Saved {
    pub document: Document,
    pub geography: Vec<serde_json::Value>,
}
pub async fn saved(root: &Path) -> io::Result<()> {
    let saved: Saved = serde_json::from_slice(&std::fs::read(root.join("completed.json"))?)?;
    let records = Workspace::open(Rc::new(Database::open(root.join("records.sqlite"))?))?;
    let mut maps = MapStore::open_database(Rc::new(Database::open(root.join("maps.sqlite"))?))?;
    let reference = MapRef {
        map_id: saved.document.scope.located.area_id.clone(),
        revision: uuid::Uuid::new_v4().to_string(),
    };
    let expected = maps.find_head(&reference.map_id)?;
    let geography = saved
        .geography
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<Vec<finished_map::FieldGeography>, _>>()?;
    let cache = BlockCache::new(
        256 * 1024 * 1024,
        BlockScratch::new(NativeScratch::create_new(
            root.join(format!("publication-{}.blocks", reference.revision)),
        )?),
    );
    let spatial = NativeGeos::new(1e-6).map_err(io::Error::other)?;
    let product =
        finished_map::Request::from_document(saved.document, reference.clone(), expected, None)?
            .prepare(
                Rc::new(NativeResources::new(root.join("resources"))),
                cache.clone(),
                &geography,
                &records.features(),
                &spatial,
            )?;
    let files = MapFiles::new(root.join("maps"));
    let mut assets = NativeMapAssets::new(files.clone(), cache);
    let control = NativeControl::new(CancellationToken::default(), |p| {
        if p.path.iter().any(|p| p == "map-publication") {
            eprintln!("{}", p.message);
        }
    });
    let started = Instant::now();
    product
        .publish(
            &records.features(),
            &spatial,
            &mut maps,
            &mut assets,
            &control,
        )
        .await?;
    let descriptor = maps.open(&reference)?;
    std::fs::write(root.join("map.json"), serde_json::to_vec(&descriptor)?)?;
    let terrain = descriptor
        .layers
        .iter()
        .find(|layer| layer.id == "terrain")
        .ok_or_else(|| io::Error::other("Missing published terrain"))?;
    if let LayerSource::Raster(source) = &terrain.source {
        let asset = maps.asset(&reference, &source.asset_id)?;
        let path = files.path(&asset.location)?;
        std::fs::write(
            root.join("terrain.json"),
            serde_json::to_vec(
                &serde_json::json!({"path":path,"bytes":std::fs::metadata(&path)?.len(),"publicationMs":started.elapsed().as_secs_f64()*1000.0,"dimensions":[source.width,source.height]}),
            )?,
        )?;
        eprintln!(
            "Terrain: {} ({} bytes)",
            path.display(),
            std::fs::metadata(&path)?.len()
        );
    }
    eprintln!("Normal finished-map publication: {:?}", started.elapsed());
    Ok(())
}
