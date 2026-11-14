use super::{
    place_country::KnownWay,
    places::{Place, Places},
};
use crate::{
    field::Field,
    human::identity::{leading, Tradition},
};
use std::io;

pub struct Frontier<'a> {
    pub way: &'a KnownWay,
    pub ends: [&'a Place; 2],
    pub held: [i32; 2],
}
pub fn ways<'a>(
    field: &Field,
    places: &'a Places,
    ways: &'a [KnownWay],
) -> io::Result<Vec<Frontier<'a>>> {
    let mut frontiers = Vec::new();
    for way in ways {
        let Some(a) = places.known.iter().find(|p| p.id == way.from) else {
            continue;
        };
        let Some(b) = places.known.iter().find(|p| p.id == way.to) else {
            continue;
        };
        let held = [
            leading(&field.people.column(a.anchor)?, Tradition::Allegiance).0,
            leading(&field.people.column(b.anchor)?, Tradition::Allegiance).0,
        ];
        if held[0] != 0 && held[1] != 0 && held[0] != held[1] {
            frontiers.push(Frontier {
                way,
                ends: [a, b],
                held,
            });
        }
    }
    Ok(frontiers)
}
