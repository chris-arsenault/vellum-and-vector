//! Port of the supplied 25-sample browser fixture. No generation process runs.
mod records;
mod samples;
use atlas_generation::{
    control::CancellationToken,
    storage::{BlockCache, BlockScratch},
};
use atlas_gis::{
    geometry::NativeGeos,
    map_files::MapFiles,
    map_store::{MapStore, SaveRequest},
    sql::Database,
};
use atlas_host::{
    finished_map, generation_world::CreateWorld, native::NativeScratch,
    native_control::NativeControl, native_map_assets::NativeMapAssets,
    native_resources::NativeResources, record_store::Workspace,
};
use atlas_map::{regions::rectangle, Bounds, MapRef};
use serde_json::json;
use std::{fs, io, path::Path, rc::Rc};

fn main() -> io::Result<()> {
    let root = std::env::temp_dir().join(format!("atlas-ui-fixture-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("generation"))?;
    let result = futures::executor::block_on(publish(&root));
    fs::remove_dir_all(root)?;
    result
}
async fn publish(root: &Path) -> io::Result<()> {
    let mut document = CreateWorld {
        id: "edfcf658-e7d1-42d9-b388-9ec1fdb055f1".into(),
        name: "Published island".into(),
        seed: 1,
        width: 100.0,
        height: 100.0,
        settings: None,
        boundary_mode: Some("none".into()),
    }
    .create()?;
    let records = Workspace::create(root.join("records.sqlite"))?;
    records::install(&mut document, &mut records.features())?;
    samples::install(&mut document, root.join("generation")).await?;
    let reference = MapRef {
        map_id: document.scope.located.area_id.clone(),
        revision: "published".into(),
    };
    let geography = finished_map::FieldGeography {
        id: "supplied-map".into(),
        scope: document.scope.located.clone(),
        ocean: Some(Some(rectangle(Bounds(0.0, 0.0, 20.0, 100.0)))),
        lakes: Vec::new(),
    };
    let cache = BlockCache::resident(
        8_000_000,
        BlockScratch::new(NativeScratch::create_new(root.join("scratch.blocks"))?),
    );
    let spatial = NativeGeos::new(1e-6).map_err(io::Error::other)?;
    let product = finished_map::Request::from_document(document, reference.clone(), None, None)?
        .prepare(
            Rc::new(NativeResources::new(root.join("generation"))),
            cache.clone(),
            &[geography],
            &records.features(),
            &spatial,
        )?;
    let mut maps = MapStore::open_database(Rc::new(Database::open(root.join("maps.sqlite"))?))?;
    let mut assets = NativeMapAssets::new(MapFiles::new(root.join("map-assets")), cache);
    product
        .publish(
            &records.features(),
            &spatial,
            &mut maps,
            &mut assets,
            &NativeControl::new(CancellationToken::default(), |_| {}),
        )
        .await?;
    maps.save(
        SaveRequest {
            reference: reference.clone(),
            expected_version: None,
            navigation: maps.access().read_navigation(&reference)?,
            settings: Default::default(),
        },
        "2026-11-14T00:00:00Z".into(),
    )?;
    drop(maps);
    let mut files =
        vec![json!({"path":["maps.sqlite"], "bytes":fs::read(root.join("maps.sqlite"))?})];
    for entry in fs::read_dir(root.join("map-assets"))? {
        let entry = entry?;
        files.push(json!({"path":["map-assets",entry.file_name().to_string_lossy()],"bytes":fs::read(entry.path())?}));
    }
    let output =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.artifacts/browser-fixture.json");
    fs::create_dir_all(output.parent().unwrap())?;
    fs::write(
        output,
        serde_json::to_vec(&json!({"reference":reference,"files":files}))?,
    )
}
