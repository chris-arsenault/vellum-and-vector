//! Maintained place totals replace their own previous contribution to a magic channel or stock.
use super::{channels::Channel, state::MagicField};
use crate::rock::ground::Ground;
use std::io;

pub enum Target<'a> {
    Channel(Channel),
    Stock(&'a str),
}
impl MagicField {
    pub fn replace_place_contribution(
        &mut self,
        ground: &mut Ground,
        target: Target<'_>,
        cell: usize,
        previous: f64,
        next: impl FnOnce(f64) -> f64,
    ) -> io::Result<Option<f64>> {
        match target {
            Target::Channel(channel) => {
                let band = self.channels.band_mut(channel);
                let base = band.get(cell)? - previous;
                let value = next(base);
                band.set(cell, value)?;
                Ok(Some(value - base))
            }
            Target::Stock(key) => {
                for (origin, state) in self.definition.origins.iter().zip(&mut self.origins) {
                    for (stock, values) in origin.stocks.iter().zip(&mut state.stocks) {
                        if key != format!("{}/{}", origin.id, stock.id) {
                            continue;
                        }
                        let base = values.get(ground, cell)? - previous;
                        let value = next(base);
                        values.set(ground, cell, value)?;
                        return Ok(Some(value - base));
                    }
                }
                Ok(None)
            }
        }
    }
}
