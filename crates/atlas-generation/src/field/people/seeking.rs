//! People seek country their crafts suit. The old society cycle weighed a destination by how
//! far the movers' practices found their medium there: between half and one and a half, one
//! for a people with no practice. Here the movers are a cell's people, each craft weighs by
//! the share who keep it, and those who keep none are indifferent.
use super::crafts::{self, Craft};
use crate::{
    field::Field,
    human::identity::{held, Tradition},
};
use std::io;

/// How much draw a craft's whole people add or take where its medium is full or absent.
const SEEKING: f64 = 0.5;

/// The draw factor for a people keeping each craft by its share of them, where each craft
/// finds the given offer of its medium (0 to 1): one for a people with no craft, down to one
/// half where all of them keep a craft whose medium is absent, up to one and a half where it
/// is full.
pub fn factor(keeping: &[(f64, f64)]) -> f64 {
    let mut leaning = 0.0;
    for &(share, offer) in keeping {
        leaning += share.clamp(0.0, 1.0) * (2.0 * offer.clamp(0.0, 1.0) - 1.0);
    }
    1.0 + SEEKING * leaning.clamp(-1.0, 1.0)
}
/// The crafts a cell's people keep, each with the share of them who keep it.
pub fn keepers(field: &Field, cell: usize) -> io::Result<Vec<(Craft, f64)>> {
    let column = field.people.column(cell)?;
    let everyone: f64 = column.iter().map(|layer| layer.people).sum();
    if everyone <= 0.0 {
        return Ok(Vec::new());
    }
    Ok(held(&column, Tradition::Craft)
        .into_iter()
        .filter_map(|(code, people)| crafts::by_code(code).map(|craft| (craft, people / everyone)))
        .collect())
}
/// How strongly movers keeping `keepers` lean toward `to`, by its crafts' media there.
pub fn toward(field: &Field, keepers: &[(Craft, f64)], to: usize) -> io::Result<f64> {
    if keepers.is_empty() {
        return Ok(1.0);
    }
    let mut keeping = Vec::with_capacity(keepers.len());
    for &(craft, share) in keepers {
        keeping.push((share, crafts::medium_at(field, craft, to)?));
    }
    Ok(factor(&keeping))
}
#[cfg(test)]
mod tests {
    use super::{factor, keepers, toward};
    use crate::field::{
        people::{crafts::CRAFTS, fixture::*},
        shared::Scalar,
    };

    #[test]
    fn hearth_keepers_lean_toward_quickened_ground_and_their_neighbours_do_not() {
        let fire = CRAFTS[0];
        assert_eq!(fire.medium, Scalar::Quickening);
        let (mut home, mut hot, mut cold, mut plain) = (0, 0, 0, 0);
        let field = land(|seed, mesh| {
            home = point(mesh, 500.0, 500.0);
            hot = point(mesh, 600.0, 500.0);
            cold = point(mesh, 400.0, 500.0);
            plain = point(mesh, 500.0, 300.0);
            // Half of home keeps the Fire craft; the plain cell keeps none.
            people(
                seed,
                home,
                &[layer(50.0, 1, 0, 0, fire.code), layer(50.0, 1, 0, 0, 0)],
            );
            people(seed, plain, &[layer(100.0, 1, 0, 0, 0)]);
            seed.shared
                .scalar_mut(Scalar::Quickening)
                .set(hot, 1.0)
                .unwrap();
        });
        let movers = keepers(&field, home).unwrap();
        assert_eq!(movers.len(), 1);
        assert!((movers[0].1 - 0.5).abs() < 1e-12);
        let warm = toward(&field, &movers, hot).unwrap();
        let chill = toward(&field, &movers, cold).unwrap();
        // Half keep the craft: they lean half as far as a whole people of keepers would.
        assert!((warm - 1.25).abs() < 1e-12, "{warm}");
        assert!((chill - 0.75).abs() < 1e-12, "{chill}");
        // People who keep no craft weigh every destination alike.
        let indifferent = keepers(&field, plain).unwrap();
        assert_eq!(toward(&field, &indifferent, hot).unwrap(), 1.0);
        assert_eq!(toward(&field, &indifferent, cold).unwrap(), 1.0);
    }

    #[test]
    fn crafts_lean_their_people_toward_their_medium_and_others_are_indifferent() {
        assert_eq!(factor(&[]), 1.0);
        assert_eq!(factor(&[(1.0, 1.0)]), 1.5);
        assert_eq!(factor(&[(1.0, 0.0)]), 0.5);
        // A fifth keeping a craft off its medium leans the cell a little away.
        assert!((factor(&[(0.2, 0.0)]) - 0.9).abs() < 1e-12);
        // Half on their medium and half off it balance.
        assert_eq!(factor(&[(0.5, 1.0), (0.5, 0.0)]), 1.0);
    }
}
