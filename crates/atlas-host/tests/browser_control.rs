#![cfg(target_arch = "wasm32")]
use atlas_generation::control::{ControlError, GenerationControl, GenerationProgress};
use atlas_host::browser_control::{BrowserControl, GenerationCallbacks};
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::wasm_bindgen_test as test;

#[wasm_bindgen(inline_js = "
export function callbacks(fail) {
    let cancelled = false;
    queueMicrotask(() => { cancelled = true; });
    return {
        cancelled() { if(fail) throw new Error('supplied cancellation failure'); return cancelled; },
        progress(value) { const event=JSON.parse(value); if(event.path[0] !== 'supplied') throw new Error('path'); },
        yieldControl() { throw new Error('Rust must own scheduling'); }
    };
}
")]
extern "C" {
    fn callbacks(fail: bool) -> GenerationCallbacks;
}

#[test]
async fn worker_yields_allow_cancellation_before_the_next_work_unit() {
    let control = BrowserControl::new(callbacks(false));
    control
        .progress(&GenerationProgress {
            path: vec!["supplied".into()],
            fraction: 0.25,
            message: "Working".into(),
        })
        .unwrap();
    assert_eq!(control.check(), Ok(()));
    assert_eq!(control.cooperate().await, Err(ControlError::Cancelled));
}
#[test]
async fn rejected_host_cancellation_is_a_typed_failure() {
    let control = BrowserControl::new(callbacks(true));
    assert!(matches!(
        control.cooperate().await,
        Err(ControlError::Host(_))
    ));
}
