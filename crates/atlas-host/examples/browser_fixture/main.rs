//! Port of the supplied 25-sample browser fixture. No generation process runs.
mod child;
mod real_scale;
mod records;
mod samples;
mod structure;
mod town;
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
    finished_map,
    generation_document::Document,
    generation_world::CreateWorld,
    local_inputs::LocalInputs,
    native::NativeScratch,
    native_control::NativeControl,
    native_map_assets::NativeMapAssets,
    native_resources::NativeResources,
    numerical_resource::Store,
    record_store::{Features, Networks, Workspace},
};
use atlas_map::{regions::rectangle, Bounds, MapRef};
use serde_json::{json, Value};
use std::{cell::RefCell, fs, io, path::Path, rc::Rc};

pub struct Stores {
    maps: MapStore,
    inputs: LocalInputs,
    cache: Rc<RefCell<BlockCache>>,
    spatial: NativeGeos,
}
/// A map's retained inputs, published through the ordinary path.
pub struct Published {
    document: Document,
    reference: MapRef,
    features: Features,
    networks: Networks,
    geography: Vec<Value>,
    parent: Option<MapRef>,
}

fn main() -> io::Result<()> {
    let root = std::env::temp_dir().join(format!("atlas-ui-fixture-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("generation"))?;
    let result = futures::executor::block_on(publish(&root));
    fs::remove_dir_all(root)?;
    result
}
async fn publish(root: &Path) -> io::Result<()> {
    let mut stores = Stores {
        maps: MapStore::open_database(Rc::new(Database::open(root.join("maps.sqlite"))?))?,
        inputs: LocalInputs::open(Rc::new(Database::open(root.join("inputs.sqlite"))?))?,
        cache: BlockCache::resident(
            8_000_000,
            BlockScratch::new(NativeScratch::create_new(root.join("scratch.blocks"))?),
        ),
        spatial: NativeGeos::new(1e-6).map_err(io::Error::other)?,
    };
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
    let mut child_document: Document = serde_json::from_value(serde_json::to_value(&document)?)?;
    let mut village_document: Document = serde_json::from_value(serde_json::to_value(&document)?)?;
    let world = Published {
        document,
        reference: reference.clone(),
        features: records.features(),
        networks: records.networks(),
        geography: vec![serde_json::to_value(&geography)?],
        parent: None,
    };
    publish_map(root, &mut stores, world).await?;
    let child = child::capture(root, &mut stores, &reference, &records.features()).await?;
    // The real-scale glen (with the inn and its cave) and the village supply their own fields,
    // so they publish directly, without cropping the parent's rasters.
    let control = NativeControl::new(CancellationToken::default(), |_| {});
    let mut assets =
        NativeMapAssets::new(MapFiles::new(root.join("map-assets")), stores.cache.clone());
    let (cache, spatial, maps) = (stores.cache.clone(), &stores.spatial, &mut stores.maps);
    real_scale::child(&mut child_document, &reference)?;
    let Bounds(w, s, e, n) = real_scale::FRAME;
    samples::install_glen(&mut child_document, root.join("generation"), [w, s, e, n]).await?;
    let glen_geography = finished_map::FieldGeography {
        id: samples::GLEN_FIELD.into(),
        scope: child_document.scope.located.clone(),
        ocean: Some(None),
        lakes: Vec::new(),
    };
    let child_records = Workspace::create(root.join("child-records.sqlite"))?;
    real_scale::install(&mut child_records.features())?;
    structure::install(&mut child_records.features())?;
    let glen = MapRef {
        map_id: real_scale::CHILD.into(),
        revision: "published".into(),
    };
    finished_map::Request::from_document(
        child_document,
        glen.clone(),
        None,
        Some(reference.clone()),
    )?
    .prepare(
        Rc::new(NativeResources::new(root.join("generation"))),
        cache.clone(),
        &[glen_geography],
        &child_records.features(),
        spatial,
    )?
    .publish(
        &child_records.features(),
        spatial,
        maps,
        &mut assets,
        &control,
    )
    .await?;
    town::child(&mut village_document, &reference)?;
    let village_records = Workspace::create(root.join("village-records.sqlite"))?;
    town::install(&mut village_records.features())?;
    let village = MapRef {
        map_id: town::VILLAGE.into(),
        revision: "published".into(),
    };
    finished_map::Request::from_document(
        village_document,
        village.clone(),
        None,
        Some(reference.clone()),
    )?
    .prepare(
        Rc::new(NativeResources::new(root.join("generation"))),
        cache,
        &[],
        &village_records.features(),
        spatial,
    )?
    .publish(
        &village_records.features(),
        spatial,
        maps,
        &mut assets,
        &control,
    )
    .await?;
    drop(assets);
    let maps = stores.maps;
    for saved in [&reference, &glen, &village] {
        maps.save(
            SaveRequest {
                reference: saved.clone(),
                expected_version: None,
                navigation: maps.access().read_navigation(saved)?,
                settings: Default::default(),
            },
            "2026-11-14T00:00:00Z".into(),
        )?;
    }
    drop(maps);
    drop(stores.inputs);
    let mut files =
        vec![json!({"path":["maps.sqlite"], "bytes":fs::read(root.join("maps.sqlite"))?})];
    for entry in fs::read_dir(root.join("map-assets"))? {
        let entry = entry?;
        files.push(json!({"path":["map-assets",entry.file_name().to_string_lossy()],"bytes":fs::read(entry.path())?}));
    }
    files.push(json!({"path":["inputs.sqlite"],"bytes":fs::read(root.join("inputs.sqlite"))?}));
    collect_resources(
        &root.join("generation"),
        vec!["generation-resources".into()],
        &mut files,
    )?;
    let output =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.artifacts/browser-fixture.json");
    fs::create_dir_all(output.parent().unwrap())?;
    fs::write(
        output,
        serde_json::to_vec(&json!({"reference":reference,"child":child,"files":files}))?,
    )
}
/// Retain a map's inputs and publish it, resolving field geography as the job hosts do.
pub async fn publish_map(root: &Path, stores: &mut Stores, map: Published) -> io::Result<()> {
    stores.inputs.store(
        &map.reference,
        &map.document,
        &map.features,
        &map.networks,
        &map.geography,
    )?;
    let resources = Rc::new(NativeResources::new(root.join("generation")));
    let files = MapFiles::new(root.join("map-assets"));
    // A captured child crops its parent's published rasters, as Refine publishes it.
    let parent_rasters = map
        .parent
        .as_ref()
        .map(|parent| finished_map::parent_rasters(stores.maps.access(), &files, parent))
        .transpose()?;
    let request =
        finished_map::Request::from_document(map.document, map.reference, None, map.parent)?;
    let mut geography = Vec::new();
    for (_, reference) in request.references()? {
        let descriptor = resources.describe(&reference.resource_id)?;
        let field = descriptor
            .field
            .ok_or_else(|| io::Error::other("Map fields retain their geography"))?;
        geography.push(serde_json::from_value(
            stores
                .inputs
                .geography(&descriptor.scope, &field.geography_id)?,
        )?);
    }
    let mut product = request.prepare(
        resources,
        stores.cache.clone(),
        &geography,
        &map.features,
        &stores.spatial,
    )?;
    if let Some(rasters) = parent_rasters {
        product = product.with_parent_rasters(rasters);
    }
    let mut assets = NativeMapAssets::new(files, stores.cache.clone());
    product
        .publish(
            &map.features,
            &stores.spatial,
            &mut stores.maps,
            &mut assets,
            &NativeControl::new(CancellationToken::default(), |_| {}),
        )
        .await?;
    Ok(())
}
fn collect_resources(
    directory: &Path,
    path: Vec<String>,
    files: &mut Vec<serde_json::Value>,
) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let mut next = path.clone();
        next.push(entry.file_name().to_string_lossy().into_owned());
        if entry.file_type()?.is_dir() {
            collect_resources(&entry.path(), next, files)?;
        } else {
            files.push(json!({"path":next,"bytes":fs::read(entry.path())?}));
        }
    }
    Ok(())
}
