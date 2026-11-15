use crate::{map_files::MapFiles, map_store::MapStore, sql::Database};
use atlas_map::MapRef;
use std::{io, rc::Rc};
use wasm_bindgen::prelude::*;
// Arconis: docs/architecture/subsystems.arconis#item=sqlite — WASM bindings the facade reaches through the worker.
#[wasm_bindgen]
impl MapStore {
    #[wasm_bindgen(js_name = contains)]
    pub fn contains_json(&self, reference: &str) -> Result<bool, JsValue> {
        let reference = serde_json::from_str(reference).map_err(|e| js_error(e.into()))?;
        self.contains(&reference).map_err(js_error)
    }
    #[wasm_bindgen(js_name = copy_from)]
    pub fn copy_from_json(&self, source: &str, reference: &str) -> Result<(), JsValue> {
        let reference = serde_json::from_str(reference).map_err(|e| js_error(e.into()))?;
        self.copy_from(source, &reference).map_err(js_error)
    }
    #[wasm_bindgen(js_name = save_references)]
    pub fn save_references_json(&self, request: &str) -> Result<String, JsValue> {
        let run = || -> io::Result<String> {
            let request = serde_json::from_str(request)?;
            Ok(serde_json::to_string(&self.save_references(&request)?)?)
        };
        run().map_err(js_error)
    }
    #[wasm_bindgen(js_name = save_from)]
    pub fn save_from_json(
        &self,
        source: &str,
        request: &str,
        time: String,
    ) -> Result<String, JsValue> {
        let run = || -> io::Result<String> {
            let request = serde_json::from_str(request)?;
            Ok(serde_json::to_string(
                &self.save_from(source, request, time)?,
            )?)
        };
        run().map_err(js_error)
    }
    #[wasm_bindgen(js_name = related_with)]
    pub fn related_with_json(&self, source: &str, reference: &str) -> Result<String, JsValue> {
        let run = || -> io::Result<String> {
            let reference = serde_json::from_str(reference)?;
            Ok(serde_json::to_string(
                &self.related_with(source, &reference)?,
            )?)
        };
        run().map_err(js_error)
    }
    #[wasm_bindgen(constructor)]
    pub fn new(path: &str) -> Result<MapStore, JsValue> {
        MapStore::open_database(Rc::new(Database::open(path).map_err(js_error)?)).map_err(js_error)
    }
    #[wasm_bindgen(js_name = execute)]
    pub fn execute_json(&self, input: &str) -> Result<String, JsValue> {
        let run = || -> io::Result<String> {
            let operation = serde_json::from_str(input)?;
            Ok(serde_json::to_string(&self.clone().execute(operation)?)?)
        };
        run().map_err(js_error)
    }
    pub async fn navigate(&self, input: &str, directory: &str) -> Result<String, JsValue> {
        let files = MapFiles::new(directory);
        let run = async {
            let operation = serde_json::from_str(input)?;
            let value = self
                .access()
                .navigate(operation, |asset| {
                    let files = &files;
                    async move { files.read(&asset.location) }
                })
                .await?;
            serde_json::to_string(&value).map_err(io::Error::other)
        };
        run.await.map_err(js_error)
    }
    pub fn export(&self, reference: &str, format: &str) -> Result<Vec<u8>, JsValue> {
        let run = || -> io::Result<Vec<u8>> {
            let reference: MapRef = serde_json::from_str(reference)?;
            let mut bytes = Vec::new();
            self.access().export(&reference, format, &mut bytes)?;
            Ok(bytes)
        };
        run().map_err(js_error)
    }
}
fn js_error(error: io::Error) -> JsValue {
    js_sys::Error::new(&error.to_string()).into()
}
