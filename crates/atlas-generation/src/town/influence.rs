//! Economic contributions have domain meaning; providers never prescribe wealth or layout.
use super::{
    catalogue::Activity,
    geometry::Point,
    scale::{Measure, TownScale},
};
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
    pub standing: Option<f64>,
    pub housing_demand: f64,
    pub common_demand: f64,
    pub garden_demand: f64,
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
    /// The built ground a resident has here beside a one-storey street household's, as the
    /// City found for this tract: above one where households live spaciously, below one
    /// where they crowd. A standalone town has no City to say.
    #[serde(default)]
    pub spaciousness: Option<f64>,
}
impl Conditions {
    /// The built ground a resident of a one-storey street household has: its plot and its
    /// share of the street over the people its floor houses, in square metres.
    pub const STREET_HOUSEHOLD_GROUND: f64 = 50.;
    /// How much dearer ground is here than under a street household: more than one where
    /// the City found households crowding, one everywhere else.
    pub fn dearness(&self) -> f64 {
        self.spaciousness
            .filter(|room| *room > 0. && *room < 1.)
            .map_or(1., |room| 1. / room)
    }
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
    fn add(
        &mut self,
        source: &'a OpportunitySource,
        cost: f64,
        competitors: f64,
        scale: TownScale,
    ) {
        let reach = pull(cost, scale);
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

/// How strongly a source draws a site at this travel cost: half as much at the half-pull
/// distance as at the door, then fading to nothing at the daily reach, both at `scale`.
pub fn pull(cost: f64, scale: TownScale) -> f64 {
    within_reach(cost, scale)
        / (1. + cost / scale.length(super::settings::HALF_PULL, Measure::Travel))
}
/// The share of a daily journey's draw left at this travel cost: all of it within half the
/// daily reach, none beyond it, and a smooth fade between.
pub fn within_reach(cost: f64, scale: TownScale) -> f64 {
    let reach = scale.length(super::settings::DAILY_REACH, Measure::Travel);
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

/// An undirected street journey costs the same from either door. When few
/// frontages are available, search from each of them to the competing livelihoods.
pub(crate) fn household_demand_from_sites(
    sources: &[OpportunitySource],
    competitors: impl Fn(&OpportunitySource) -> f64,
    reading: Reading<'_>,
    sites: &[usize],
    queries: &mut super::access::DistanceQueries<'_>,
) -> Option<Vec<Opportunities>> {
    let mut offers: Vec<_> = sources
        .iter()
        .enumerate()
        .filter(|(_, s)| s.productive.is_none() && compatible(Activity::Household, s.activity))
        .map(|(origin, s)| (s.id, origin))
        .collect();
    if sites.len() >= offers.len() {
        return None;
    }
    // hpc-exempt: alternate entrances share one demand, with ties resolved in provider order.
    offers.sort_by_key(|offer| offer.0);
    let mut entrances = Vec::new();
    let mut groups = 0;
    for alternatives in offers.chunk_by(|a, b| a.0 == b.0) {
        if alternatives
            .iter()
            .any(|&(_, origin)| sources[origin].demand != 0.)
        {
            entrances.extend(alternatives.iter().map(|&(_, origin)| (origin, groups)));
            groups += 1;
        }
    }
    if sites.len() >= entrances.len() {
        return None;
    }
    let providers = queries.destinations(
        entrances
            .iter()
            .enumerate()
            .map(|(i, &(origin, _))| (origin, i)),
    );
    let weights: Vec<_> = entrances
        .iter()
        .map(|&(origin, _)| {
            let s = &sources[origin];
            s.demand / (1. + competitors(s))
        })
        .collect();
    let reach = reading
        .scale
        .length(super::settings::DAILY_REACH, Measure::Travel);
    let mut nearest = vec![(f64::INFINITY, usize::MAX); groups];
    let mut reached_groups = Vec::new();
    let mut result = Vec::with_capacity(sites.len());
    for (&site, &conditions) in sites.iter().zip(reading.sites) {
        queries.within(site, reach);
        queries.reached(&providers, reach, |offer, cost| {
            let group = entrances[offer].1;
            if nearest[group].1 == usize::MAX {
                reached_groups.push(group);
            }
            if (cost, offer) < nearest[group] {
                nearest[group] = (cost, offer);
            }
        });
        let mut total = Totals::default();
        for group in reached_groups.drain(..) {
            let (cost, offer) = std::mem::replace(&mut nearest[group], (f64::INFINITY, usize::MAX));
            total.demand += weights[offer] * pull(cost, reading.scale);
        }
        let mut opportunities = Opportunities::default();
        opportunities.activities[Activity::Household as usize] = total.finish(conditions);
        result.push(opportunities);
    }
    Some(result)
}
/// `distances(source, visit)` names each site the source reaches and its travel cost;
/// a site it does not name is out of reach. Travel costs are read at the reading's scale.
pub(crate) fn frontage_support(
    sources: &[OpportunitySource],
    competitors: impl Fn(&OpportunitySource) -> f64,
    served: impl Fn(&OpportunitySource) -> f64,
    read: FrontageRead,
    reading: Reading<'_>,
    distances: impl FnMut(usize, &mut dyn FnMut(usize, f64)),
) -> Vec<Opportunities> {
    let scale = reading.scale;
    match read {
        FrontageRead::HouseholdDemand => batch(
            sources,
            (competitors, |_| 0.),
            &[Activity::Household],
            reading,
            distances,
            |total, offer, cost| {
                total.demand += offer.source.demand * pull(cost, scale) / (1. + offer.competitors)
            },
        ),
        FrontageRead::Construction => batch(
            sources,
            (competitors, served),
            &Activity::ALL,
            reading,
            distances,
            |total, offer, cost| total.add(offer.source, cost, offer.competitors, scale),
        ),
    }
}
/// The sites a frontage reading reads and the scale their travel costs are read at.
#[derive(Clone, Copy)]
pub(crate) struct Reading<'s> {
    pub sites: &'s [Conditions],
    pub scale: TownScale,
}
fn batch<'a, const N: usize>(
    sources: &'a [OpportunitySource],
    demand: (
        impl Fn(&OpportunitySource) -> f64,
        impl Fn(&OpportunitySource) -> f64,
    ),
    activities: &[Activity; N],
    reading: Reading<'_>,
    mut distances: impl FnMut(usize, &mut dyn FnMut(usize, f64)),
    accumulate: impl Fn(&mut Totals<'a>, &Offer<'a>, f64),
) -> Vec<Opportunities> {
    let Reading { sites, scale } = reading;
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
        if N == 1 && group.iter().all(|offer| offer.source.demand == 0.) {
            continue;
        }
        // Most offers come from one holding at one entrance. Its one distance
        // per site already identifies the cheapest access to this source.
        if let [offer] = group {
            let serves = activities.map(|activity| compatible(activity, offer.source.activity));
            distances(offer.origin, &mut |site, cost| {
                if cost.is_finite() {
                    for (a, &yes) in serves.iter().enumerate() {
                        if yes {
                            accumulate(&mut totals[site][a], offer, cost);
                        }
                    }
                    if N > 1 {
                        add_custom(offer, cost, &mut audience[site], scale);
                    }
                }
            });
            continue;
        }
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
            collect_custom(group, &reached, &mut audience, scale);
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
    scale: TownScale,
) {
    for paths in reached.chunk_by(|x, y| x.0 == y.0) {
        let Some(&(site, member, cost)) = paths.iter().min_by(|a, b| a.2.total_cmp(&b.2)) else {
            continue;
        };
        add_custom(&group[member], cost, &mut audience[site], scale);
    }
}
fn add_custom(
    offer: &Offer<'_>,
    cost: f64,
    audience: &mut [f64; super::effects::Clientele::ALL.len()],
    scale: TownScale,
) {
    if let Some(clientele) = offer.source.clientele.filter(|_| offer.unserved > 0.) {
        let draw = clientele.draw(1., cost, scale);
        audience[clientele as usize] +=
            offer.unserved * draw / (1. + draw * offer.unserved / offer.source.demand);
    }
}
impl Opportunities {
    /// The support paths give a site, their travel read at street fidelity; see `new_at`.
    pub fn new(paths: &[Reachable<'_>], conditions: Conditions) -> Self {
        Self::new_at(paths, conditions, TownScale::default())
    }
    /// The support paths give a site, their travel read at `scale`.
    pub fn new_at(paths: &[Reachable<'_>], conditions: Conditions, scale: TownScale) -> Self {
        Self {
            activities: std::array::from_fn(|i| {
                support_for(Activity::ALL[i], paths, conditions, scale)
            }),
            ..Default::default()
        }
    }
    pub fn for_activity(&self, activity: Activity) -> &Support {
        &self.activities[activity as usize]
    }
    /// What a district asks for here of an activity. Its demand joins the custom the site
    /// already has, and multiplies that custom by how strongly the town shows its
    /// character (`show`), so a district's role decides what its sites are good for
    /// instead of adding a little to every site alike.
    pub(crate) fn add_local(&mut self, activity: Activity, [demand, cost]: [f64; 2], show: f64) {
        let support = &mut self.activities[activity as usize];
        let demand = demand.max(0.);
        support.demand = support.demand * (1. + show.max(0.) * demand) + demand;
        support.burden = (support.burden + cost).max(0.);
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
pub fn support_for(
    activity: Activity,
    paths: &[Reachable<'_>],
    conditions: Conditions,
    scale: TownScale,
) -> Support {
    support_from(
        paths
            .iter()
            .filter(|p| compatible(activity, p.source.activity)),
        conditions,
        scale,
    )
}

/// All premises in a development round read the same providers. Group their
/// alternative entrances once, then compare only the paths one holding reaches.
pub(crate) struct OperatingSupport<'a> {
    sources: &'a [OpportunitySource],
    group: Vec<usize>,
    nearest: Vec<Option<(usize, f64, f64)>>,
    reached: Vec<usize>,
}

impl<'a> OperatingSupport<'a> {
    pub(crate) fn new(sources: &'a [OpportunitySource]) -> Self {
        let mut order: Vec<_> = (0..sources.len())
            .filter(|&i| sources[i].productive.is_none())
            .collect();
        // hpc-exempt: alternative entrances of the same economic provider share an identity.
        order.sort_unstable_by_key(|&i| sources[i].id);
        let mut group = vec![usize::MAX; sources.len()];
        let mut nearest = Vec::new();
        for alternatives in order.chunk_by(|&a, &b| sources[a].id == sources[b].id) {
            for &i in alternatives {
                group[i] = nearest.len();
            }
            nearest.push(None);
        }
        Self {
            sources,
            group,
            nearest,
            reached: Vec::new(),
        }
    }

    pub(crate) fn offer(&mut self, i: usize, activity: Activity, cost: f64, competitors: f64) {
        let group = self.group[i];
        if group == usize::MAX
            || !cost.is_finite()
            || !compatible(activity, self.sources[i].activity)
        {
            return;
        }
        let current = &mut self.nearest[group];
        if current.is_none() {
            self.reached.push(group);
        }
        if current.is_none_or(|(old, best, _)| (cost, i) < (best, old)) {
            *current = Some((i, cost, competitors));
        }
    }

    pub(crate) fn finish(&mut self, conditions: Conditions, scale: TownScale) -> Support {
        // hpc-exempt: resolve equally strong providers in their stable identity order.
        self.reached.sort_unstable();
        let mut total = Totals::default();
        for group in self.reached.drain(..) {
            if let Some((i, cost, competitors)) = self.nearest[group].take() {
                total.add(&self.sources[i], cost, competitors, scale);
            }
        }
        total.finish(conditions)
    }
}
/// Bind a counterparty for an actual use. Retained custom favours an operating
/// relationship while an unavailable destination gradually loses its strength.
pub fn operating_tie(
    purpose: super::catalogue::Operation,
    paths: &[Reachable<'_>],
    access: super::catalogue::AccessUse,
    old: Option<&super::fabric::OperatingTie>,
    exposure: f64,
    scale: TownScale,
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
            let strength = (p.source.demand + p.source.capability) * pull(p.cost, scale)
                / (1. + p.competitors);
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
pub fn support(paths: &[Reachable<'_>], conditions: Conditions, scale: TownScale) -> Support {
    support_from(paths.iter(), conditions, scale)
}
fn support_from<'a, 'b: 'a>(
    paths: impl Iterator<Item = &'a Reachable<'b>>,
    conditions: Conditions,
    scale: TownScale,
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
        result.add(path.source, path.cost, path.competitors, scale);
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
    fn a_districts_role_multiplies_the_custom_its_sites_already_have() {
        // Two sites with the same custom for making and for trade. One lies in a district
        // of workshops, which asks for making; the other in a district that asks nothing.
        let site = |asked: f64, show: f64| {
            let mut site = Opportunities::default();
            for activity in [Activity::Production, Activity::Trade] {
                site.activities[activity as usize].demand = 24.;
            }
            site.add_local(Activity::Production, [asked, 0.], show);
            site.for_activity(Activity::Production).demand
                / site.for_activity(Activity::Trade).demand
        };
        // Where a town's character counts for one, the district's little is only added.
        assert!((site(2., 0.) - 26. / 24.).abs() < 1e-12);
        // One that shows it makes the workshop district's sites worth several times as
        // much to a maker as to a trader, and leaves the other district's sites alone.
        assert!(site(2., 1.) > 3.);
        assert_eq!(site(0., 1.), 1.);
    }

    /// A reading of these sites at street fidelity.
    fn at_street(sites: &[Conditions]) -> Reading<'_> {
        Reading {
            sites,
            scale: TownScale::default(),
        }
    }

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
                at_street(&[Conditions::default(); 2]),
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
                TownScale::default(),
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
        let scale = TownScale::default();
        let supply = operating_tie(
            Operation::Supply,
            &paths,
            AccessUse::Freight,
            None,
            1.,
            scale,
        )
        .unwrap();
        let care =
            operating_tie(Operation::Service, &paths, AccessUse::Foot, None, 1., scale).unwrap();
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
        assert_eq!(
            support(&paths, Conditions::default(), TownScale::default()).demand,
            4.
        );
        let scale = TownScale::default();
        let alternatives = [source.clone(), source];
        let mut operating = OperatingSupport::new(&alternatives);
        operating.offer(0, Activity::Household, 100., 2.);
        operating.offer(1, Activity::Household, 0., 2.);
        assert_eq!(operating.finish(Conditions::default(), scale).demand, 4.);
        // The next holding has no path to the second entrance.
        operating.offer(0, Activity::Household, 0., 0.);
        assert_eq!(operating.finish(Conditions::default(), scale).demand, 12.);
        assert_eq!(operating.finish(Conditions::default(), scale).demand, 0.);
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
                Conditions::default(),
                TownScale::default()
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
            TownScale::default(),
        );
        assert_eq!(result.demand, 2.);
        assert_eq!(result.capability, 2.);
        assert_eq!(result.burden, 1.2);
    }
    #[test]
    fn a_draw_keeps_its_strength_near_by_and_ends_at_the_daily_reach() {
        let reach = super::super::settings::DAILY_REACH;
        let scale = TownScale::default();
        assert_eq!(pull(0., scale), 1.);
        assert_eq!(pull(180., scale), 0.5);
        assert_eq!(within_reach(reach * 0.5, scale), 1.);
        assert_eq!(within_reach(reach, scale), 0.);
        assert_eq!(pull(f64::INFINITY, scale), 0.);
        let fading: Vec<_> = (0..=10)
            .map(|i| within_reach(reach * (0.5 + 0.05 * f64::from(i)), scale))
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
            at_street(&[Conditions::default(); 2]),
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
            at_street(&[Conditions::default()]),
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
