//! One browser-worker invocation of the shared generator. All handles belong to this worker.
use crate::{browser_control::GenerationCallbacks, generation_output::Observations};
use atlas_generation::{
    atlas::{
        history::{Diagnostic, GenerationEpoch},
        preview::Preview,
    },
    execution::{ExecutionError, ExecutionResult},
};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    #[derive(Clone)]
    pub type BrowserGenerationHost;
    #[wasm_bindgen(method, getter, catch)]
    pub(crate) fn control(this: &BrowserGenerationHost) -> Result<GenerationCallbacks, JsValue>;
    #[wasm_bindgen(method, catch, js_name = diagnostic)]
    fn report_diagnostic(this: &BrowserGenerationHost, json: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = preview)]
    fn show_preview(this: &BrowserGenerationHost, json: &str) -> Result<js_sys::Promise, JsValue>;
    #[wasm_bindgen(method, js_name = workProgress)]
    pub(crate) fn work_progress(this: &BrowserGenerationHost, fraction: f64, message: &str);
    #[wasm_bindgen(method, catch, js_name = mapChanged)]
    pub(crate) fn map_changed(this: &BrowserGenerationHost, reference: &str)
        -> Result<(), JsValue>;
}
fn failure(error: impl std::fmt::Debug) -> ExecutionError {
    ExecutionError::Failed(format!("Browser generation: {error:?}"))
}
impl Observations for BrowserGenerationHost {
    fn diagnostic(&mut self, diagnostic: &Diagnostic) -> ExecutionResult<()> {
        self.report_diagnostic(&serde_json::to_string(diagnostic).map_err(failure)?)
            .map_err(failure)
    }
    async fn preview(
        &mut self,
        preview: &Preview,
        ancestry: Option<&[GenerationEpoch]>,
    ) -> ExecutionResult<()> {
        let value = serde_json::json!({"grid": preview, "ancestry": ancestry});
        JsFuture::from(self.show_preview(&value.to_string()).map_err(failure)?)
            .await
            .map_err(failure)?;
        Ok(())
    }
}
