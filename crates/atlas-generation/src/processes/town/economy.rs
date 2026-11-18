//! Homes respond to housing pressure; livelihoods respond to reachable opportunities.
use super::Livelihood;
use crate::town::{
    access::{Access, Entrance},
    catalogue::{AccessUse, Operation, PlaceRules},
    fabric::{Endpoint, Town},
    influence::{operating_tie, respond, support_for, Reachable},
};
use std::io;
pub fn housing_pressure(people: f64, floor_area: f64) -> f64 {
    people.max(0.) / (people.max(0.) + floor_area.max(0.) / 16. + 1.)
}
pub fn occupancy(home: bool, pressure: f64, support: f64, burden: f64) -> f64 {
    if home {
        (0.55 + pressure * 0.6) / (1. + burden * 0.08)
    } else {
        support / (0.4 + support)
    }
}
// hpc-exempt: commitments refer to holdings, fields and named external destinations.
type Commitments = std::collections::BTreeMap<Endpoint, f64>;
fn competing_claims(town: &Town) -> ([f64; 7], Commitments) {
    let mut competitors = [0.; 7];
    // hpc-exempt: counterparty identities group the custom already drawing on each offer.
    let mut commitments = std::collections::BTreeMap::new();
    for h in town.holdings() {
        competitors[h.secondary.unwrap_or(h.kind).definition().activity as usize] += 0.025;
        for (tie, share) in h.operating_shares() {
            *commitments.entry(tie.destination.clone()).or_insert(0.) += h.occupation * share;
        }
    }
    (competitors, commitments)
}
pub fn advance(town: &mut Town, context: &Livelihood<'_>) -> io::Result<()> {
    let (competitors, commitments) = competing_claims(town);
    let floor_areas = town
        .holdings()
        .iter()
        .map(|h| {
            h.buildings
                .iter()
                .zip(&h.storeys)
                .map(|(b, storeys)| {
                    context
                        .spatial
                        .area(b)
                        .map(|area| area * f64::from(*storeys))
                        .map_err(io::Error::other)
                })
                .sum::<io::Result<f64>>()
        })
        .collect::<io::Result<Vec<_>>>()?;
    let area = town
        .holdings()
        .iter()
        .zip(&floor_areas)
        .filter(|(h, _)| h.kind.definition().roles.dwelling)
        .map(|(_, area)| area)
        .sum();
    let pressure = housing_pressure(town.seat.story.people, area);
    let mut network =
        Access::new(town.streets(), context.spatial)?.on_ground(context.walking_ground);
    for &(a, b, cost) in context.links {
        network.add_link(a, b, cost, context.spatial)?;
    }
    let n = town.holdings().len();
    let locations: Vec<_> = town
        .holdings()
        .iter()
        .map(|h| Entrance::holding(town, h))
        .chain(
            context
                .sources
                .iter()
                .map(|s| Entrance::source(town, &s.endpoint, s.position)),
        )
        .collect();
    let modes: Vec<_> = town
        .holdings()
        .iter()
        .map(|h| Operation::ALL.map(|purpose| h.mode_for(purpose)))
        .collect();
    let graphs = [AccessUse::Foot, AccessUse::Freight, AccessUse::Waterborne]
        .into_iter()
        .filter(|m| modes.iter().any(|needs| needs.contains(&Some(*m))))
        .map(|mode| Ok((mode, network.bind(&locations, mode, context.spatial)?)))
        .collect::<io::Result<Vec<_>>>()?;
    for (i, needs) in modes.iter().enumerate() {
        let holding = &town.holdings()[i];
        let conditions = context.conditions.get(i).copied().unwrap_or_default();
        let place = holding.kind.definition();
        let activity = holding
            .secondary
            .unwrap_or(holding.kind)
            .definition()
            .activity;
        let own_source = Endpoint::Premises {
            town: town.seat.key.clone(),
            holding: holding.id,
        };
        let mut ties = Vec::new();
        let mut opportunity = crate::town::influence::Support::default();
        for (mode, graph) in graphs
            .iter()
            .filter(|(mode, _)| needs.contains(&Some(*mode)))
        {
            let routes = graph.routes(i);
            let paths: Vec<_> = context
                .sources
                .iter()
                .enumerate()
                .filter(|(_, s)| s.endpoint != own_source)
                .map(|(j, source)| Reachable {
                    source,
                    cost: routes.cost(n + j),
                    competitors: competitors[activity as usize]
                        + commitments.get(&source.endpoint).copied().unwrap_or(0.)
                            / (1. + source.demand + source.capability),
                })
                .collect();
            if *mode
                == holding
                    .secondary
                    .unwrap_or(holding.kind)
                    .definition()
                    .operating_access()
            {
                opportunity = support_for(activity, &paths, conditions);
            }
            for (purpose, _) in Operation::ALL
                .into_iter()
                .zip(needs)
                .filter(|(_, m)| **m == Some(*mode))
            {
                ties.extend(operating_tie(
                    purpose,
                    &paths,
                    *mode,
                    holding.ties.iter().find(|t| t.purpose == purpose),
                    context.exposure,
                ));
            }
        }
        let desired = (opportunity.demand + opportunity.capability)
            / (1. + place.demand + opportunity.burden);
        let support = respond(holding.support, desired.max(0.), context.exposure * 0.7);
        let returns = support / (1. + support);
        let costs = conditions.density + opportunity.burden;
        let sheltered = holding.means * conditions.protection / (1. + conditions.protection);
        let income = returns / (1. + costs * (1. - sheltered));
        // Household means are retained resources; loss of a trading opportunity does not erase them in one round.
        let means = respond(holding.means, income, context.exposure * 0.035);
        let occupation = if holding.established < town.round
            && (!holding.buildings.is_empty() || holding.public || holding.outdoor)
        {
            respond(
                holding.occupation,
                occupancy(place.roles.dwelling, pressure, support, opportunity.burden)
                    .clamp(0., 1.),
                context.exposure * 1.6,
            )
        } else {
            holding.occupation
        };
        let crowding = if place.roles.dwelling {
            let living_space = floor_areas[i];
            let neighbours = conditions.households / (1. + conditions.households);
            let local_pressure = neighbours * conditions.density / (1. + conditions.density);
            (pressure + local_pressure) * (1. - means) * occupation / (1. + living_space / 450.)
        } else {
            0.
        };
        let crowding = respond(holding.crowding, crowding, context.exposure * 0.5);
        let id = holding.id;
        let business = place
            .roles
            .secondary_business
            .filter(|_| holding.secondary.is_none());
        town.occupy(id, support, means, occupation, crowding);
        town.bind(id, ties);
        if let Some(choose_business) = business {
            use crate::town::fabric::{FabricEdit, FabricOwner};
            town.apply(
                FabricEdit::Share {
                    conditions,
                    premises: id,
                    use_: choose_business(conditions),
                },
                context.spatial,
            )?;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn homes_remain_in_demand_when_trade_fails() {
        assert!(occupancy(true, 0.8, 0., 0.5) > 0.8);
        assert_eq!(occupancy(false, 0.8, 0., 0.5), 0.);
        assert!(housing_pressure(5000., 1000.) > housing_pressure(5000., 50000.));
    }
}
