//! Accessible clearance effort removes accumulated waste through its numerical owner.
use super::Exposure;
use crate::town::fabric::Town;
use std::io;
pub fn advance(town: &Town, context: &Exposure<'_>) -> io::Result<super::Removals> {
    let mut removals = Vec::new();
    for (i, holding) in town.holdings().iter().enumerate() {
        let condition = context.conditions.get(i).copied().unwrap_or_default();
        let removed = condition.waste * (1. - (-condition.clearance * context.exposure).exp());
        if removed > 0. {
            removals.push((holding.slot.front, removed));
        }
    }
    Ok(removals)
}
