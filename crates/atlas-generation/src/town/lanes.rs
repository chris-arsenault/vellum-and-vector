//! Streets in a junction edit, indexed in the order they were installed.
use super::{
    ground::{Ground, FIRST_STREET},
    network::Street,
};
/// The streets laid so far; street `i` owns ground `FIRST_STREET + i`.
#[derive(Default)]
pub struct Network {
    pub streets: Vec<Street>,
}
impl Network {
    pub fn add(&mut self, street: Street, ground: &mut Ground) -> u32 {
        let owner = FIRST_STREET + self.streets.len() as u32;
        // Half a cell wider each side than the street, so a plot whose cells look free never
        // reaches over the street's edge between the grid's samples.
        ground.take_street(&street, owner);
        self.streets.push(street);
        owner
    }
}
