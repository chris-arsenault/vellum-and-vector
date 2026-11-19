//! Homes respond to housing pressure; livelihoods respond to reachable opportunities.
use super::Livelihood;
use crate::town::{
    access::{Access, Entrance},
    catalogue::{AccessUse, Operation, PlaceRules},
    fabric::{Endpoint, Town},
    influence::{operating_tie, respond, support_for, Reachable},
};
use std::io;
const LIVING_AREA_PER_PERSON: f64 = 16.;
// A third of the population working in dedicated premises, at 18 m² per worker.
const WORKING_AREA_PER_PERSON: f64 = 6.;
#[derive(Clone, Copy, Default)]
pub(super) struct FloorSpace {
    pub living: f64,
    pub working: f64,
}
#[derive(Clone, Copy)]
pub(super) struct UnmetDemand {
    pub living: f64,
    pub working: f64,
}
impl FloorSpace {
    pub fn occupied_residents(self, occupation: f64) -> f64 {
        self.living * occupation / LIVING_AREA_PER_PERSON
    }
    pub fn holding(
        h: &crate::town::fabric::Holding,
        spatial: &dyn crate::spatial::SpatialKernel,
    ) -> io::Result<Self> {
        let mut space = Self::default();
        let definition = h.kind.definition();
        for (i, (building, floors)) in h.buildings.iter().zip(&h.storeys).enumerate() {
            let footprint = spatial.area(building).map_err(io::Error::other)?;
            let area = footprint * f64::from(*floors);
            if definition.building(i).roles.dwelling {
                // A home business shares the entrance floor with its household.
                let workshop = if i == 0 && h.secondary.is_some() {
                    footprint * 0.5
                } else {
                    0.
                };
                space.living += area - workshop;
                space.working += workshop;
            } else {
                space.working += area;
            }
        }
        Ok(space)
    }
    pub fn add(&mut self, other: Self) {
        self.living += other.living;
        self.working += other.working;
    }
    pub fn need(self, people: f64) -> UnmetDemand {
        UnmetDemand {
            living: housing_pressure(people, self.living),
            working: shortfall(people * WORKING_AREA_PER_PERSON, self.working),
        }
    }
}
fn shortfall(required: f64, supplied: f64) -> f64 {
    if required > 0. {
        (1. - supplied.max(0.) / required).max(0.)
    } else {
        0.
    }
}
pub fn housing_pressure(people: f64, floor_area: f64) -> f64 {
    shortfall(people * LIVING_AREA_PER_PERSON, floor_area)
}
pub fn occupancy(home: bool, residential_use: f64, support: f64, burden: f64) -> f64 {
    if home {
        residential_use / (1. + burden * 0.08)
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
        .map(|h| FloorSpace::holding(h, context.spatial))
        .collect::<io::Result<Vec<_>>>()?;
    let area = floor_areas.iter().map(|a| a.living).sum();
    let pressure = housing_pressure(town.seat.story.people, area);
    let residential_use =
        (town.seat.story.people * LIVING_AREA_PER_PERSON / area.max(1.)).clamp(0., 1.);
    let mut network = Access::for_town(town, context.spatial)?.on_ground(context.walking_ground);
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
    let reach = crate::town::settings::DAILY_REACH;
    let mut queries: Vec<_> = graphs
        .iter()
        .map(|(mode, graph)| {
            let queries = graph.distance_queries();
            let sources = queries.destinations((0..context.sources.len()).map(|j| (n + j, j)));
            (*mode, queries, sources)
        })
        .collect();
    let landlords = town
        .founding_sites
        .iter()
        .map(|&(_, id)| id)
        .filter(|id| {
            let h = &town.holdings()[id.0 as usize];
            h.slot.tenure == crate::town::templates::Tenure::Institutional
                && h.condition > 0.2
                && h.occupation > 0.
        })
        .collect::<Vec<_>>();
    let mut dues = 0.;
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
        for (mode, routes, sources) in queries
            .iter_mut()
            .filter(|(mode, ..)| needs.contains(&Some(*mode)))
        {
            routes.within(i, reach);
            let mut reached = Vec::new();
            routes.reached(sources, reach, |j, cost| reached.push((j, cost)));
            // hpc-exempt: reached sources in provider order, so equal offers resolve as listed.
            reached.sort_unstable_by_key(|&(j, _)| j);
            let paths: Vec<_> = reached
                .into_iter()
                .map(|(j, cost)| (&context.sources[j], cost))
                .filter(|(s, _)| s.endpoint != own_source)
                .map(|(source, cost)| Reachable {
                    source,
                    cost,
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
        let mut income = returns / (1. + costs * (1. - sheltered));
        if holding.slot.tenure == crate::town::templates::Tenure::Dependent && !landlords.is_empty()
        {
            let rent = income * 0.5;
            income -= rent;
            dues += rent * holding.occupation;
        }
        // Household means are retained resources; loss of a trading opportunity does not erase them in one round.
        let means = respond(holding.means, income, context.exposure * 0.035);
        let occupation = if holding.established < town.round
            && (!holding.buildings.is_empty() || holding.public || holding.outdoor)
        {
            respond(
                holding.occupation,
                occupancy(
                    place.roles.dwelling,
                    residential_use,
                    support,
                    opportunity.burden,
                )
                .clamp(0., 1.),
                context.exposure * 1.6,
            )
        } else {
            holding.occupation
        };
        let crowding = if place.roles.dwelling {
            let living_space = floor_areas[i].living;
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
    distribute_rents(town, &landlords, dues, context.exposure);
    Ok(())
}

fn distribute_rents(
    town: &mut Town,
    landlords: &[crate::town::fabric::HoldingId],
    dues: f64,
    exposure: f64,
) {
    if dues > 0. {
        let share = dues / landlords.len() as f64;
        for &id in landlords {
            let h = &town.holdings()[id.0 as usize];
            let claim_income = respond(h.means, h.means + share, exposure * 0.035);
            town.occupy(
                id,
                h.support,
                claim_income.clamp(0., 1.),
                h.occupation,
                h.crowding,
            );
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_occupied_living_space_contributes_residents() {
        let home = FloorSpace {
            living: 64.,
            working: 24.,
        };
        let workshop = FloorSpace {
            living: 0.,
            working: 128.,
        };
        assert_eq!(home.occupied_residents(0.75), 3.);
        assert_eq!(home.occupied_residents(0.), 0.);
        assert_eq!(workshop.occupied_residents(1.), 0.);
    }
    #[test]
    fn homes_remain_in_demand_when_trade_fails() {
        assert!(occupancy(true, 1., 0., 0.5) > 0.8);
        assert_eq!(occupancy(false, 0.8, 0., 0.5), 0.);
        assert!(housing_pressure(5000., 1000.) > housing_pressure(5000., 50000.));
    }
    #[test]
    fn housing_and_workplace_vacancies_answer_different_needs() {
        let shops = FloorSpace {
            living: 0.,
            working: 600.,
        }
        .need(100.);
        assert!(shops.living > 0. && shops.working == 0.);
        let homes = FloorSpace {
            living: 1600.,
            working: 0.,
        }
        .need(100.);
        assert!(homes.living == 0. && homes.working > 0.);
    }
}
