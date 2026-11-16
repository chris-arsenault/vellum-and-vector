//! Browser application ownership: working views, retained job results and explicit saves.
use crate::{browser_job::BrowserJob, local_inputs::LocalInputs};
use atlas_gis::{
    map_files::MapFiles,
    map_protocol::{EditingCall, LibraryCall, NavigationCall, ReadCall},
    map_store::{codec, MapAccess, MapStore},
    sql::Database,
};
use atlas_map::MapRef;
use std::{cell::RefCell, collections::BTreeSet, io, path::PathBuf, rc::Rc};
use wasm_bindgen::prelude::*;

const SAVED_MAPS: &str = "/atlas/maps.sqlite";
const SAVED_INPUTS: &str = "/atlas/inputs.sqlite";
const RESOURCES: &str = "/atlas/generation-resources";
const ASSETS: &str = "/atlas/map-assets";
pub(crate) const JOBS: &str = "/atlas/generation-jobs";
mod contexts;
mod jobs;

#[wasm_bindgen]
pub struct BrowserWorkspace {
    maps: MapStore,
    directory: PathBuf,
    map_path: String,
    input_path: String,
    running: Rc<RefCell<BTreeSet<String>>>,
}
#[wasm_bindgen]
impl BrowserWorkspace {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<BrowserWorkspace, JsValue> {
        let directory = PathBuf::from(format!("/tmp/atlas-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).map_err(error)?;
        let map_path = directory.join("maps.sqlite").to_string_lossy().into_owned();
        let input_path = directory
            .join("inputs.sqlite")
            .to_string_lossy()
            .into_owned();
        let maps = MapStore::open_database(Rc::new(Database::open(&map_path).map_err(error)?))
            .map_err(error)?;
        MapFiles::new(ASSETS).ensure_directory().map_err(error)?;
        Ok(Self {
            maps,
            directory,
            map_path,
            input_path,
            running: Default::default(),
        })
    }
    pub fn read(&self, request: &str) -> Result<Vec<u8>, JsValue> {
        let call: ReadCall = serde_json::from_str(request).map_err(error)?;
        self.ensure(call.reference()).map_err(error)?;
        if let ReadCall::Source(reference, id) = call {
            let asset = self.maps.access().asset(&reference, &id).map_err(error)?;
            MapFiles::new(ASSETS).path(&asset.location).map_err(error)?;
            return codec::encode(&serde_json::json!({
                "mediaType": asset.media_type,
                "path": ["map-assets", asset.location],
            }))
            .map_err(error);
        }
        call.execute(self.maps.access(), &MapFiles::new(ASSETS))
            .map_err(error)
    }
    pub async fn navigate(&self, request: &str) -> Result<Vec<u8>, JsValue> {
        let call: NavigationCall = serde_json::from_str(request).map_err(error)?;
        self.ensure(call.reference()).map_err(error)?;
        call.execute(self.maps.access(), &MapFiles::new(ASSETS))
            .await
            .map_err(error)
    }
    /// Real-scale authoring writes the working catalog; **Save map** keeps it across reloads.
    pub fn edit(&self, request: &str) -> Result<Vec<u8>, JsValue> {
        let call: EditingCall = serde_json::from_str(request).map_err(error)?;
        self.ensure(call.reference()).map_err(error)?;
        call.execute(self.maps.edits()).map_err(error)
    }
    pub fn library(&self, request: &str) -> Result<Vec<u8>, JsValue> {
        let call: LibraryCall = serde_json::from_str(request).map_err(error)?;
        self.library_call(call).map_err(error)
    }
    /// Private inputs are opened only for generation or explicit retention, never map reads.
    pub fn job(&self, reference: Option<String>) -> Result<BrowserJob, JsValue> {
        if let Some(reference) = reference {
            let reference: MapRef = serde_json::from_str(&reference).map_err(error)?;
            self.ensure(&reference).map_err(error)?;
            self.ensure_inputs(&reference).map_err(error)?;
        }
        let directory = self.directory.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&directory).map_err(error)?;
        BrowserJob::new(
            &self.input_path,
            &directory.join("records.sqlite").to_string_lossy(),
            &self.maps,
            RESOURCES,
            ASSETS,
            &directory.to_string_lossy(),
        )
    }
}
impl BrowserWorkspace {
    fn saved(&self) -> io::Result<MapStore> {
        MapStore::open_database(Rc::new(Database::open(SAVED_MAPS)?))
    }
    fn ensure(&self, reference: &MapRef) -> io::Result<()> {
        if !self.maps.contains(reference)? {
            let saved = self.saved()?;
            saved.open(reference)?;
            self.maps.copy_from(SAVED_MAPS, reference)?;
        }
        Ok(())
    }
    fn library_call(&self, call: LibraryCall) -> io::Result<Vec<u8>> {
        let saved = self.saved()?;
        match call {
            LibraryCall::Save((request,)) => {
                self.ensure(&request.reference)?;
                let references = self.maps.save_references(&request)?;
                for reference in &references {
                    // A GIS-only imported map can be saved without private inputs.
                    self.copy_available_inputs(reference)?;
                }
                if std::path::Path::new(&self.input_path).exists() {
                    let inputs = LocalInputs::open(Rc::new(Database::open(SAVED_INPUTS)?))?;
                    inputs.copy_from(&self.input_path, &references)?;
                }
                codec::encode(&saved.save_from(&self.map_path, request, now())?)
            }
            LibraryCall::Open((id,)) => {
                let document = saved.open_saved(&id)?;
                self.maps
                    .copy_from(SAVED_MAPS, &document.summary.reference)?;
                codec::encode(&document)
            }
            LibraryCall::Related((reference,)) => {
                self.ensure(&reference)?;
                codec::encode(&self.maps.related_with(SAVED_MAPS, &reference)?)
            }
            other => other.execute(saved.access(), now()),
        }
    }
}
impl Drop for BrowserWorkspace {
    fn drop(&mut self) {
        // Working catalogs are temporary. Immutable resource bytes live independently.
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
fn now() -> String {
    js_sys::Date::new_0().to_iso_string().into()
}
fn error(value: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&value.to_string()).into()
}
