//! Cooperative host scheduling and cancellation; no execution snapshots or restart state.
use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerationProgress {
    pub path: Vec<String>,
    pub fraction: f64,
    pub message: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ControlError {
    Cancelled,
    Host(String),
}
pub type ControlResult<T> = Result<T, ControlError>;

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);
impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

pub trait GenerationControl {
    fn cancelled(&self) -> ControlResult<bool>;
    fn progress(&self, progress: &GenerationProgress) -> ControlResult<()>;
    fn yield_control(&self) -> impl Future<Output = ControlResult<()>>;
    fn check(&self) -> ControlResult<()> {
        if self.cancelled()? {
            Err(ControlError::Cancelled)
        } else {
            Ok(())
        }
    }
    /// Check both sides of a host yield so queued worker cancellation wins before more work.
    fn cooperate(&self) -> impl Future<Output = ControlResult<()>> {
        async move {
            self.check()?;
            self.yield_control().await?;
            self.check()
        }
    }
}
