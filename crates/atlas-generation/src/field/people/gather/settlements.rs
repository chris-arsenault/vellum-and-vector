//! Locate the townspeople counted by a coarse survey on the region's developed ground.
use crate::{
    field::{
        people::work::{habitable, km2, Work},
        refinement::people::SettlementCensus,
        shared::Scalar,
        Field,
    },
    hpc::{Direction, KeyedHeap},
    human::{catalogue::LayerId, operations::HouseholdTransfers, HumanField},
    town::city::outline::{settlement_threshold, Ground},
};
use smallvec::SmallVec;
use std::io;

struct Parcel {
    heads: f64,
    area_km2: f64,
    support: f64,
    dry: bool,
    buildable: bool,
    edge: bool,
    adjacent: usize,
    ways: SmallVec<[(usize, f64); 4]>,
}

pub(super) fn households(field: &Field, work: &Work) -> io::Result<Vec<HouseholdTransfers>> {
    let parcels = parcels(field, work)?;
    Ok(placement(&parcels, &work.markets, work.city.is_some()))
}

fn parcels(field: &Field, work: &Work) -> io::Result<Vec<Parcel>> {
    let mesh = field.mesh();
    let built = field.people().view(HumanField::Layer(LayerId::BuiltUp));
    let slope = field.shared().scalar(Scalar::Slope);
    let mut parcels = Vec::with_capacity(mesh.len());
    for cell in 0..mesh.len() {
        let density = field.people().people(cell)?;
        let area = km2(field, cell);
        let dry = habitable(field, cell)?;
        let mut ways = SmallVec::new();
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(cell, edge) {
                let passed = super::step_passed(work, cell, edge)?;
                if passed > 0. {
                    ways.push((next, mesh.physical_distance(cell, next) / passed));
                }
            }
        }
        let ground = Ground {
            residents_per_km2: density,
            built_share: built.get(cell)?,
            slope: slope.get(cell)?,
            water: !dry,
        };
        parcels.push(Parcel {
            heads: density * area,
            area_km2: area,
            support: ground.settlement_support()
                * work.city.as_ref().map_or(1., |city| city.weight[cell]),
            dry,
            buildable: dry && work.city.as_ref().is_none_or(|city| city.weight[cell] > 0.),
            edge: mesh.boundary(cell),
            adjacent: ways.len(),
            ways,
        });
    }
    for link in &work.going.linked {
        if link.passed > 0. {
            let cost = mesh.physical_distance(link.a, link.b) / link.passed;
            parcels[link.a].ways.push((link.b, cost));
            parcels[link.b].ways.push((link.a, cost));
        }
    }
    Ok(parcels)
}

/// Adjacent settlements share a continuous urban area at the travel divide between
/// their anchors. Even towns on a clipped edge keep their homes from becoming donors.
fn neighbourhoods(parcels: &[Parcel], towns: &[SettlementCensus]) -> (Vec<Vec<usize>>, Vec<bool>) {
    let mut owner = vec![usize::MAX; parcels.len()];
    let mut distance = vec![f64::INFINITY; parcels.len()];
    let mut threshold = vec![0.; towns.len()];
    let mut front = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for (town, survey) in towns.iter().enumerate() {
        let seed = settlement_anchor(parcels, survey);
        if let Some(cell) = seed {
            if owner[cell] != usize::MAX && towns[owner[cell]].townspeople >= survey.townspeople {
                continue;
            }
            owner[cell] = town;
            threshold[town] = settlement_threshold(parcels[cell].support);
            distance[cell] = 0.;
            front.push(cell as u32, [0.]);
        }
    }
    while let Some((cell, [cost])) = front.pop() {
        let cell = cell as usize;
        if cost != distance[cell] {
            continue;
        }
        let town = owner[cell];
        for &(next, step) in &parcels[cell].ways {
            let offer = cost + step;
            if parcels[next].buildable
                && parcels[next].support > threshold[town]
                && offer < distance[next]
            {
                owner[next] = town;
                distance[next] = offer;
                front.push(next as u32, [offer]);
            }
        }
    }
    let mut groups = vec![Vec::new(); towns.len()];
    for (cell, &town) in owner.iter().enumerate() {
        if town != usize::MAX {
            groups[town].push(cell);
        }
    }
    (
        groups,
        owner.iter().map(|&town| town != usize::MAX).collect(),
    )
}

fn settlement_anchor(parcels: &[Parcel], survey: &SettlementCensus) -> Option<usize> {
    let anchor = &parcels[survey.cell];
    if anchor.buildable {
        Some(survey.cell)
    } else {
        anchor.ways[..anchor.adjacent]
            .iter()
            .map(|&(to, _)| to)
            .filter(|&to| parcels[to].buildable)
            .max_by(|&a, &b| parcels[a].support.total_cmp(&parcels[b].support))
    }
}

// owner-direction(2026-11-25): a full city's population must account for the named city's townspeople.
fn placement(
    parcels: &[Parcel],
    towns: &[SettlementCensus],
    principal_only: bool,
) -> Vec<HouseholdTransfers> {
    let (groups, occupied) = neighbourhoods(parcels, towns);
    let mut remaining: Vec<_> = parcels.iter().map(|p| p.heads).collect();
    let mut transfers = Vec::new();
    let mut order: Vec<_> = (0..towns.len()).collect();
    // hpc-exempt: order the named settlements' surveys, independent of the lattice cell order.
    order.sort_by(|&a, &b| {
        towns[a]
            .surveyed_km2
            .total_cmp(&towns[b].surveyed_km2)
            .then_with(|| towns[a].cell.cmp(&towns[b].cell))
    });
    for town in order {
        let survey = &towns[town];
        let homes = &groups[town];
        // A point or a cut through a settlement does not establish the whole city's extent.
        if (principal_only && !survey.principal)
            || survey.surveyed_km2 <= 0.
            || homes.len() < 2
            || homes.iter().any(|&i| parcels[i].edge)
        {
            continue;
        }
        let area: f64 = homes.iter().map(|&i| parcels[i].area_km2).sum();
        let current: f64 = homes.iter().map(|&i| parcels[i].heads).sum();
        let census = survey.townspeople;
        if current >= census {
            continue;
        }
        let offers = hinterland(
            parcels,
            homes,
            &occupied,
            &remaining,
            survey,
            survey.rural_people / survey.surveyed_km2,
        );
        let offered: f64 = offers.iter().map(|&(_, q)| q).sum();
        if std::env::var_os("ATLAS_TRACE_PEOPLE").is_some() {
            eprintln!(
                "{}",
                serde_json::json!({"event":"people.settlement-offers",
                "anchor":survey.cell,"census":survey.townspeople,"settledResidents":current,
                "settledKm2":area,"reachableHouseholds":offered,"placedResidents":current + (census-current).min(offered)})
            );
        }
        if offered <= 0. {
            continue;
        }
        let accepted = ((census - current) / offered).min(1.);
        let sources = offers
            .into_iter()
            .map(|(i, quantity)| {
                let heads = accepted * quantity;
                let share = heads / remaining[i];
                remaining[i] -= heads;
                (i, share)
            })
            .collect();
        let room = |i: usize| parcels[i].area_km2 * parcels[i].support.sqrt();
        let total_room: f64 = homes.iter().map(|&i| room(i)).sum();
        let receivers = homes.iter().map(|&i| (i, room(i) / total_room)).collect();
        transfers.push(HouseholdTransfers { sources, receivers });
    }
    transfers
}

fn hinterland(
    parcels: &[Parcel],
    homes: &[usize],
    occupied: &[bool],
    remaining: &[f64],
    survey: &SettlementCensus,
    retained_per_km2: f64,
) -> Vec<(usize, f64)> {
    // Use the diameter of the parent survey as a travel reach. Actual donors follow
    // connected land and transport links. Households supporting the countryside stay there.
    let reach = 2000. * (survey.surveyed_km2 / std::f64::consts::PI).sqrt();
    let mut distance = vec![f64::INFINITY; parcels.len()];
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for &i in homes {
        distance[i] = 0.;
        queue.push(i as u32, [0.]);
    }
    let mut offers = Vec::new();
    while let Some((i, [cost])) = queue.pop() {
        let i = i as usize;
        if cost != distance[i] {
            continue;
        }
        if !occupied[i] {
            let available = remaining[i] - retained_per_km2 * parcels[i].area_km2;
            if available > 0. {
                offers.push((i, available / (1. + (cost / reach).powi(2))));
            }
        }
        for &(j, step) in &parcels[i].ways {
            let offer = cost + step;
            if parcels[j].dry && offer < reach && offer < distance[j] {
                distance[j] = offer;
                queue.push(j as u32, [offer]);
            }
        }
    }
    offers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_survey_uses_existing_households_and_leaves_clipped_towns_and_rural_homes_occupied() {
        let mut parcels: Vec<_> = [0.2, 2., 3., 0.2, 0.2, 0.2, 2., 2.]
            .into_iter()
            .enumerate()
            .map(|(i, support)| {
                let mut ways = SmallVec::new();
                if i > 0 {
                    ways.push((i - 1, 400.));
                }
                if i < 7 {
                    ways.push((i + 1, 400.));
                }
                Parcel {
                    area_km2: 1.,
                    heads: 70.,
                    support,
                    dry: true,
                    buildable: true,
                    edge: i == 0 || i == 7,
                    adjacent: ways.len(),
                    ways,
                }
            })
            .collect();
        let survey = SettlementCensus {
            cell: 1,
            principal: true,
            townspeople: 220.,
            rural_people: 500.,
            surveyed_km2: 25.,
        };
        let clipped = SettlementCensus { cell: 7, ..survey };
        let plans = placement(&parcels, &[survey, clipped], false);
        assert_eq!(plans.len(), 1);
        let placed = &plans[0];
        assert!(placed.receivers.iter().all(|&(i, _)| i == 1 || i == 2));
        for &(i, share) in &placed.sources {
            assert!(![1, 2, 6, 7].contains(&i));
            assert!(parcels[i].heads * (1. - share) >= 20.);
        }
        parcels[2].edge = true;
        assert!(placement(&parcels, &[survey, clipped], false).is_empty());
    }
}
