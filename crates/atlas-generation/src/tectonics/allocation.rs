//! Area-based continental accretion and exclusively oceanic plate allocation.
use super::territories::Territories;
use crate::chance::{best, cheapest, Chance};

#[derive(Clone, Debug)]
pub struct Candidate {
    pub position: [f64; 2],
    pub priority: f64,
}
#[derive(Clone, Copy)]
pub struct Layout {
    pub assemblies: usize,
    pub continental_fraction: f64,
    pub clustering: f64,
    pub growth_variation: f64,
    pub major_assemblies: usize,
    pub major_growth: f64,
    pub ocean_plates: usize,
    pub ocean_water_share: f64,
}
pub struct Allocation {
    pub continents: Vec<usize>,
    pub oceans: Vec<usize>,
}
pub struct Growth<'a> {
    pub seed: i32,
    pub cohesion: f64,
    pub adjacent: &'a [u8],
    pub width: f64,
}
pub fn distance2(a: &Candidate, b: &Candidate, width: f64) -> f64 {
    let dx = a.position[0] - b.position[0];
    let dx = if width == 0.0 {
        dx
    } else {
        dx - (dx / width + 0.5).floor() * width
    };
    dx * dx + (a.position[1] - b.position[1]).powi(2)
}
fn minimum_distance(sites: &[Candidate], candidate: usize, selected: &[usize], width: f64) -> f64 {
    selected
        .iter()
        .map(|&i| distance2(&sites[candidate], &sites[i], width))
        .fold(f64::INFINITY, f64::min)
}
fn anchors(
    sites: &[Candidate],
    count: usize,
    territory: &Territories,
    target: f64,
    seed: i32,
    width: f64,
) -> Vec<usize> {
    let open: Vec<_> = (0..sites.len())
        .filter(|&i| territory.areas[i] > 0.0)
        .collect();
    let smaller: Vec<_> = open
        .iter()
        .copied()
        .filter(|&i| territory.areas[i] <= target / count as f64)
        .collect();
    let candidates = if smaller.len() >= count {
        &smaller
    } else {
        &open
    };
    let mut chosen = Vec::new();
    let mut occupied = 0.0;
    while chosen.len() < count.min(candidates.len()) {
        let options = candidates.iter().copied().filter(|i| {
            !chosen.contains(i)
                && (occupied + territory.areas[*i] - target).abs() < (occupied - target).abs()
        });
        // The first anchor falls where chance favours; each later one keeps far from
        // those chosen, with chance counting for up to half that distance.
        let turn = chosen.len() as f64;
        let chance = Chance::of(seed, 0x41da3);
        let Some(next) = best(options, |&i| {
            let key = [i as f64, turn];
            if chosen.is_empty() {
                chance.unit(key)
            } else {
                minimum_distance(sites, i, &chosen, width).sqrt() * chance.spread(key, 0.5, 0.5)
            }
        }) else {
            break;
        };
        chosen.push(next);
        occupied += territory.areas[next];
    }
    chosen
}
pub fn next_continental_province(
    sites: &[Candidate],
    selected: &[usize],
    assembly: usize,
    anchor: usize,
    growth: &Growth<'_>,
    eligible: impl Fn(usize) -> bool,
) -> Option<usize> {
    // An assembly that holds together takes only provinces beside those it holds.
    let beside = |i: usize| {
        growth.cohesion <= 0.0
            || selected
                .iter()
                .enumerate()
                .any(|(j, &id)| id == assembly && growth.adjacent[i * sites.len() + j] == 1)
    };
    let front = (0..sites.len()).filter(|&i| selected[i] == 0 && eligible(i) && beside(i));
    let chance = Chance::of(growth.seed, 0x6173);
    // The cheapest province on the front joins: the nearer its anchor the cheaper, with
    // chance stretching that distance; an assembly that does not hold together takes
    // whichever chance favours.
    cheapest(front, |&i| {
        let site = &sites[i];
        let distance = distance2(site, &sites[anchor], growth.width).sqrt();
        let chance = chance.unit([i as f64, assembly as f64]);
        if growth.cohesion > 0.0 {
            distance * (1.0 + growth.cohesion * chance * 0.7) - site.priority * distance * 0.1
        } else {
            -chance
        }
    })
}
fn growth_weights(count: usize, profile: Layout, seed: i32) -> Vec<f64> {
    let chance = Chance::of(seed, 0x4b19);
    let mut weights: Vec<_> = (0..count)
        .map(|i| 1.0 + chance.signed([i as f64, 0.0]) * profile.growth_variation)
        .collect();
    let mut order: Vec<_> = (0..count).collect();
    // hpc-exempt: initial assembly weights sorted once, preserving tied major selection.
    order.sort_by(|&a, &b| weights[b].total_cmp(&weights[a]));
    for i in order.into_iter().take(profile.major_assemblies) {
        weights[i] *= profile.major_growth;
    }
    weights
}
fn assemblies(
    sites: &[Candidate],
    territory: &Territories,
    profile: Layout,
    seed: i32,
    width: f64,
) -> Vec<usize> {
    let target = territory.areas.iter().sum::<f64>() * profile.continental_fraction;
    let chosen = anchors(sites, profile.assemblies, territory, target, seed, width);
    let mut result = vec![0; sites.len()];
    for (n, &i) in chosen.iter().enumerate() {
        result[i] = n + 1;
    }
    let growth = Growth {
        seed,
        cohesion: profile.clustering,
        adjacent: &territory.adjacent,
        width,
    };
    let weights = growth_weights(chosen.len(), profile, seed);
    let weight: f64 = weights.iter().sum();
    let mut occupied: Vec<_> = chosen.iter().map(|&i| territory.areas[i]).collect();
    let mut total: f64 = occupied.iter().sum();
    let mut selected = chosen.len();
    while selected < sites.len() {
        let options: Vec<_> = chosen
            .iter()
            .enumerate()
            .filter_map(|(n, &anchor)| {
                next_continental_province(sites, &result, n + 1, anchor, &growth, |i| {
                    (total + territory.areas[i] - target).abs() < (total - target).abs()
                })
                .map(|next| (n, next))
            })
            .collect();
        let Some(pick) = best(0..options.len(), |&i| {
            let (n, next) = options[i];
            (target * weights[n] / weight - occupied[n] - territory.areas[next] / 2.0) / weights[n]
        }) else {
            break;
        };
        let (n, next) = options[pick];
        result[next] = n + 1;
        occupied[n] += territory.areas[next];
        total += territory.areas[next];
        selected += 1;
    }
    result
}
fn ocean_plates(
    sites: &[Candidate],
    territory: &Territories,
    profile: Layout,
    seed: i32,
    width: f64,
    continents: &[usize],
) -> Vec<usize> {
    let mut result = vec![0; sites.len()];
    let ocean: f64 = territory
        .areas
        .iter()
        .enumerate()
        .filter(|(i, _)| continents[*i] == 0)
        .map(|(_, &area)| area)
        .sum();
    let target = ocean * profile.ocean_water_share;
    if target <= 0.0 {
        return result;
    }
    for plate in 1..=profile.ocean_plates {
        let held: Vec<_> = (0..sites.len()).filter(|&i| result[i] > 0).collect();
        let starts = (0..sites.len()).filter(|&i| continents[i] == 0 && result[i] == 0);
        let chance = Chance::of(seed, 0x37b1);
        let Some(start) = best(starts, |&i| {
            let place = if held.is_empty() {
                1.0
            } else {
                minimum_distance(sites, i, &held, width).sqrt()
            };
            place * chance.unit([i as f64, plate as f64])
        }) else {
            break;
        };
        result[start] = plate;
        let mut area = territory.areas[start];
        while area < target / profile.ocean_plates as f64 {
            let edge = (0..sites.len()).filter(|&i| {
                continents[i] == 0
                    && result[i] == 0
                    && result
                        .iter()
                        .enumerate()
                        .any(|(j, &id)| id == plate && territory.adjacent[i * sites.len() + j] != 0)
            });
            let Some(next) = best(edge, |&i| -distance2(&sites[i], &sites[start], width)) else {
                break;
            };
            result[next] = plate;
            area += territory.areas[next];
        }
    }
    result
}
pub fn allocate(
    sites: &[Candidate],
    territory: &Territories,
    profile: Layout,
    seed: i32,
    width: f64,
) -> Allocation {
    let continents = assemblies(sites, territory, profile, seed, width);
    let oceans = ocean_plates(sites, territory, profile, seed, width, &continents);
    Allocation { continents, oceans }
}
