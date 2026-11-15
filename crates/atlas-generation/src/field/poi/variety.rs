use super::{contract::Variety, values::Place};
// hpc-exempt: one chosen variety per named place identity, retained across query refreshes.
use std::{cell::RefCell, collections::BTreeMap, io};
#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct Varieties {
    // hpc-exempt: immutable choice for each place, never numerical terrain state.
    chosen: RefCell<BTreeMap<String, String>>,
}
impl Varieties {
    pub fn get<S>(&self, state: &S, variety: &Variety<S>, place: &Place) -> io::Result<String> {
        self.get_or_choose(&place.id, || (variety.of)(state, place))
    }
    pub fn get_or_choose(
        &self,
        id: &str,
        choose: impl FnOnce() -> io::Result<String>,
    ) -> io::Result<String> {
        if let Some(value) = self.chosen.borrow().get(id) {
            return Ok(value.clone());
        }
        let value = choose()?;
        self.chosen.borrow_mut().insert(id.into(), value.clone());
        Ok(value)
    }
}
