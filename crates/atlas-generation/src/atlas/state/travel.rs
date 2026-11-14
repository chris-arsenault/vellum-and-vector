use super::State;
use crate::{
    field::{people::crafts, Field},
    links::Offers,
};
use std::rc::Rc;

impl State {
    pub fn travel_links(&self) -> Rc<Offers<Field>> {
        let mut offers = Offers::default();
        if let Some(magic) = &self.physical.magic {
            let doors = magic
                .borrow()
                .fields
                .iter()
                .flat_map(|system| system.doors().iter().copied())
                .collect();
            crafts::offer_doors(&mut offers, doors);
        }
        Rc::new(offers)
    }
}
