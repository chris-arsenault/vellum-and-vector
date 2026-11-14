use atlas_generation::control::{
    ControlError, ControlResult, GenerationControl, GenerationProgress,
};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    pub type GenerationCallbacks;
    #[wasm_bindgen(method,catch,js_name=cancelled)]
    fn is_cancelled(this: &GenerationCallbacks) -> Result<bool, JsValue>;
    #[wasm_bindgen(method,catch,js_name=progress)]
    fn report(this: &GenerationCallbacks, progress: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = MessageChannel)]
    type EventChannel;
    #[wasm_bindgen(constructor, catch, js_class = MessageChannel)]
    fn new() -> Result<EventChannel, JsValue>;
    #[wasm_bindgen(method, getter)]
    fn port1(this: &EventChannel) -> EventPort;
    #[wasm_bindgen(method, getter)]
    fn port2(this: &EventChannel) -> EventPort;
    #[wasm_bindgen(js_name = MessagePort)]
    type EventPort;
    #[wasm_bindgen(method, setter, js_name = onmessage)]
    fn set_onmessage(this: &EventPort, callback: Option<&js_sys::Function>);
    #[wasm_bindgen(method, catch, js_name = postMessage)]
    fn post_message(this: &EventPort, value: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method)]
    fn close(this: &EventPort);
}
pub struct BrowserControl {
    host: GenerationCallbacks,
}
impl BrowserControl {
    pub fn new(host: GenerationCallbacks) -> Self {
        Self { host }
    }
}
fn failure(error: JsValue) -> ControlError {
    ControlError::Host(format!("Browser lifecycle: {error:?}"))
}
impl GenerationControl for BrowserControl {
    fn cancelled(&self) -> ControlResult<bool> {
        self.host.is_cancelled().map_err(failure)
    }
    fn progress(&self, progress: &GenerationProgress) -> ControlResult<()> {
        let json =
            serde_json::to_string(progress).map_err(|e| ControlError::Host(e.to_string()))?;
        self.host.report(&json).map_err(failure)
    }
    async fn yield_control(&self) -> ControlResult<()> {
        // owner-direction(2026-11-14): generation must be Rust only
        // Bind the browser event loop directly; no TypeScript scheduling callback or timer.
        let channel = EventChannel::new().map_err(failure)?;
        let receive = channel.port1();
        let send = channel.port2();
        let pending = js_sys::Promise::new(&mut |resolve, reject| {
            receive.set_onmessage(Some(&resolve));
            if let Err(error) = send.post_message(&JsValue::NULL) {
                let _ = reject.call1(&JsValue::UNDEFINED, &error);
            }
        });
        let result = JsFuture::from(pending).await.map_err(failure);
        receive.set_onmessage(None);
        receive.close();
        send.close();
        result.map(|_| ())
    }
}
