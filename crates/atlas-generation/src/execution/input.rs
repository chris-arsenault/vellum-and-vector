//! Invocation inputs are scoped to dispatch, separate from the canonical mutable state.
use super::{ExecutionError, ExecutionResult};
use std::{
    any::Any,
    cell::{Cell, RefCell},
    rc::Rc,
};

#[derive(Default)]
pub(super) struct Inputs {
    current: RefCell<Option<Rc<dyn Any>>>,
    revision: Cell<u64>,
}
pub(super) struct BoundInput {
    inputs: Rc<Inputs>,
    previous: Option<Rc<dyn Any>>,
}
impl Inputs {
    pub fn revision(&self) -> u64 {
        self.revision.get()
    }
    pub fn current(&self) -> Option<Rc<dyn Any>> {
        self.current.borrow().clone()
    }
    pub fn bind<P: Any>(self: &Rc<Self>, input: Rc<P>) -> BoundInput {
        let previous = self.current.replace(Some(input));
        self.revision.set(self.revision.get().wrapping_add(1));
        BoundInput {
            inputs: self.clone(),
            previous,
        }
    }
}
impl Drop for BoundInput {
    fn drop(&mut self) {
        self.inputs.current.replace(self.previous.take());
        self.inputs
            .revision
            .set(self.inputs.revision.get().wrapping_add(1));
    }
}
pub(super) fn get<P: Any>(input: Option<Rc<dyn Any>>) -> ExecutionResult<Rc<P>> {
    input
        .and_then(|value| value.downcast().ok())
        .ok_or(ExecutionError::MissingInvocationInput(
            std::any::type_name::<P>(),
        ))
}
