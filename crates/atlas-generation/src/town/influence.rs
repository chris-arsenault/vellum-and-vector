//! Economic contributions have domain meaning; providers never prescribe wealth or layout.
use super::{catalogue::Activity, geometry::Point};
use crate::execution::QueryValue;
use serde::{Deserialize, Serialize};

/// A source's identity. Alternatives sharing one identity (one holding reached by different
/// paths, one feature's benefit at several entrances) compete for each site as one source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum SourceId {
    /// A town's approach along one of its arms.
    Approach { town: atlas_map::Id, arm: u32 },
    /// One benefit of a feature outside the towns.
    External { feature: atlas_map::Id, benefit: u8 },
    /// One of a holding's kinds: its primary kind first, then its secondary one.
    Holding {
        town: atlas_map::Id,
        holding: u32,
        kind: u32,
    },
    /// A working estate's fields.
    Estate(u32),
    /// A source a process names itself.
    Named(atlas_map::Id),
    Productive {
        town: atlas_map::Id,
        origin: super::production::Origin,
        opportunity: super::production::Opportunity,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OpportunitySource {
    pub endpoint: super::fabric::Endpoint,
    pub id: SourceId,
    pub label: String,
    pub position: Point,
    pub activity: Activity,
    pub demand: f64,
    pub capability: f64,
    pub productive: Option<super::production::Opportunity>,
    pub clientele: Option<super::effects::Clientele>,
}
pub struct Sources(pub Vec<OpportunitySource>);
impl QueryValue for Sources {}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Conditions {
    pub clearance: f64,
    pub bank: bool,
    pub flowing: bool,
    pub practices: crate::field::people::crafts::PracticeReads,
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
    pub rooted: bool,
    pub rural_service: f64,
    pub density: f64,
    pub slope: f64,
    pub flood: f64,
    pub waste: f64,
    pub nuisance: f64,
    pub protection: f64,
    pub building: f64,
    pub travel: f64,
    pub effects: super::effects::Received,
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
#[derive(Default)]
pub struct Opportunities {
    activities: [Support; 7],
    audience: [f64; super::effects::Clientele::ALL.len()],
    pub(crate) production: super::production::Available,
}
impl Opportunities {
    pub fn custom(
        &self,
        attracts: &[super::effects::Contribution<super::effects::Clientele>],
    ) -> f64 {
        attracts
            .iter()
            .map(|offer| self.audience[offer.kind as usize] * offer.strength)
            .sum()
    }
}
/// Paths to a source are alternatives, not duplicate demand. Costs are supplied by access.
pub struct Reachable<'a> {
    pub source: &'a OpportunitySource,
    pub cost: f64,
    pub competitors: f64,
}
#[derive(Clone, Copy, Default)]
struct Totals<'a> {
    demand: f64,
    capability: f64,
    strongest: f64,
    label: Option<&'a str>,
}
impl<'a> Totals<'a> {
    fn add(&mut self, source: &'a OpportunitySource, cost: f64, competitors: f64) {
        let reach = pull(cost);
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

/// How strongly a source draws a site at this travel cost: half as much at 180 m as at the
/// door, then fading to nothing at the daily reach.
pub fn pull(cost: f64) -> f64 {
    within_reach(cost) / (1. + cost / 180.)
}
/// The share of a daily journey's draw left at this travel cost: all of it within half the
/// daily reach, none beyond it, and a smooth fade between.
pub fn within_reach(cost: f64) -> f64 {
    let reach = super::settings::DAILY_REACH;
    let fade = ((cost / reach - 0.5) * 2.).clamp(0., 1.);
    1. - fade * fade * (3. - 2. * fade)
}
struct Offer<'a> {
    origin: usize,
    source: &'a OpportunitySource,
    competitors: f64,
    unserved: f64,
}
/// Read one source's distances across sites at a time. Alternatives with the same identity
/// compete for each compatible activity, with equal-cost paths retaining provider order.
pub(crate) enum FrontageRead {
    HouseholdDemand,
    Construction,
}
/// `distances(source, visit)` names each site the source reaches and its travel cost;
/// a site it does not name is out of reach.
pub(crate) fn frontage_support(
    sources: &[OpportunitySource],
    competitors: impl Fn(&OpportunitySource) -> f64,
    served: impl Fn(&OpportunitySource) -> f64,
    read: FrontageRead,
    sites: &[Conditions],
    distances: impl FnMut(usize, &mut dyn FnMut(usize, f64)),
) -> Vec<Opportunities> {
    match read {
        FrontageRead::HouseholdDemand => batch(
            sources,
            (competitors, |_| 0.),
            &[Activity::Household],
            sites,
            distances,
            |total, offer, cost| {
                total.demand += offer.source.demand * pull(cost) / (1. + offer.competitors)
            },
        ),
        FrontageRead::Construction => batch(
            sources,
            (competitors, served),
            &Activity::ALL,
            sites,
            distances,
            |total, offer, cost| total.add(offer.source, cost, offer.competitors),
        ),
    }
}
fn batch<'a, const N: usize>(
    sources: &'a [OpportunitySource],
    demand: (
        impl Fn(&OpportunitySource) -> f64,
        impl Fn(&OpportunitySource) -> f64,
    ),
    activities: &[Activity; N],
    sites: &[Conditions],
    mut distances: impl FnMut(usize, &mut dyn FnMut(usize, f64)),
    accumulate: impl Fn(&mut Totals<'a>, &Offer<'a>, f64),
) -> Vec<Opportunities> {
    let mut order: Vec<_> = sources
        .iter()
        .enumerate()
        .filter(|(_, s)| {
            s.productive.is_none() && activities.iter().any(|&a| compatible(a, s.activity))
        })
        .map(|(origin, source)| Offer {
            origin,
            source,
            competitors: demand.0(source),
            unserved: (source.demand - demand.1(source)).max(0.),
        })
        .collect();
    // hpc-exempt: group retained counterparty identities in stable provider order.
    order.sort_by_key(|offer| offer.source.id);
    let mut totals = vec![[Totals::default(); N]; sites.len()];
    let mut audience = vec![[0.; super::effects::Clientele::ALL.len()]; sites.len()];
    // (site, offer within its identity's group, travel cost) for each site a group reaches.
    let mut reached: Vec<(usize, usize, f64)> = Vec::new();
    for group in order.chunk_by(|a, b| a.source.id == b.source.id) {
        reached.clear();
        for (member, offer) in group.iter().enumerate() {
            distances(offer.origin, &mut |site, cost| {
                if cost.is_finite() {
                    reached.push((site, member, cost));
                }
            });
        }
        // hpc-exempt: one identity's alternative paths meet per site; ties keep provider order.
        reached.sort_unstable_by_key(|&(site, member, _)| (site, member));
        if N > 1 {
            collect_custom(group, &reached, &mut audience);
        }
        for (a, &activity) in activities.iter().enumerate() {
            for paths in reached.chunk_by(|x, y| x.0 == y.0) {
                let cheapest = paths
                    .iter()
                    .filter(|&&(_, member, _)| compatible(activity, group[member].source.activity))
                    .min_by(|x, y| x.2.total_cmp(&y.2));
                if let Some(&(site, member, cost)) = cheapest {
                    accumulate(&mut totals[site][a], &group[member], cost);
                }
            }
        }
    }
    totals
        .into_iter()
        .zip(sites)
        .zip(audience)
        .map(|((t, &cond), audience)| {
            let mut answers = Opportunities {
                audience,
                ..Default::default()
            };
            for (&activity, total) in activities.iter().zip(t) {
                answers.activities[activity as usize] = total.finish(cond);
            }
            answers
        })
        .collect()
}
fn collect_custom(
    group: &[Offer<'_>],
    reached: &[(usize, usize, f64)],
    audience: &mut [[f64; super::effects::Clientele::ALL.len()]],
) {
    for paths in reached.chunk_by(|x, y| x.0 == y.0) {
        let Some(&(site, member, cost)) = paths.iter().min_by(|a, b| a.2.total_cmp(&b.2)) else {
            continue;
        };
        let offer = &group[member];
        let Some(clientele) = offer.source.clientele.filter(|_| offer.unserved > 0.) else {
            continue;
        };
        let draw = clientele.draw(1., cost);
        audience[site][clientele as usize] +=
            offer.unserved * draw / (1. + draw * offer.unserved / offer.source.demand);
    }
}
impl Opportunities {
    pub fn new(paths: &[Reachable<'_>], conditions: Conditions) -> Self {
        Self {
            activities: std::array::from_fn(|i| support_for(Activity::ALL[i], paths, conditions)),
            ..Default::default()
        }
    }
    pub fn for_activity(&self, activity: Activity) -> &Support {
        &self.activities[activity as usize]
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
        .filter(|p| {
            p.source.productive.is_none()
                && p.cost.is_finite()
                && purpose.offered_by(p.source.activity)
        })
        .map(|p| {
            let strength =
                (p.source.demand + p.source.capability) * pull(p.cost) / (1. + p.competitors);
            let custom = old
                .filter(|t| t.destination == p.source.endpoint)
                .map_or(0., |t| t.strength);
            (p, strength, strength * (1. + custom / (1. + custom)))
        })
        .filter(|(_, s, _)| *s > 0.);
    if let Some((path, desired, _)) = offers.max_by(|a, b| a.2.total_cmp(&b.2)) {
        return Some(OperatingTie {
            productive: None,
            clientele: None,
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
    let mut seen = std::collections::BTreeMap::<SourceId, &Reachable<'_>>::new();
    for path in paths.filter(|p| p.source.productive.is_none() && p.cost.is_finite()) {
        seen.entry(path.source.id)
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
    fn a_new_place_reads_reachable_country_custom_after_incumbents_have_drawn_on_it() {
        use crate::town::effects::{Clientele, Contribution};
        let id = atlas_map::Id::from_name("market visitors");
        let group = OpportunitySource {
            endpoint: super::super::fabric::Endpoint::External(id),
            id: SourceId::Named(id),
            label: "Country visitors".into(),
            position: [0., 0.],
            activity: Activity::Agriculture,
            demand: 20.,
            capability: 0.,
            productive: None,
            clientele: Some(Clientele::Countryfolk),
        };
        let attraction = [Contribution::new(Clientele::Countryfolk, 1.)];
        let read = |already_served| {
            frontage_support(
                std::slice::from_ref(&group),
                |_| 0.,
                |_| already_served,
                FrontageRead::Construction,
                &[Conditions::default(); 2],
                |_, visit| {
                    visit(0, 30.);
                    visit(1, f64::INFINITY);
                },
            )
        };
        let open = read(0.);
        let competing = read(12.);
        assert!(competing[0].custom(&attraction) > 0.);
        assert!(competing[0].custom(&attraction) < open[0].custom(&attraction));
        assert_eq!(competing[1].custom(&attraction), 0.);
        assert_eq!(competing[0].for_activity(Activity::Trade).demand, 0.);
    }
    fn named(name: &str) -> SourceId {
        SourceId::Named(atlas_map::Id::from_name(name))
    }
    #[test]
    fn lost_access_redirects_operating_work_to_a_reachable_counterparty() {
        use super::super::{catalogue::AccessUse, fabric::Endpoint};
        let first = OpportunitySource {
            productive: None,
            clientele: None,
            endpoint: Endpoint::External(atlas_map::Id::from_name("port")),
            id: named("port"),
            label: "Port".into(),
            position: [0., 0.],
            activity: Activity::Trade,
            demand: 8.,
            capability: 0.,
        };
        let other = OpportunitySource {
            productive: None,
            clientele: None,
            endpoint: Endpoint::Field(7),
            id: named("fields"),
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
            productive: None,
            clientele: None,
            endpoint: Endpoint::Field(8),
            id: named("estate"),
            position: [0., 0.],
            label: "fields".into(),
            activity: Activity::Agriculture,
            demand: 8.,
            capability: 0.,
        };
        let healer = OpportunitySource {
            productive: None,
            clientele: None,
            endpoint: Endpoint::External(atlas_map::Id::from_name("physic")),
            id: named("healer"),
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
            productive: None,
            clientele: None,
            endpoint: super::super::fabric::Endpoint::External(atlas_map::Id::from_name(
                "pilgrims",
            )),
            id: named("pilgrims"),
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
            productive: None,
            clientele: None,
            endpoint: super::super::fabric::Endpoint::External(atlas_map::Id::from_name("road")),
            id: named("road"),
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
    fn a_draw_keeps_its_strength_near_by_and_ends_at_the_daily_reach() {
        let reach = super::super::settings::DAILY_REACH;
        assert_eq!(pull(0.), 1.);
        assert_eq!(pull(180.), 0.5);
        assert_eq!(within_reach(reach * 0.5), 1.);
        assert_eq!(within_reach(reach), 0.);
        assert_eq!(pull(f64::INFINITY), 0.);
        let fading: Vec<_> = (0..=10)
            .map(|i| within_reach(reach * (0.5 + 0.05 * f64::from(i))))
            .collect();
        assert!(fading.windows(2).all(|pair| pair[1] < pair[0]));
    }
    #[test]
    fn exposure_changes_a_support_trend_without_changing_condition() {
        assert_eq!(respond(0.2, 0.8, 0.), 0.2);
        assert!(respond(0.2, 0.8, 0.1) < respond(0.2, 0.8, 1.));
    }
    #[test]
    fn customers_and_livelihoods_are_different_activity_requests() {
        let home = OpportunitySource {
            productive: None,
            clientele: None,
            endpoint: super::super::fabric::Endpoint::External(atlas_map::Id::from_name("home")),
            id: named("home"),
            label: "Households".into(),
            position: [0., 0.],
            activity: Activity::Household,
            demand: 12.,
            capability: 0.,
        };
        let shop = OpportunitySource {
            productive: None,
            clientele: None,
            endpoint: super::super::fabric::Endpoint::External(atlas_map::Id::from_name("shop")),
            id: named("shop"),
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
            productive: None,
            clientele: None,
            id: home.id,
            label: "Warehouse".into(),
            ..shop.clone()
        };
        let sources = [home, alternate, shop];
        let sites = frontage_support(
            &sources,
            |_| 0.,
            |_| 0.,
            FrontageRead::Construction,
            &[Conditions::default(); 2],
            |origin, visit| {
                for (site, &cost) in [[0., f64::INFINITY], [0., 0.], [0., 0.]][origin]
                    .iter()
                    .enumerate()
                {
                    visit(site, cost);
                }
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
            |_| 0.,
            FrontageRead::HouseholdDemand,
            &[Conditions::default()],
            |origin, visit| {
                origins.push(origin);
                visit(0, 0.);
            },
        );
        // Sources are visited grouped by identity; which group comes first is not meaningful.
        origins.sort_unstable();
        assert_eq!(origins, [1, 2]);
        assert_eq!(street[0].for_activity(Activity::Household).demand, 4.);
    }
}
