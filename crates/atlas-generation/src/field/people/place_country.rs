use super::{
    country::{self, Step, Way},
    places::Places,
    reach::passed_on,
    work::working,
};
use crate::{field::Field, links::Offers, storage::Band};
use serde::{Deserialize, Serialize};
use std::{
    // hpc-exempt: named settlement adjacency and visible endpoint metadata.
    collections::{BTreeMap, BTreeSet},
    io,
};

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WayKind {
    Lane,
    Road,
    Track,
    Path,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct KnownWay {
    pub from: String,
    pub to: String,
    pub cells: Vec<usize>,
    pub cost: f64,
    pub travellers: f64,
    pub kind: WayKind,
}
fn kind(afloat: f64, travellers: f64, road: f64) -> WayKind {
    if afloat > 0.2 {
        WayKind::Lane
    } else if travellers >= road {
        WayKind::Road
    } else if travellers >= road * 0.25 {
        WayKind::Track
    } else {
        WayKind::Path
    }
}
fn reachable(all: &mut [KnownWay]) {
    // hpc-exempt: named place endpoints, not numerical cell storage.
    let mut cheapest = BTreeMap::<String, usize>::new();
    // hpc-exempt: ids of named places already served by a visible way.
    let mut shown = BTreeSet::new();
    for (at, way) in all.iter().enumerate() {
        for end in [&way.from, &way.to] {
            if way.kind != WayKind::Path {
                shown.insert(end.clone());
            }
            if cheapest
                .get(end)
                .is_none_or(|&before| way.cost < all[before].cost)
            {
                cheapest.insert(end.clone(), at);
            }
        }
    }
    for (end, at) in cheapest {
        if !shown.contains(&end) {
            all[at].kind = WayKind::Track;
        }
    }
}
fn kept(all: Vec<Way>) -> Vec<Way> {
    // hpc-exempt: adjacency of named places, at most one entry per connecting way.
    let mut legs = BTreeMap::<usize, BTreeMap<usize, f64>>::new();
    for way in &all {
        legs.entry(way.from).or_default().insert(way.to, way.cost);
        legs.entry(way.to).or_default().insert(way.from, way.cost);
    }
    all.into_iter()
        .filter(|way| {
            !legs.get(&way.from).is_some_and(|near| {
                near.iter().any(|(third, &first)| {
                    first < way.cost
                        && legs
                            .get(&way.to)
                            .and_then(|other| other.get(third))
                            .is_some_and(|&second| second < way.cost)
                })
            })
        })
        .collect()
}
pub struct Setting {
    pub range: f64,
    pub road_travellers: f64,
    pub years: f64,
}
pub fn record(
    field: &Field,
    places: &mut Places,
    setting: &Setting,
    step: &Step<'_>,
    links: &Offers<Field>,
) -> io::Result<(Vec<KnownWay>, Band<f64>)> {
    let living: Vec<_> = places
        .known
        .iter()
        .enumerate()
        .filter_map(|(at, p)| (p.abandoned.is_none() && p.absorbed_by.is_none()).then_some(at))
        .collect();
    let centres: Vec<_> = living.iter().map(|&at| places.known[at].anchor).collect();
    let country = country::country_of(field, &centres, step, 4.0 * setting.range, links)?;
    let mut worn = working(field);
    for (&at, land) in living.iter().zip(country.hinterlands) {
        places.known[at].hinterland = Some(land);
    }
    let mut found = Vec::new();
    for way in kept(country.ways) {
        let a = &places.known[living[way.from]];
        let b = &places.known[living[way.to]];
        let travellers =
            0.5 * a.town_people.min(b.town_people) * passed_on(way.cost, setting.range);
        for &cell in &way.cells {
            worn.set(cell, worn.get(cell)? + travellers * setting.years)?;
        }
        found.push(KnownWay {
            from: a.id.clone(),
            to: b.id.clone(),
            cells: way.cells,
            cost: way.cost,
            travellers,
            kind: kind(way.afloat, travellers, setting.road_travellers),
        });
    }
    reachable(&mut found);
    Ok((found, worn))
}
