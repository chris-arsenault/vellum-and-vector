//! Economic contributions have domain meaning; providers never prescribe wealth or layout.
use super::{catalogue::Activity, geometry::Point};
use crate::execution::QueryValue;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OpportunitySource {
    pub endpoint: super::fabric::Endpoint,
    pub id: String,
    pub label: String,
    pub position: Point,
    pub activity: Activity,
    pub demand: f64,
    pub capability: f64,
}
pub struct Sources(pub Vec<OpportunitySource>);
impl QueryValue for Sources {}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Conditions {
    pub clearance: f64,
    pub bank: bool,
    pub flowing: bool,
    pub craft: Option<i32>,
    pub yielding: f64,
    pub forgetting: f64,
    pub presence: f64,
    pub patronage: f64,
    pub households: f64,
    pub institutions: f64,
    pub workshops: f64,
    pub exchange: f64,
    pub population: f64,
    pub cultivated: f64,
    pub rural_service: f64,
    pub density: f64,
    pub slope: f64,
    pub flood: f64,
    pub waste: f64,
    pub nuisance: f64,
    pub protection: f64,
    pub building: f64,
    pub travel: f64,
}
pub struct SiteConditions(pub Vec<Vec<Conditions>>);
impl QueryValue for SiteConditions {}
#[derive(Clone, Debug, Default)]
pub struct Support {
    pub demand: f64,
    pub capability: f64,
    pub burden: f64,
    pub source: Option<String>,
}
/// Paths to a source are alternatives, not duplicate demand. Costs are supplied by access.
pub struct Reachable<'a> {
    pub source: &'a OpportunitySource,
    pub cost: f64,
    pub competitors: f64,
}
pub struct Opportunities([Support; 7]);
#[derive(Clone, Copy, Default)]
struct Totals<'a> {
    demand: f64,
    capability: f64,
    strongest: f64,
    label: Option<&'a str>,
}
impl<'a> Totals<'a> {
    fn add(&mut self, source: &'a OpportunitySource, cost: f64, competitors: f64) {
        let reach = 1. / (1. + cost / 180.);
        let demand = source.demand * reach / (1. + competitors);
        self.demand += demand;
        self.capability += source.capability * reach;
        if demand > self.strongest {
            self.strongest = demand;
            self.label = Some(&source.label);
        }
    }
    fn finish(self, conditions: Conditions) -> Support {
        Support {
            demand: self.demand,
            capability: self.capability,
            source: self.label.map(str::to_owned),
            burden: conditions.waste
                + conditions.nuisance
                + conditions.flood
                + conditions.slope * 0.5
                + 0.2 / (1. + conditions.protection),
        }
    }
}

struct Offer<'a> {
    origin: usize,
    source: &'a OpportunitySource,
    competitors: f64,
}
fn cheapest_offers<'a>(
    activity: Activity,
    offers: &[Offer<'a>],
    rows: &[Vec<f64>],
    mut visit: impl FnMut(usize, &Offer<'a>, f64),
) {
    let mut eligible = offers
        .iter()
        .zip(rows)
        .filter(|(offer, _)| compatible(activity, offer.source.activity));
    let Some(first) = eligible.next() else { return };
    if eligible.clone().next().is_none() {
        let (offer, costs) = first;
        for (site, &cost) in costs.iter().enumerate().filter(|(_, c)| c.is_finite()) {
            visit(site, offer, cost);
        }
        return;
    }
    for i in 0..first.1.len() {
        let best = std::iter::once(first)
            .chain(eligible.clone())
            .filter(|(_, costs)| costs[i].is_finite())
            .min_by(|(_, a), (_, b)| a[i].total_cmp(&b[i]));
        if let Some((offer, costs)) = best {
            visit(i, offer, costs[i]);
        }
    }
}
/// Read one source's distances across sites at a time. Alternatives with the same identity
/// compete for each compatible activity, with equal-cost paths retaining provider order.
pub(crate) enum FrontageRead {
    HouseholdDemand,
    Construction,
}
pub(crate) fn frontage_support(
    sources: &[OpportunitySource],
    competitors: impl Fn(&OpportunitySource) -> f64,
    read: FrontageRead,
    sites: &[Conditions],
    distances: impl FnMut(usize, &mut [f64]),
) -> Vec<Opportunities> {
    match read {
        FrontageRead::HouseholdDemand => batch(
            sources,
            competitors,
            &[Activity::Household],
            sites,
            distances,
            |total, offer, cost| {
                total.demand +=
                    offer.source.demand / ((1. + cost / 180.) * (1. + offer.competitors))
            },
        ),
        FrontageRead::Construction => batch(
            sources,
            competitors,
            &Activity::ALL,
            sites,
            distances,
            |total, offer, cost| total.add(offer.source, cost, offer.competitors),
        ),
    }
}
fn batch<'a, const N: usize>(
    sources: &'a [OpportunitySource],
    competitors: impl Fn(&OpportunitySource) -> f64,
    activities: &[Activity; N],
    sites: &[Conditions],
    mut distances: impl FnMut(usize, &mut [f64]),
    accumulate: impl Fn(&mut Totals<'a>, &Offer<'a>, f64),
) -> Vec<Opportunities> {
    let mut order: Vec<_> = sources
        .iter()
        .enumerate()
        .filter(|(_, s)| activities.iter().any(|&a| compatible(a, s.activity)))
        .map(|(origin, source)| Offer {
            origin,
            source,
            competitors: competitors(source),
        })
        .collect();
    // hpc-exempt: group retained counterparty identities in stable provider order.
    order.sort_by(|a, b| a.source.id.cmp(&b.source.id));
    let mut totals = vec![[Totals::default(); N]; sites.len()];
    let mut rows: Vec<Vec<f64>> = Vec::new();
    for group in order.chunk_by(|a, b| a.source.id == b.source.id) {
        if rows.len() < group.len() {
            rows.resize_with(group.len(), || vec![0.; sites.len()]);
        }
        for (offer, row) in group.iter().zip(&mut rows) {
            distances(offer.origin, row);
        }
        for (a, &activity) in activities.iter().enumerate() {
            cheapest_offers(activity, group, &rows, |site, offer, cost| {
                accumulate(&mut totals[site][a], offer, cost);
            });
        }
    }
    totals
        .into_iter()
        .zip(sites)
        .map(|(t, &cond)| {
            let mut answers = Opportunities(Default::default());
            for (&activity, total) in activities.iter().zip(t) {
                answers.0[activity as usize] = total.finish(cond);
            }
            answers
        })
        .collect()
}
impl Opportunities {
    pub fn new(paths: &[Reachable<'_>], conditions: Conditions) -> Self {
        Self(std::array::from_fn(|i| {
            support_for(Activity::ALL[i], paths, conditions)
        }))
    }
    pub fn for_activity(&self, activity: Activity) -> &Support {
        &self.0[activity as usize]
    }
}
/// Households seek livelihoods; occupied households supply an audience for workplaces.
pub fn compatible(consumer: Activity, source: Activity) -> bool {
    if consumer == Activity::Household {
        source != Activity::Household
    } else {
        source == Activity::Household || source == Activity::Trade || source == consumer
    }
}
pub fn support_for(activity: Activity, paths: &[Reachable<'_>], conditions: Conditions) -> Support {
    support_from(
        paths
            .iter()
            .filter(|p| compatible(activity, p.source.activity)),
        conditions,
    )
}
/// Bind a counterparty for an actual use. Retained custom favours an operating
/// relationship while an unavailable destination gradually loses its strength.
pub fn operating_tie(
    purpose: super::catalogue::Operation,
    paths: &[Reachable<'_>],
    access: super::catalogue::AccessUse,
    old: Option<&super::fabric::OperatingTie>,
    exposure: f64,
) -> Option<super::fabric::OperatingTie> {
    use super::fabric::OperatingTie;
    let offers = paths
        .iter()
        .filter(|p| p.cost.is_finite() && purpose.offered_by(p.source.activity))
        .map(|p| {
            let strength = (p.source.demand + p.source.capability)
                / ((1. + p.cost / 180.) * (1. + p.competitors));
            let custom = old
                .filter(|t| t.destination == p.source.endpoint)
                .map_or(0., |t| t.strength);
            (p, strength, strength * (1. + custom / (1. + custom)))
        })
        .filter(|(_, s, _)| *s > 0.);
    if let Some((path, desired, _)) = offers.max_by(|a, b| a.2.total_cmp(&b.2)) {
        return Some(OperatingTie {
            purpose,
            destination: path.source.endpoint.clone(),
            entrance: path.source.position,
            access,
            strength: respond(
                old.filter(|t| t.destination == path.source.endpoint)
                    .map_or(0., |t| t.strength),
                desired,
                exposure,
            ),
        });
    }
    let mut tie = old?.clone();
    tie.strength = respond(tie.strength, 0., exposure);
    (tie.strength > 0.01).then_some(tie)
}
pub fn support(paths: &[Reachable<'_>], conditions: Conditions) -> Support {
    support_from(paths.iter(), conditions)
}
fn support_from<'a, 'b: 'a>(
    paths: impl Iterator<Item = &'a Reachable<'b>>,
    conditions: Conditions,
) -> Support {
    // hpc-exempt: sparse source identities select alternative geographic paths, not lattice values.
    let mut seen = std::collections::BTreeMap::<&str, &Reachable<'_>>::new();
    for path in paths.filter(|p| p.cost.is_finite()) {
        seen.entry(path.source.id.as_str())
            .and_modify(|current| {
                if path.cost < current.cost {
                    *current = path;
                }
            })
            .or_insert(path);
    }
    let mut result = Totals::default();
    for path in seen.into_values() {
        result.add(path.source, path.cost, path.competitors);
    }
    result.finish(conditions)
}
/// A bounded share of an adjustment, not an economic conservation or accuracy constraint.
pub fn respond(previous: f64, desired: f64, exposure: f64) -> f64 {
    previous + (desired - previous) * (1.0 - (-exposure.max(0.0)).exp())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lost_access_redirects_operating_work_to_a_reachable_counterparty() {
        use super::super::{catalogue::AccessUse, fabric::Endpoint};
        let first = OpportunitySource {
            endpoint: Endpoint::External("port".into()),
            id: "port".into(),
            label: "Port".into(),
            position: [0., 0.],
            activity: Activity::Trade,
            demand: 8.,
            capability: 0.,
        };
        let other = OpportunitySource {
            endpoint: Endpoint::Field("7".into()),
            id: "fields".into(),
            label: "Fields".into(),
            demand: 4.,
            ..first.clone()
        };
        let mut paths = [
            Reachable {
                source: &first,
                cost: 20.,
                competitors: 0.,
            },
            Reachable {
                source: &other,
                cost: 20.,
                competitors: 0.,
            },
        ];
        let bind = |paths: &[Reachable], old: Option<&super::super::fabric::OperatingTie>| {
            operating_tie(
                super::super::catalogue::Operation::Work,
                paths,
                AccessUse::Foot,
                old,
                1.,
            )
            .unwrap()
        };
        let tie = bind(&paths, None);
        assert_eq!(tie.destination, first.endpoint);
        paths[0].cost = f64::INFINITY;
        assert!(bind(&paths[..1], Some(&tie)).strength < tie.strength);
        let replacement = bind(&paths, Some(&tie));
        assert_eq!(replacement.destination, other.endpoint);
    }
    #[test]
    fn suppliers_and_service_providers_answer_different_needs() {
        use super::super::{
            catalogue::{AccessUse, Operation},
            fabric::Endpoint,
        };
        let fields = OpportunitySource {
            endpoint: Endpoint::Field("8".into()),
            id: "estate".into(),
            position: [0., 0.],
            label: "fields".into(),
            activity: Activity::Agriculture,
            demand: 8.,
            capability: 0.,
        };
        let healer = OpportunitySource {
            endpoint: Endpoint::External("physic".into()),
            id: "healer".into(),
            activity: Activity::Service,
            ..fields.clone()
        };
        let paths = [
            Reachable {
                source: &fields,
                cost: 50.,
                competitors: 0.,
            },
            Reachable {
                source: &healer,
                cost: 10.,
                competitors: 0.,
            },
        ];
        let supply =
            operating_tie(Operation::Supply, &paths, AccessUse::Freight, None, 1.).unwrap();
        let care = operating_tie(Operation::Service, &paths, AccessUse::Foot, None, 1.).unwrap();
        assert_eq!(supply.destination, fields.endpoint);
        assert_eq!(care.destination, healer.endpoint);
    }
    #[test]
    fn alternative_paths_do_not_duplicate_a_sources_demand() {
        let source = OpportunitySource {
            endpoint: super::super::fabric::Endpoint::External("pilgrims".into()),
            id: "pilgrims".into(),
            label: "Pilgrims".into(),
            position: [0., 0.],
            activity: Activity::Hospitality,
            demand: 12.,
            capability: 0.,
        };
        let paths = [
            Reachable {
                source: &source,
                cost: 100.,
                competitors: 2.,
            },
            Reachable {
                source: &source,
                cost: 0.,
                competitors: 2.,
            },
        ];
        assert_eq!(support(&paths, Conditions::default()).demand, 4.);
    }
    #[test]
    fn blocked_access_and_competition_have_distinct_effects() {
        let source = OpportunitySource {
            endpoint: super::super::fabric::Endpoint::External("road".into()),
            id: "road".into(),
            label: "Road traffic".into(),
            position: [0., 0.],
            activity: Activity::Trade,
            demand: 8.,
            capability: 2.,
        };
        assert_eq!(
            support(
                &[Reachable {
                    source: &source,
                    cost: f64::INFINITY,
                    competitors: 0.
                }],
                Conditions::default()
            )
            .demand,
            0.
        );
        let result = support(
            &[Reachable {
                source: &source,
                cost: 0.,
                competitors: 3.,
            }],
            Conditions {
                waste: 1.,
                ..Conditions::default()
            },
        );
        assert_eq!(result.demand, 2.);
        assert_eq!(result.capability, 2.);
        assert_eq!(result.burden, 1.2);
    }
    #[test]
    fn exposure_changes_a_support_trend_without_changing_condition() {
        assert_eq!(respond(0.2, 0.8, 0.), 0.2);
        assert!(respond(0.2, 0.8, 0.1) < respond(0.2, 0.8, 1.));
    }
    #[test]
    fn customers_and_livelihoods_are_different_activity_requests() {
        let home = OpportunitySource {
            endpoint: super::super::fabric::Endpoint::External("home".into()),
            id: "home".into(),
            label: "Households".into(),
            position: [0., 0.],
            activity: Activity::Household,
            demand: 12.,
            capability: 0.,
        };
        let shop = OpportunitySource {
            endpoint: super::super::fabric::Endpoint::External("shop".into()),
            id: "shop".into(),
            label: "Trading workplaces".into(),
            position: [0., 0.],
            activity: Activity::Trade,
            demand: 2.,
            capability: 0.,
        };
        let paths = [
            Reachable {
                source: &home,
                cost: 0.,
                competitors: 0.,
            },
            Reachable {
                source: &shop,
                cost: 0.,
                competitors: 0.,
            },
        ];
        let answers = Opportunities::new(&paths, Conditions::default());
        assert_eq!(answers.for_activity(Activity::Household).demand, 2.);
        assert_eq!(answers.for_activity(Activity::Trade).demand, 14.);
        let alternate = OpportunitySource {
            id: home.id.clone(),
            label: "Warehouse".into(),
            ..shop.clone()
        };
        let sources = [home, alternate, shop];
        let sites = frontage_support(
            &sources,
            |_| 0.,
            FrontageRead::Construction,
            &[Conditions::default(); 2],
            |origin, costs| {
                costs.copy_from_slice(&[[0., f64::INFINITY], [0., 0.], [0., 0.]][origin])
            },
        );
        // Equal costs keep the first compatible offer for the ID. A blocked first route
        // allows the second offer, and an incompatible offer never displaces a livelihood.
        assert_eq!(sites[0].for_activity(Activity::Trade).demand, 14.);
        assert_eq!(sites[0].for_activity(Activity::Household).demand, 4.);
        assert_eq!(sites[1].for_activity(Activity::Trade).demand, 4.);
        let mut origins = Vec::new();
        let street = frontage_support(
            &sources,
            |_| 0.,
            FrontageRead::HouseholdDemand,
            &[Conditions::default()],
            |origin, costs| {
                origins.push(origin);
                costs.fill(0.);
            },
        );
        assert_eq!(origins, [1, 2]);
        assert_eq!(street[0].for_activity(Activity::Household).demand, 4.);
    }
}
