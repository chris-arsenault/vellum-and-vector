use super::{
    places::Place,
    traditions::{Kind, Traditions},
    work::km2,
};
use crate::{field::Field, human::identity};
// hpc-exempt: named tradition shares for settlement metadata.
use std::{collections::BTreeMap, io};

// hpc-exempt: publication metadata keyed by tradition kind and world entity id.
pub type Peoples = BTreeMap<String, BTreeMap<atlas_map::Id, f64>>;
pub fn peoples(field: &Field, traditions: &Traditions, place: &Place) -> io::Result<Peoples> {
    // hpc-exempt: sparse tradition identities aggregated over one named settlement.
    let mut counted: [BTreeMap<i32, f64>; 4] = std::array::from_fn(|_| BTreeMap::new());
    let anchor = [place.anchor];
    let cells = if place.cells.is_empty() {
        &anchor[..]
    } else {
        &place.cells
    };
    let mut everyone = 0.0;
    for &cell in cells {
        let area = km2(field, cell);
        let column = field.people.column(cell)?;
        everyone += field.people.people(cell)? * area;
        for (tally, kind) in counted.iter_mut().zip(Kind::ALL) {
            for (code, people) in identity::held(&column, kind.field()) {
                *tally.entry(code).or_default() += people * area;
            }
        }
    }
    Ok(Kind::ALL
        .into_iter()
        .zip(counted)
        .map(|(kind, tally)| {
            let shares = tally
                .into_iter()
                .filter_map(|(code, people)| {
                    let share = people / everyone;
                    let tradition = traditions.get(code)?;
                    (everyone > 0.0 && share >= 0.01 && tradition.entity != atlas_map::Id::NIL)
                        .then(|| (tradition.entity, (share * 1000.0 + 0.5).floor() / 1000.0))
                })
                .collect();
            (kind.as_str().into(), shares)
        })
        .collect())
}
