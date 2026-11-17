use super::{
    country::{self, Step, Way},
    places::Places,
    reach::passed_on,
    work::working,
};
use crate::{
    field::Field,
    hpc::{Direction, KeyedHeap},
    links::Offers,
    storage::Band,
};
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
/// Travellers on each way. Every pair of places exchanges travellers in proportion to
/// the smaller town and the falloff of their cheapest route through the way network,
/// and those travellers pass over every leg of that route. A direct way that no
/// cheapest route uses carries no one; legs through small places carry the journeys
/// between the larger places beyond them.
fn journeys(ways: &[Way], towns: &[f64], range: f64) -> Vec<f64> {
    // hpc-exempt: adjacency of named places, one entry per connecting way end.
    let mut legs = vec![Vec::new(); towns.len()];
    for (at, way) in ways.iter().enumerate() {
        legs[way.from].push((at, way.to));
        legs[way.to].push((at, way.from));
    }
    let mut traffic = vec![0.0; ways.len()];
    let mut cost = vec![f64::INFINITY; towns.len()];
    let mut came = vec![usize::MAX; towns.len()];
    let mut carried = vec![0.0; towns.len()];
    for start in 0..towns.len() {
        if towns[start] <= 0.0 {
            continue;
        }
        let settled = cheapest(ways, &legs, start, 4.0 * range, &mut cost, &mut came);
        // Sum each route's travellers back up the cheapest-route tree, farthest first,
        // so every leg is credited once per start.
        for &end in settled.iter().rev() {
            if end > start && towns[end] > 0.0 {
                carried[end] += 0.5 * towns[start].min(towns[end]) * passed_on(cost[end], range);
            }
            if end != start {
                let way = &ways[came[end]];
                traffic[came[end]] += carried[end];
                carried[if way.from == end { way.to } else { way.from }] += carried[end];
            }
        }
        for end in settled {
            cost[end] = f64::INFINITY;
            came[end] = usize::MAX;
            carried[end] = 0.0;
        }
    }
    traffic
}
/// Cheapest routes from `start` over the way network up to `limit`; returns the places
/// in the order their routes settled, leaving their costs and arriving ways in `cost`
/// and `came`.
fn cheapest(
    ways: &[Way],
    legs: &[Vec<(usize, usize)>],
    start: usize,
    limit: f64,
    cost: &mut [f64],
    came: &mut [usize],
) -> Vec<usize> {
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    let mut settled = Vec::new();
    cost[start] = 0.0;
    queue.push(start as u32, [0.0]);
    while let Some((place, [so_far])) = queue.pop() {
        let place = place as usize;
        if so_far > cost[place] {
            continue;
        }
        settled.push(place);
        for &(way, other) in &legs[place] {
            let next = so_far + ways[way].cost;
            if next > limit || next >= cost[other] {
                continue;
            }
            cost[other] = next;
            came[other] = way;
            queue.push(other as u32, [next]);
        }
    }
    settled
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
    let towns: Vec<_> = living
        .iter()
        .map(|&at| places.known[at].town_people)
        .collect();
    let traffic = journeys(&country.ways, &towns, setting.range);
    // Every place keeps its cheapest way, so `reachable` can show it even when no
    // journey within reach uses it.
    let mut own = vec![usize::MAX; towns.len()];
    for (at, way) in country.ways.iter().enumerate() {
        for end in [way.from, way.to] {
            if own[end] == usize::MAX || way.cost < country.ways[own[end]].cost {
                own[end] = at;
            }
        }
    }
    let mut found = Vec::new();
    for (at, (way, travellers)) in country.ways.into_iter().zip(traffic).enumerate() {
        if travellers <= 0.0 && own[way.from] != at && own[way.to] != at {
            continue;
        }
        let a = &places.known[living[way.from]];
        let b = &places.known[living[way.to]];
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
#[cfg(test)]
mod tests {
    use super::*;

    fn way(from: usize, to: usize, cost: f64) -> Way {
        Way {
            from,
            to,
            cells: Vec::new(),
            cost,
            afloat: 0.0,
        }
    }

    #[test]
    fn journeys_between_large_places_ride_the_legs_through_a_small_one() {
        // Two towns with a hamlet between them; the direct way is dearer than the legs.
        let ways = [way(0, 1, 1.0), way(1, 2, 1.0), way(0, 2, 3.0)];
        let traffic = journeys(&ways, &[1000.0, 10.0, 1000.0], 10.0);
        let through = 0.5 * 1000.0 * passed_on(2.0, 10.0);
        assert_eq!(traffic[2], 0.0);
        assert!(traffic[0] > through && traffic[1] > through);
    }

    #[test]
    fn traffic_sums_every_journey_over_a_shared_leg() {
        // A chain 0-1-2-3: the middle leg carries 0-2, 0-3, 1-2 and 1-3.
        let ways = [way(0, 1, 1.0), way(1, 2, 1.0), way(2, 3, 1.0)];
        let towns = [100.0, 100.0, 100.0, 100.0];
        let traffic = journeys(&ways, &towns, 10.0);
        let pair = |cost: f64| 0.5 * 100.0 * passed_on(cost, 10.0);
        let middle = pair(2.0) + pair(3.0) + pair(1.0) + pair(2.0);
        assert!((traffic[1] - middle).abs() < 1e-9);
        assert!((traffic[0] - (pair(1.0) + pair(2.0) + pair(3.0))).abs() < 1e-9);
    }

    #[test]
    fn a_cheaper_direct_way_carries_its_own_journey() {
        let ways = [way(0, 1, 2.0), way(1, 2, 2.0), way(0, 2, 3.0)];
        let traffic = journeys(&ways, &[1000.0, 10.0, 1000.0], 10.0);
        assert!(traffic[2] > 0.0);
    }
}
