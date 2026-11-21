//! Who speaks and who understands a tongue around a cell. Use is judged over the cell and its
//! neighbours, the people within a day's contact: a frontier people keep the tongue of the
//! country beside them while that country still speaks it.
use crate::{
    field::Field,
    human::identity::{IdentityColumn, Tradition},
};
use std::io;

/// The columns of a cell and its neighbours.
pub fn around(field: &Field, cell: usize) -> io::Result<Vec<IdentityColumn>> {
    let mut columns = vec![field.people.column(cell)?];
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            columns.push(field.people.column(next)?);
        }
    }
    Ok(columns)
}
fn everyone(columns: &[IdentityColumn]) -> f64 {
    columns.iter().flatten().map(|layer| layer.people).sum()
}
/// The share of the people in `columns` who speak `tongue` as their own.
pub fn spoken(tongue: i32, columns: &[IdentityColumn]) -> f64 {
    let all = everyone(columns);
    if all <= 0.0 || tongue == 0 {
        return 0.0;
    }
    columns
        .iter()
        .flatten()
        .filter(|layer| layer.traditions[Tradition::Tongue as usize] == tongue)
        .map(|layer| layer.people)
        .sum::<f64>()
        / all
}
/// The tongue most of the people in `columns` speak, if any.
pub fn most_spoken(columns: &[IdentityColumn]) -> Option<i32> {
    let mut spoken: Vec<(i32, f64)> = Vec::new();
    for layer in columns.iter().flatten() {
        let code = layer.traditions[Tradition::Tongue as usize];
        if code == 0 {
            continue;
        }
        match spoken.iter_mut().find(|(c, _)| *c == code) {
            Some(entry) => entry.1 += layer.people,
            None => spoken.push((code, layer.people)),
        }
    }
    spoken
        .into_iter()
        .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)))
        .map(|(code, _)| code)
}
/// The share of the first column's people who speak or know the tongue most spoken across all
/// of `columns` (the cell and its neighbours). Empty ground understands nothing.
pub fn understood(columns: &[IdentityColumn]) -> f64 {
    let Some(own) = columns.first() else {
        return 0.0;
    };
    let here: f64 = own.iter().map(|layer| layer.people).sum();
    let Some(tongue) = most_spoken(columns).filter(|_| here > 0.0) else {
        return 0.0;
    };
    let knowing: f64 = own
        .iter()
        .filter(|layer| {
            layer.traditions[Tradition::Tongue as usize] == tongue
                || layer.traditions[Tradition::Known as usize] == tongue
        })
        .map(|layer| layer.people)
        .sum();
    (knowing / here).min(1.0)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::human::identity::IdentityLayer;

    fn people(count: f64, tongue: i32, known: i32) -> IdentityColumn {
        let mut traditions = [0; crate::human::identity::TRADITIONS];
        traditions[Tradition::Tongue as usize] = tongue;
        traditions[Tradition::Known as usize] = known;
        vec![IdentityLayer {
            people: count,
            traditions,
            ..Default::default()
        }]
    }
    #[test]
    fn a_frontier_tongue_is_in_use_when_the_country_beside_speaks_it() {
        // Speakers of 1 who learned 2, beside a country speaking 2.
        let here = people(100.0, 1, 2);
        let beside = people(300.0, 2, 0);
        assert_eq!(spoken(2, std::slice::from_ref(&here)), 0.0);
        assert_eq!(spoken(2, &[here, beside]), 0.75);
    }
    #[test]
    fn a_cell_is_understood_by_those_who_speak_or_know_the_tongue_around_it() {
        let deep = [people(100.0, 1, 0), people(100.0, 1, 0)];
        assert_eq!(understood(&deep), 1.0);
        let frontier = [people(100.0, 1, 0), people(300.0, 2, 0)];
        assert_eq!(understood(&frontier), 0.0);
        let learned = [people(100.0, 1, 2), people(300.0, 2, 0)];
        assert_eq!(understood(&learned), 1.0);
        let empty = [Vec::new(), people(300.0, 2, 0)];
        assert_eq!(understood(&empty), 0.0);
    }
}
