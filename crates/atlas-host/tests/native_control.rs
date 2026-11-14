#![cfg(not(target_arch = "wasm32"))]
use atlas_generation::control::{
    CancellationToken, ControlError, GenerationControl, GenerationProgress,
};
use atlas_host::native_control::NativeControl;
use std::{
    cell::RefCell,
    future::Future,
    rc::Rc,
    task::{Context, Poll, Waker},
};

#[test]
fn native_control_observes_shared_cancellation_and_reports_progress() {
    let token = CancellationToken::default();
    let reports = Rc::new(RefCell::new(Vec::new()));
    let report = reports.clone();
    let control = NativeControl::new(token.clone(), move |progress| {
        report.borrow_mut().push(progress.clone())
    });
    let progress = GenerationProgress {
        path: vec!["supplied".into()],
        fraction: 0.25,
        message: "Working".into(),
    };
    control.progress(&progress).unwrap();
    assert_eq!(reports.borrow().as_slice(), [progress]);
    assert_eq!(
        Box::pin(control.cooperate())
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop())),
        Poll::Ready(Ok(()))
    );
    std::thread::spawn(move || token.cancel()).join().unwrap();
    assert_eq!(control.check(), Err(ControlError::Cancelled));
}
