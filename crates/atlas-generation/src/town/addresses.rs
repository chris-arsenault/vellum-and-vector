//! House numbers along a street: odd on the left, even on the right, counted from the end
//! nearest the settlement's centre, where every street begins. The rule is shared with the
//! town tools, which renumber the streets a creator's edit touches (`atlas_map::town`).
use super::{edits::line, fabric::Town};
use crate::spatial::SpatialKernel;
pub use atlas_map::town::{address, numbers};
use atlas_map::Position;
use std::io;
/// Premises retain the street they front; a rear holding retains its shared approach.
pub fn assign(town: &Town, spatial: &dyn SpatialKernel) -> io::Result<Vec<Option<u32>>> {
    let mut assigned = vec![None; town.holdings().len()];
    for (i, street) in town.streets().iter().enumerate() {
        let members: Vec<_> = town
            .holdings()
            .iter()
            .filter(|h| h.slot.street == Some(i))
            .collect();
        let road = line(&street.points);
        let positions = members
            .iter()
            .map(|h| Position::xy(h.slot.front[0], h.slot.front[1]))
            .collect::<Vec<_>>();
        let fractions = spatial
            .line_fractions(&road, &positions)
            .map_err(io::Error::other)?;
        let plots: Vec<_> = fractions
            .into_iter()
            .zip(&members)
            .map(|(along, h)| (along, h.slot.side))
            .collect();
        for (holding, number) in members.into_iter().zip(numbers(&plots)) {
            assigned[holding.id.0 as usize] = Some(number);
        }
    }
    Ok(assigned)
}
