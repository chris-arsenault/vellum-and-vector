use crate::{
    features::FeatureReader, field::Field, magic::state::MagicField, spatial::SpatialKernel,
};
// hpc-exempt: memoized named queries, not cell storage or owner state.
use std::{any::Any, cell::RefCell, collections::BTreeMap, io, rc::Rc};

#[derive(Default)]
pub struct Held {
    // hpc-exempt: values keyed by query identity for one evaluation interval.
    values: RefCell<BTreeMap<String, Rc<dyn Any>>>,
}
impl Held {
    pub fn get<T: Any>(
        &self,
        key: &str,
        compute: impl FnOnce() -> io::Result<T>,
    ) -> io::Result<Rc<T>> {
        if let Some(value) = self.values.borrow().get(key) {
            return value
                .clone()
                .downcast::<T>()
                .map_err(|_| io::Error::other(format!("Inconsistent POI query type: {key}")));
        }
        let value = Rc::new(compute()?);
        self.values.borrow_mut().insert(key.into(), value.clone());
        Ok(value)
    }
    pub fn forget(&self, key: &str) {
        self.values.borrow_mut().remove(key);
    }
    pub fn release(&self) {
        self.values.borrow_mut().clear();
    }
}
/// Read capabilities of the existing generation state, shared by catalogue strategies.
pub trait State {
    fn physical(&self) -> Option<&Field>;
    fn features(&self) -> &dyn FeatureReader;
    fn spatial(&self) -> &dyn SpatialKernel;
    fn magic(&self) -> Option<std::cell::Ref<'_, [MagicField]>>;
    fn held(&self) -> &Held;
    fn varieties(&self) -> &super::variety::Varieties;
    fn regional(&self) -> bool;
    fn places_recorded(&self) -> bool;
    fn field(&self) -> io::Result<&Field> {
        self.physical()
            .ok_or_else(|| io::Error::other("This place requires generated land"))
    }
}
