//! Locate the townspeople counted by a coarse survey on the region's developed ground.
use crate::{
    field::{
        people::{
            land::LandDemand,
            work::{habitable, km2, Work},
        },
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
    built_km2: f64,
    area_km2: f64,
    construction_cost: f64,
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
    let farms = field.people().view(HumanField::Layer(LayerId::Farmland));
    let pasture = field.people().view(HumanField::Layer(LayerId::Pasture));
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
            built_km2: ground.built_share * area,
            area_km2: area,
            // Retaining working land and building on a slope both raise the cost of expansion.
            construction_cost: 1. + farms.get(cell)? + pasture.get(cell)? + ground.slope.max(0.),
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
    settlement_markets(parcels, towns, None)
}

fn settlement_markets(
    parcels: &[Parcel],
    towns: &[SettlementCensus],
    settled: Option<&[bool]>,
) -> (Vec<Vec<usize>>, Vec<bool>) {
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
                && (settled.is_some_and(|inside| inside[next])
                    || parcels[next].support > threshold[town])
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

pub(in crate::field::people) fn developed_land(
    field: &Field,
    work: &Work,
    demand: LandDemand,
) -> io::Result<Vec<(usize, usize, f64)>> {
    let parcels = parcels(field, work)?;
    Ok(place_developed_land(
        &parcels,
        &work.markets,
        work.city.is_some(),
        demand,
    ))
}

// owner-direction(2026-11-27): the land occupied by a city must fit its population and the land its people use.
// owner-direction(2026-11-27): city districts should have near 100 percent urban coverage.
/// Households can use their own sites and rent surplus ground in the same
/// connected settlement. Only already settled markets can supply shared lots.
pub(in crate::field::people) fn city_lots(
    field: &Field,
    work: &Work,
    area_scale: f64,
) -> io::Result<crate::storage::Band<f64>> {
    let parcels = parcels(field, work)?;
    let (markets, _) = settlement_markets(
        &parcels,
        &work.markets,
        work.city.as_ref().map(|c| c.settled.as_slice()),
    );
    let surveyed = work
        .markets
        .iter()
        .find(|s| s.principal)
        .map_or(SettlementCensus::DEFAULT_BUILT_KM2_PER_RESIDENT, |s| {
            s.built_km2_per_resident()
        });
    let area = surveyed * super::super::facts::CITY_PLOT_DEMAND_SCALE * area_scale;
    let additional = plot_claims(&parcels, &markets, area);
    let mut land = super::super::work::working(field);
    for (c, km2) in additional.into_iter().enumerate() {
        land.set(c, km2 / parcels[c].area_km2)?;
    }
    Ok(land)
}

fn plot_claims(parcels: &[Parcel], markets: &[Vec<usize>], km2_per_person: f64) -> Vec<f64> {
    let mut additions = vec![0.; parcels.len()];
    for market in markets {
        let mut demand = 0.;
        let mut existing = 0.;
        let mut own_sites = 0.;
        let eligible = || market.iter().copied().filter(|&c| parcels[c].buildable);
        for c in eligible() {
            let p = &parcels[c];
            let sought = p.heads * km2_per_person / p.construction_cost;
            demand += sought;
            existing += p.built_km2;
            own_sites += (sought.min(p.area_km2) - p.built_km2).max(0.);
        }
        let outstanding = demand - existing;
        if existing <= 0. || outstanding <= 0. {
            continue;
        }
        let share = if own_sites > outstanding {
            outstanding / own_sites
        } else {
            1.
        };
        let mut offers = Vec::new();
        for c in eligible() {
            let p = &parcels[c];
            let sought = p.heads * km2_per_person / p.construction_cost;
            additions[c] = share * (sought.min(p.area_km2) - p.built_km2).max(0.);
            let available = p.area_km2 - p.built_km2 - additions[c];
            if available > 0. && outstanding > own_sites {
                offers.push((c, available, p.construction_cost));
            }
        }
        clear_shared_lots(offers, outstanding - own_sites, &mut additions);
    }
    additions
}

/// At price P a parcel offers min(P / cost, 1) of its available area. Once a
/// cheaper parcel is fully taken, the remaining parcels clear the remaining bid.
fn clear_shared_lots(mut offers: Vec<(usize, f64, f64)>, mut demand: f64, additions: &mut [f64]) {
    // hpc-exempt: sort the finite offers by the price at which each runs out of land.
    offers.sort_by(|a, b| a.2.total_cmp(&b.2));
    let mut weight: f64 = offers.iter().map(|&(_, area, cost)| area / cost).sum();
    for (index, &(c, area, cost)) in offers.iter().enumerate() {
        if demand < weight * cost {
            let price = demand / weight;
            for &(remaining, area, cost) in &offers[index..] {
                additions[remaining] += area * (price / cost).min(1.);
            }
            break;
        }
        additions[c] += area;
        demand -= area;
        weight -= area / cost;
    }
}

// Households bid for land at their surveyed area per person. As demand rises,
// more of a mixed cell can support urban use. Open ground and other uses still compete.
fn urban_demand(parcel: &Parcel, km2_per_resident: f64, elasticity: f64) -> f64 {
    if !parcel.buildable || parcel.heads <= 0. {
        return 0.;
    }
    let pressure = parcel.heads * km2_per_resident / (parcel.area_km2 * parcel.construction_cost);
    parcel.area_km2 / (1. + pressure.powf(-elasticity))
}

fn place_developed_land(
    parcels: &[Parcel],
    towns: &[SettlementCensus],
    principal_only: bool,
    demand: LandDemand,
) -> Vec<(usize, usize, f64)> {
    let mut stock: Vec<_> = parcels.iter().map(|p| p.built_km2).collect();
    let (groups, occupied) = neighbourhoods(parcels, towns);
    let mut flows = Vec::new();
    for (survey, homes) in towns.iter().zip(groups) {
        if (principal_only && !survey.principal) || homes.is_empty() || survey.surveyed_km2 <= 0. {
            continue;
        }
        let land_per_person = survey.built_km2_per_resident() * demand.area_scale;
        let mut bids = Vec::new();
        let mut donors = Vec::new();
        for &c in &homes {
            let difference =
                urban_demand(&parcels[c], land_per_person, demand.elasticity) - stock[c];
            if difference > 0. {
                bids.push((c, difference));
            } else if difference < 0. {
                donors.push((c, -difference));
            }
        }
        if bids.is_empty() {
            continue;
        }
        let rural_share = survey.rural_people / survey.surveyed_km2 * land_per_person;
        for (c, available) in hinterland(parcels, &homes, &occupied, &stock, survey, rural_share) {
            let surplus = stock[c] - urban_demand(&parcels[c], land_per_person, demand.elasticity);
            if surplus > 0. {
                donors.push((c, surplus.min(available)));
            }
        }
        trade_land(&mut stock, donors, bids, &mut flows);
    }
    flows
}

/// A shortage is shared by the competing bids. Travel order never gives a cell priority.
fn trade_land(
    stock: &mut [f64],
    donors: Vec<(usize, f64)>,
    mut bids: Vec<(usize, f64)>,
    flows: &mut Vec<(usize, usize, f64)>,
) {
    let supply: f64 = donors.iter().map(|(_, area)| area).sum();
    let demand: f64 = bids.iter().map(|(_, area)| area).sum();
    let exchanged = supply.min(demand);
    if exchanged <= 0. {
        return;
    }
    for (_, area) in &mut bids {
        *area *= exchanged / demand;
    }
    let mut bids = bids.into_iter().peekable();
    for (from, offered) in donors {
        let mut left = offered * (exchanged / supply);
        while let Some((to, needed)) = bids.peek_mut() {
            let take = left.min(*needed);
            if take <= 0. {
                break;
            }
            flows.push((from, *to, take));
            stock[from] -= take;
            stock[*to] += take;
            left -= take;
            *needed -= take;
            if *needed <= 0. {
                bids.next();
            }
            if left <= 0. {
                break;
            }
        }
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

    fn surveyed_corridor() -> (Vec<Parcel>, SettlementCensus) {
        let parcels: Vec<_> = (0_usize..13)
            .map(|i| {
                let ways: SmallVec<_> = [i.checked_sub(1), (i < 12).then_some(i + 1)]
                    .into_iter()
                    .flatten()
                    .map(|to| (to, 100.))
                    .collect();
                Parcel {
                    heads: 1500.,
                    built_km2: 0.25,
                    area_km2: 1.,
                    construction_cost: 1.,
                    support: 2.,
                    dry: true,
                    buildable: true,
                    edge: i == 0 || i == 12,
                    adjacent: ways.len(),
                    ways,
                }
            })
            .collect();
        let survey = SettlementCensus {
            cell: 6,
            principal: true,
            townspeople: 16_000.,
            rural_people: 200.,
            surveyed_km2: 20.,
            built_km2: 2.4,
        };
        (parcels, survey)
    }

    #[test]
    fn urban_households_can_occupy_more_ground_than_the_inherited_building_sites() {
        let (mut parcels, _) = surveyed_corridor();
        for parcel in &mut parcels {
            parcel.heads = 0.;
        }
        parcels[2].heads = 6_000.;
        let market = vec![1, 2, 3];
        let claims = plot_claims(&parcels, &[market], 1_200. / 1_000_000.);
        assert!(claims[2] > 0.7 && claims[1] > 0.7 && claims[3] > 0.7);
        assert_eq!(claims[4], 0.);
        for (parcel, added) in parcels.iter_mut().zip(claims) {
            parcel.built_km2 += added;
        }
        assert_eq!(plot_claims(&parcels, &[vec![1, 2, 3]], 0.0012)[2], 0.);
    }

    #[test]
    fn named_markets_use_existing_ground_first_and_leave_unassigned_or_reserved_land_untouched() {
        let (mut parcels, _) = surveyed_corridor();
        parcels[1].heads = 800.;
        parcels[1].built_km2 = 0.1;
        parcels[2].heads = 0.;
        parcels[2].built_km2 = 0.8;
        parcels[4].buildable = false;
        let claims = plot_claims(&parcels, &[vec![1, 2], vec![3, 4]], 0.001);
        assert_eq!([claims[1], claims[2]], [0., 0.]);
        assert_eq!(claims[3], 0.75);
        assert_eq!([claims[4], claims[5]], [0., 0.]);
    }

    #[test]
    fn shared_bids_clear_costly_ground_after_cheaper_land_runs_out() {
        let (mut parcels, _) = surveyed_corridor();
        parcels[1].heads = 2_600.;
        parcels[1].built_km2 = 1.;
        for p in &mut parcels[2..=3] {
            p.heads = 0.;
            p.built_km2 = 0.;
        }
        parcels[3].construction_cost = 2.;
        let markets = [vec![1, 2, 3]];
        let claims = plot_claims(&parcels, &markets, 0.001);
        assert_eq!(claims[2], 1.);
        assert!((0.59..0.61).contains(&claims[3]));
        for (parcel, added) in parcels.iter_mut().zip(claims) {
            parcel.built_km2 += added;
        }
        let next = plot_claims(&parcels, &markets, 0.001);
        assert!(next.iter().all(|&added| added < 1e-9));
    }

    #[test]
    fn settled_households_can_take_reachable_vacant_lots_without_crossing_a_reservation() {
        let (mut parcels, survey) = surveyed_corridor();
        for parcel in &mut parcels {
            parcel.support = 0.;
            parcel.heads = 0.;
            parcel.built_km2 = 0.;
        }
        parcels[survey.cell].support = 2.;
        parcels[survey.cell].heads = 8_000.;
        parcels[survey.cell].built_km2 = 0.5;
        let mut inside = vec![false; parcels.len()];
        inside[5..=9].fill(true);
        parcels[8].buildable = false;
        let (markets, _) = settlement_markets(&parcels, &[survey], Some(&inside));
        let claims = plot_claims(&parcels, &markets, 0.0012);
        assert!(claims[5] > 0.9 && claims[7] > 0.9);
        assert_eq!(claims[8], 0.);
        assert_eq!(claims[9], 0.);
        assert_eq!(claims[4], 0.);
    }

    #[test]
    fn households_compete_for_land_in_proportion_to_demand() {
        let (mut parcels, survey) = surveyed_corridor();
        let km2_per_head = survey.built_km2_per_resident();
        parcels[2].heads = 12_000.;
        parcels[9].heads = 12_000.;
        assert!(
            urban_demand(&parcels[2], km2_per_head, 3.)
                > urban_demand(&parcels[2], km2_per_head, 1.)
        );
        let mut stock: Vec<_> = parcels.iter().map(|p| p.built_km2).collect();
        for (from, to, area) in place_developed_land(&parcels, &[survey], true, LandDemand::DEFAULT)
        {
            stock[from] -= area;
            stock[to] += area;
        }
        assert!(stock[2] > 0.8 && stock[9] > 0.8);
        assert!(stock[6] < stock[2]); // The survey marker alone makes no bid.
        parcels[2].construction_cost = 2.;
        assert!(
            urban_demand(&parcels[2], km2_per_head, 3.)
                < urban_demand(&parcels[9], km2_per_head, 3.)
        );
        parcels[2].buildable = false;
        assert_eq!(urban_demand(&parcels[2], km2_per_head, 3.), 0.);
    }

    #[test]
    fn scarce_land_is_shared_by_competing_receivers() {
        let mut stock = [0.6, 0., 0.];
        trade_land(
            &mut stock,
            vec![(0, 0.6)],
            vec![(1, 0.8), (2, 0.4)],
            &mut Vec::new(),
        );
        assert!(stock[1] > stock[2] && stock[2] > 0.15);
        assert!(stock[1] < 0.45);
    }

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
                    construction_cost: 1.,
                    heads: 70.,
                    built_km2: 0.1,
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
            built_km2: 1.,
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
