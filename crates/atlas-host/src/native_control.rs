use atlas_generation::control::{
    CancellationToken, ControlResult, GenerationControl, GenerationProgress,
};

type ProgressObserver = dyn Fn(&GenerationProgress);
pub struct NativeControl {
    token: CancellationToken,
    report: Box<ProgressObserver>,
}
impl NativeControl {
    pub fn new(token: CancellationToken, report: impl Fn(&GenerationProgress) + 'static) -> Self {
        Self {
            token,
            report: Box::new(report),
        }
    }
}
impl GenerationControl for NativeControl {
    fn cancelled(&self) -> ControlResult<bool> {
        Ok(self.token.is_cancelled())
    }
    fn progress(&self, progress: &GenerationProgress) -> ControlResult<()> {
        (self.report)(progress);
        Ok(())
    }
    async fn yield_control(&self) -> ControlResult<()> {
        std::thread::yield_now();
        Ok(())
    }
}
