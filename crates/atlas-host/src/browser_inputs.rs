//! Local database bindings for completed generation inputs, separate from GIS readers.
use crate::local_inputs::LocalInputs;
use atlas_gis::sql::Database;
use std::{io, rc::Rc};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl LocalInputs {
    #[wasm_bindgen(constructor)]
    pub fn new(path: &str) -> Result<LocalInputs, JsValue> {
        LocalInputs::open(Rc::new(Database::open(path).map_err(error)?)).map_err(error)
    }
    #[wasm_bindgen(js_name = copy_from)]
    pub fn copy_from_json(&self, source: &str, references: &str) -> Result<(), JsValue> {
        let run = || -> io::Result<()> {
            self.copy_from(source, &serde_json::from_str::<Vec<_>>(references)?)
        };
        run().map_err(error)
    }
}
fn error(value: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&value.to_string()).into()
}
