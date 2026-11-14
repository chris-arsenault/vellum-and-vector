//! Capacity follows the material currently exposed by the ground owner.
use crate::{
    rock::ground::{
        query::{average, ground_fact, Fact, GroundQuery},
        Ground,
    },
    settlement::removal::Facet,
};
use std::io;

pub fn permeability(ground: &Ground, cell: usize, facet: Option<Facet>) -> io::Result<f64> {
    let mut query = GroundQuery::new(0.0);
    query.rock = Some(Box::new(|_, layer, _| {
        ground_fact(layer, Fact::Porosity).max(ground_fact(layer, Fact::Solubility))
    }));
    Ok(ground.fold(cell, &average(query), facet)?.clamp(0.0, 1.0))
}
