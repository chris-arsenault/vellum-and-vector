//! Each reachable group shares its custom among compatible places and staying home.
use crate::town::{
    access::BoundNetwork,
    catalogue::{AccessUse, Operation},
    effects::Clientele,
    fabric::{Endpoint, OperatingTie, Town},
    influence::OpportunitySource,
};

pub(super) fn visits(
    town: &Town,
    sources: &[OpportunitySource],
    graph: &BoundNetwork,
) -> Vec<Vec<OperatingTie>> {
    let holdings = town.holdings();
    let attractions: Vec<_> = holdings
        .iter()
        .map(|h| {
            let mut weights = [0.; Clientele::ALL.len()];
            let occupation = h.occupation / (1. + f64::from(h.secondary.is_some()));
            for kind in std::iter::once(h.kind).chain(h.secondary) {
                for attraction in h.effects_as(kind).attracts {
                    weights[attraction.kind as usize] +=
                        attraction.strength * occupation * h.condition * h.operation_scale();
                }
            }
            weights
        })
        .collect();
    let mut visits = vec![Vec::new(); holdings.len()];
    if attractions
        .iter()
        .all(|w| w.iter().all(|&weight| weight <= 0.))
    {
        return visits;
    }
    let mut queries = graph.distance_queries();
    let scale = town.scale();
    let mut draws = vec![Vec::new(); sources.len()];
    for group in Clientele::ALL {
        let patrons = sources
            .iter()
            .enumerate()
            .filter(|(_, s)| s.clientele == Some(group) && s.demand > 0.)
            .map(|(i, _)| holdings.len() + i)
            .collect::<Vec<_>>();
        let venues = attractions
            .iter()
            .enumerate()
            .filter(|(_, w)| w[group as usize] > 0.)
            .map(|(target, _)| target)
            .collect::<Vec<_>>();
        queries.pairs_within(
            &patrons,
            &venues,
            group.reach(scale),
            |origin, target, cost| {
                let i = origin - holdings.len();
                if sources[i].endpoint
                    != (Endpoint::Premises {
                        town: town.seat.key,
                        holding: holdings[target].id,
                    })
                {
                    let draw = group.draw(attractions[target][group as usize], cost, scale);
                    draws[i].push((target, draw));
                }
            },
        );
    }
    for (source, shares) in sources.iter().zip(draws) {
        let total = 1. + shares.iter().map(|(_, draw)| draw).sum::<f64>();
        for (target, attraction) in shares {
            visits[target].push(OperatingTie {
                purpose: Operation::Customers,
                destination: source.endpoint.clone(),
                entrance: source.position,
                access: AccessUse::Foot,
                strength: source.demand * attraction / total,
                productive: None,
                clientele: source.clientele,
            });
        }
    }
    visits
}
