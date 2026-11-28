//! Purposeful interventions compete over frontage; later occupation can change their fate.
use super::economy::{FloorSpace, UnmetDemand};
use super::Frontage;
use crate::chance::{order as weighted_order, Chance};
use crate::town::catalogue::PlaceRules;
use crate::town::{
    catalogue::{
        development::{household, housing_offers, HousingOffer, HousingSite},
        Activity, Kind, PLACES,
    },
    fabric::{EditOutcome, FabricEdit, FabricOwner, Proposal, Relationship, Specification, Town},
    geometry::rectangle,
    ground::{Rectangle, PLOT},
    influence::{Conditions, Support},
};
use std::io;
type PurposeSite = (crate::town::fabric::Anchor, Relationship);
struct FittedProject {
    purpose: PurposeSite,
    plot: crate::town::plots::Slot,
    initial_holdings: usize,
}
struct Demand {
    space: UnmetDemand,
    families: [f64; PLACES.len()],
    /// The same supply counted street by street, by street number.
    on_streets: Vec<[f64; PLACES.len()]>,
    housing: Vec<(Kind, HousingOffer)>,
}
/// What a set of holdings supplies of each family of premises: its occupied share, and a
/// little for standing at all.
fn supply<'a>(
    holdings: impl Iterator<Item = &'a crate::town::fabric::Holding> + Clone,
) -> [f64; PLACES.len()] {
    PLACES.map(|kind| {
        holdings
            .clone()
            .filter(|h| {
                kind.same_family(h.kind) || h.secondary.is_some_and(|k| kind.same_family(k))
            })
            .map(|h| h.occupation + 0.25)
            .sum::<f64>()
    })
}
enum Offer<'a> {
    Premises(PremisesBid<'a>),
    Partners {
        existing: Vec<FabricEdit>,
        additions: Vec<(Kind, FabricEdit)>,
    },
}
struct PremisesBid<'a> {
    candidate: &'a super::Candidate,
    sample: f64,
    kind: Kind,
    project: Option<Box<FittedProject>>,
}
pub fn advance(town: &mut Town, context: &mut Frontage<'_>) -> io::Result<()> {
    let trace = std::env::var("ATLAS_TRACE_TOWN").is_ok_and(|name| name == town.seat.name);
    // owner-direction(2026-11-17): human-layer density is an approximate census, not a placement obligation; artistic composition takes priority over numerical accuracy.
    // A share of residents contributes labour to premises during each development pass.
    town.effort += (town.seat.story.people.max(0.) * context.exposure * 0.018)
        * (1.
            + town
                .holdings()
                .iter()
                .map(|h| h.means * h.occupation)
                .sum::<f64>()
                / (1. + town.holdings().len() as f64));
    let log = |event: &str, town: &Town, details: &dyn Fn() -> serde_json::Value| {
        if trace {
            eprintln!(
                "{}",
                serde_json::json!({
                    "event":event, "town":town.seat.name, "round":town.round+1, "decision":details()
                })
            );
        }
    };
    log("town.construction-start", town, &|| {
        serde_json::json!({
            "candidates": context.candidates.len(), "holdings": town.holdings().len(),
            "effort": town.effort
        })
    });
    reberth(town, context)?;
    crate::town::major_works::advance(town, context)?;
    let needs = unmet(town, context.spatial)?;
    let initial_holdings = town.holdings().len();
    let mut space = FloorSpace::default();
    for holding in town.holdings() {
        space.add(FloorSpace::holding(holding, context.spatial)?);
    }
    // The regard each open site is held in this round, which each site's own is ranked
    // among.
    town.regards = context
        .candidates
        .iter()
        .map(|c| c.conditions.regard())
        .collect();
    // hpc-exempt: one town's open sites, ranked once a round.
    town.regards.sort_by(f64::total_cmp);
    let supplied = supply(town.holdings().iter());
    // What each street already holds of each family, so like can draw like.
    let mut on_streets = vec![[0.; PLACES.len()]; town.streets().len()];
    for holding in town.holdings() {
        let street = holding.slot.street.and_then(|s| on_streets.get_mut(s));
        if let Some(street) = street {
            let own = supply(std::iter::once(holding));
            for (held, more) in street.iter_mut().zip(own) {
                *held += more;
            }
        }
    }
    let demand = Demand {
        space: space.need(town.seat.story.people),
        families: supplied,
        on_streets,
        housing: housing_offers(),
    };
    let scale = town.scale();
    let frontage = crate::town::plots::OccupiedFronts::new(town);
    let mut ranked: Vec<_> = context
        .candidates
        .iter()
        .filter(|candidate| {
            candidate.slot.participant.is_none()
                && candidate.slot.tenure != crate::town::templates::Tenure::Institutional
        })
        .filter_map(|candidate| {
            let sample = Chance::of(town.round as i32, 0).unit(candidate.slot.front);
            let public_draw = Chance::of(town.round as i32, 0x1257).unit(candidate.slot.front);
            let project = needs
                .iter()
                .filter(|(kind, _, _, site, relation)| {
                    eligible(*kind, candidate.conditions, candidate.slot.street)
                        && relation.admits_frontage(
                            *site,
                            town,
                            candidate.slot.front,
                            scale.range(kind.definition().depth).sample(1. - sample),
                        )
                })
                .max_by(|a, b| {
                    project_pull(a, candidate.slot.front, scale).total_cmp(&project_pull(
                        b,
                        candidate.slot.front,
                        scale,
                    ))
                })
                .filter(|need| {
                    let pull = project_pull(need, candidate.slot.front, scale);
                    // A proposed public investment can only displace other uses of
                    // this land if its own premises fit the ground offered here.
                    public_draw * (1. + pull) < pull
                })
                .and_then(|need| {
                    // A commissioned work keeps its own size whatever plots the town offers.
                    fitted_slot(
                        candidate,
                        need.0.definition(),
                        sample,
                        context.ground,
                        (scale, [1., 1.]),
                    )
                    .map(|slot| (need, slot))
                });
            let kind = project
                .as_ref()
                .map(|(p, _)| p.0)
                .or_else(|| choose(town, candidate, sample, &demand, &[], context.spatial))?;
            let support = candidate
                .opportunities
                .for_activity(kind.definition().activity);
            let fit = location(town, candidate).attraction(kind.definition());
            let production = candidate
                .opportunities
                .production
                .support(kind.definition().roles.production.needs);
            let score = frontage_priority(support, candidate.conditions, fit, sample)
                + production
                + project
                    .as_ref()
                    .map_or(0., |(p, _)| project_pull(p, candidate.slot.front, scale));
            let affinity = site_affinity(town, candidate, kind);
            let row = if kind.definition().roles.dwelling {
                frontage.infill(&candidate.slot)
            } else {
                1.
            };
            let order = weighted_order(score * affinity * row, site_draw(town, candidate, 0x47cc));
            Some((
                order,
                Offer::Premises(PremisesBid {
                    candidate,
                    sample,
                    kind,
                    project: project.map(|(p, plot)| {
                        Box::new(FittedProject {
                            purpose: (p.3, p.4),
                            plot,
                            initial_holdings,
                        })
                    }),
                }),
            ))
        })
        .collect();
    ranked.extend(participant_offers(town, context, &demand)?);
    // hpc-exempt: ranks exact geometric development proposals, not numerical lattice cells.
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut pledges = super::investment::Pledges::default();
    // Building labour is reckoned per premises: a holding standing for many premises takes
    // the labour of them all.
    for (order, offer) in ranked {
        if town.effort < scale.premises() || order == 0. {
            break;
        }
        let before = town.holdings().len();
        match offer {
            Offer::Premises(bid) => {
                let (candidate, kind) = (bid.candidate, bid.kind);
                if bid.project.is_none() && !space.need(town.seat.story.people).supports(kind) {
                    continue;
                }
                let result = develop_site(town, context, bid, &mut pledges)?;
                log("town.construction-decision", town, &|| {
                    serde_json::json!({
                        "at": candidate.slot.front, "place": kind.definition().label,
                        "building": candidate.conditions.building, "slope": candidate.conditions.slope,
                        "result": result
                    })
                });
            }
            Offer::Partners {
                mut existing,
                additions,
            } => {
                let budget = (town.effort / (2. * scale.premises())).floor() as usize;
                let remaining = space.need(town.seat.story.people);
                existing.extend(
                    additions
                        .into_iter()
                        .filter(|(kind, _)| remaining.supports(*kind))
                        .take(budget)
                        .map(|(_, edit)| edit),
                );
                commit_participants(town, context, existing)?;
            }
        }
        for holding in &town.holdings()[before..] {
            space.add(FloorSpace::holding(holding, context.spatial)?);
        }
    }
    Ok(())
}
fn develop_site(
    town: &mut Town,
    context: &mut Frontage<'_>,
    bid: PremisesBid<'_>,
    pledges: &mut super::investment::Pledges,
) -> io::Result<&'static str> {
    let PremisesBid {
        candidate,
        sample,
        kind,
        project,
    } = bid;
    if let Some(p) = &project {
        let (site, relation) = p.purpose;
        if relation.served_since(site, p.initial_holdings, town, context.spatial)? {
            return Ok("satisfied");
        }
    }
    let project = project.map(|p| (p.purpose, p.plot));
    let financed = project.is_some();
    let definition = kind.definition();
    let means = resources(town, candidate);
    let edit = match proposal(town, candidate, kind, sample, project, context) {
        Ok(edit) => edit,
        Err(reason) => return Ok(reason),
    };
    let Some(edit) = (if financed {
        pledges.finance(town, edit)
    } else {
        Some(edit)
    }) else {
        return Ok("finance");
    };
    let EditOutcome::Premises(id) = town.apply(edit, context.spatial)? else {
        return Ok("fabric");
    };
    if financed {
        pledges.paid(town, id);
    }
    context.ground.mark_shapes(
        std::slice::from_ref(&town.holdings()[id.0 as usize].outline),
        PLOT,
        context.spatial,
    )?;
    town.effort -= (1. + definition.prominence) * (1. + means) * town.scale().premises();
    Ok("built")
}
fn participant_offers<'a>(
    town: &Town,
    context: &Frontage<'a>,
    demand: &Demand,
) -> io::Result<Vec<(f64, Offer<'a>)>> {
    let mut offers = Vec::new();
    let mut groups = vec![Vec::new(); town.holdings().len()];
    let widest_frontage = town
        .holdings()
        .iter()
        .map(|h| h.slot.frontage)
        .fold(0., f64::max);
    for candidate in context.candidates {
        if let Some(id) = candidate.slot.participant {
            groups[id.0 as usize].push(candidate);
        }
    }
    for (index, candidates) in groups
        .into_iter()
        .enumerate()
        .filter(|(_, sites)| !sites.is_empty())
    {
        let host = &town.holdings()[index];
        let activities = host.kind.definition().roles.frontage_activities;
        let partner = host.id;
        if activities.is_empty() || host.condition <= 0.2 {
            continue;
        }
        let existing = existing_partners(town, host, activities, widest_frontage, context.spatial)?;
        let mut choices = Vec::new();
        for candidate in candidates {
            let sample = Chance::of(town.round as i32, 0).unit(candidate.slot.front);
            let Some(kind) = choose(town, candidate, sample, demand, activities, context.spatial)
            else {
                continue;
            };
            let support = candidate
                .opportunities
                .for_activity(kind.definition().activity);
            let production = candidate
                .opportunities
                .production
                .support(kind.definition().roles.production.needs);
            let score = production
                + frontage_priority(
                    support,
                    candidate.conditions,
                    location(town, candidate).attraction(kind.definition()),
                    sample,
                );
            if let Ok(edit) = proposal(town, candidate, kind, sample, None, context) {
                choices.push((
                    weighted_order(score, site_draw(town, candidate, 0x47cc)),
                    kind,
                    edit,
                ));
            }
        }
        // hpc-exempt: ranks exact premises attached to a shared physical participant.
        choices.sort_by(|a, b| b.0.total_cmp(&a.0));
        let order = choices.first().map_or(host.occupation, |choice| choice.0);
        let additions = choices
            .into_iter()
            .map(|(_, kind, placement)| {
                (
                    kind,
                    FabricEdit::Optional(Box::new(FabricEdit::Join {
                        partner,
                        placement: Box::new(placement),
                    })),
                )
            })
            .collect();
        offers.push((
            order,
            Offer::Partners {
                existing,
                additions,
            },
        ));
    }
    Ok(offers)
}
fn reberth(town: &mut Town, context: &Frontage<'_>) -> io::Result<()> {
    use crate::town::templates::Habitat;
    if !town
        .founding_sites
        .iter()
        .any(|&(_, id)| town.holdings()[id.0 as usize].slot.habitat == Habitat::Floating)
    {
        return Ok(());
    }
    let mut available = town
        .holdings()
        .iter()
        .filter(|h| {
            h.slot.habitat == Habitat::Floating
                && h.occupation < 0.2
                && h.condition > 0.4
                && h.ties.is_empty()
        })
        .map(|h| h.id)
        .collect::<Vec<_>>();
    if available.is_empty() {
        return Ok(());
    }
    for c in context.candidates {
        let Some(&id) = available.last() else {
            break;
        };
        let h = &town.holdings()[id.0 as usize];
        let need = c.opportunities.for_activity(h.kind.definition().activity);
        if c.conditions.bank
            && need.capability + need.demand > h.support
            && town.berth(id, &c.slot, context.ground, context.spatial)?
        {
            available.pop();
        }
    }
    Ok(())
}
fn site_draw(town: &Town, candidate: &super::Candidate, salt: i32) -> f64 {
    Chance::of(town.round as i32, salt).unit(candidate.slot.front)
}
fn location(town: &Town, candidate: &super::Candidate) -> crate::town::siting::Location {
    let slot = &candidate.slot;
    let street = slot.street.map(|id| &town.streets()[id]);
    let wear = street.map_or(0., |_| town.frontage_wear(slot));
    crate::town::siting::Location::at(candidate.conditions, street, slot.along, wear, town.scale())
}
fn commit_participants(
    town: &mut Town,
    context: &mut Frontage<'_>,
    members: Vec<FabricEdit>,
) -> io::Result<()> {
    if members.is_empty() {
        return Ok(());
    }
    let previous = town.holdings().len();
    if let EditOutcome::Project(_) = town.apply(FabricEdit::Project(members), context.spatial)? {
        for h in &town.holdings()[previous..] {
            context
                .ground
                .mark_shapes(std::slice::from_ref(&h.outline), PLOT, context.spatial)?;
        }
        town.effort -= 2. * (town.holdings().len() - previous) as f64 * town.scale().premises();
    }
    Ok(())
}
fn existing_partners(
    town: &Town,
    host: &crate::town::fabric::Holding,
    activities: &[Activity],
    widest: f64,
    spatial: &dyn crate::spatial::SpatialKernel,
) -> io::Result<Vec<FabricEdit>> {
    let mut members = Vec::new();
    let atlas_map::Bounds(w, s, e, n) = spatial.bounds(&host.outline).map_err(io::Error::other)?;
    let nearby = town.nearby_holdings(
        atlas_map::Bounds(w - widest, s - widest, e + widest, n + widest),
        spatial,
    )?;
    for h in nearby.into_iter().map(|i| &town.holdings()[i]).filter(|h| {
        h.id != host.id
            && !h.ties.iter().any(|tie|matches!(&tie.destination,crate::town::fabric::Endpoint::Premises{town:key,holding} if key==&town.seat.key && *holding==host.id))
            && h.condition > 0.35
            && activities.contains(&h.kind.definition().activity)
    }) {
        if spatial
            .distance(&h.outline, &host.outline)
            .map_err(io::Error::other)?
            <= h.slot.frontage
        {
            members.push(FabricEdit::Bind {
                premises: h.id,
                partner: host.id,
            });
        }
    }
    Ok(members)
}
fn proposal(
    town: &Town,
    candidate: &super::Candidate,
    kind: Kind,
    sample: f64,
    project: Option<(PurposeSite, crate::town::plots::Slot)>,
    context: &Frontage<'_>,
) -> Result<FabricEdit, &'static str> {
    let (purpose, fitted) = project.unzip();
    let definition = kind.definition();
    let front = candidate.slot.front;
    let building = Chance::of(0, 0x233a).unit([front[0], front[1]]);
    if !kind.open() && building > candidate.conditions.building {
        return Err("building policy");
    }
    if site_affinity(town, candidate, kind) <= 0. {
        return Err("reserved land");
    }
    let scale = town.scale();
    let offer = town.order.plot_offer();
    let mut slot = fitted
        .or_else(|| {
            fitted_slot(
                candidate,
                definition,
                sample,
                context.ground,
                (scale, offer),
            )
        })
        .ok_or("parcel terrain")?;
    slot.tenure = town
        .template
        .tenure(definition.activity, slot.front, charter_unit(town));
    let means = resources(town, candidate);
    let outdoor = kind.open();
    let buildings = crate::town::roofs::components_at(&slot, kind, means, sample, scale);
    Ok(FabricEdit::Establish {
        conditions: candidate.conditions,
        purpose,
        buildings,
        outdoor,
        proposal: Proposal {
            slot,
            kind,
            means,
            priority: 1. + means + definition.prominence,
            cause: format!(
                "{} supports {} here",
                candidate
                    .opportunities
                    .for_activity(definition.activity)
                    .source
                    .as_deref()
                    .unwrap_or("Local occupation"),
                definition.label
            ),
        },
    })
}
type Need = (
    Kind,
    crate::town::geometry::Point,
    f64,
    crate::town::fabric::Anchor,
    Relationship,
);
fn unmet(town: &Town, spatial: &dyn crate::spatial::SpatialKernel) -> io::Result<Vec<Need>> {
    let mut needs = Vec::new();
    for purpose in town.purposes() {
        for relation in &purpose.relationships {
            if purpose.investment >= 0.5
                && !matches!(relation, Relationship::Access { .. })
                && !relation.satisfied(purpose.site, town, spatial)?
            {
                needs.push((
                    relation.use_kind(),
                    town.position(purpose.site),
                    purpose.investment,
                    purpose.site,
                    *relation,
                ));
            }
        }
    }
    Ok(needs)
}
/// The distance from a project's site at which it draws half as strongly. Street metres,
/// resolved by `Measure::Adjacency`.
const PROJECT_PULL: f64 = 80.;
fn project_pull(
    project: &Need,
    point: crate::town::geometry::Point,
    scale: crate::town::scale::TownScale,
) -> f64 {
    let half = scale.length(PROJECT_PULL, crate::town::scale::Measure::Adjacency);
    project.2 / (1. + crate::town::geometry::distance(project.1, point) / half)
}
fn frontage_priority(support: &Support, land: Conditions, fit: f64, sample: f64) -> f64 {
    let neighbours = land.households + land.workshops + land.institutions + land.density;
    support.demand / (1. + support.demand) / (1. + land.flood + land.waste)
        + land.exchange / (1. + land.exchange) * 0.25
        + land.presence.max(0.).ln_1p() * 0.02
        + neighbours / (1. + neighbours)
        + fit.ln_1p()
        + sample * 0.2
}
/// The plot a kind of premises takes: a size from its own range by chance, larger or
/// smaller as the town's plots stand beside an ordinary town's, and never under the least
/// the kind can work on.
fn plot_taken(
    [frontage, depth]: [crate::town::catalogue::MetresRange; 2],
    sample: f64,
    [wide, deep]: [f64; 2],
) -> (f64, f64) {
    (
        (frontage.sample(sample) * wide).max(frontage.low),
        (depth.sample(1. - sample) * deep).max(depth.low),
    )
}
fn fitted_slot(
    candidate: &super::Candidate,
    definition: crate::town::catalogue::Definition,
    sample: f64,
    ground: &crate::town::ground::Ground,
    (scale, offer): (crate::town::scale::TownScale, [f64; 2]),
) -> Option<crate::town::plots::Slot> {
    use crate::town::{
        geometry::left,
        ground::{FIRST_STREET, FREE},
    };
    let (frontage, depth) = (
        scale.range(definition.frontage),
        scale.range(definition.depth),
    );
    let mut slot = candidate.slot.clone();
    let attached = slot.street.is_some() || slot.participant.is_some();
    // A place inside another's court takes the room its host has, not the town's plots.
    let offer = if slot.participant.is_some() {
        [1., 1.]
    } else {
        offer
    };
    let (mut width, deep) = plot_taken([frontage, depth], sample, offer);
    if attached {
        width = width.min(slot.frontage.max(frontage.low));
    }
    let desired = (width, deep);
    let smallest = (frontage.low, depth.low);
    // Independent plots can face any side of the same entrance. On a street
    // or an existing court its frontage fixes its orientation.
    for (w, d) in [desired, smallest] {
        for _ in 0..if attached { 1 } else { 4 } {
            slot.frontage = w;
            slot.depth = d;
            slot.corners = rectangle(slot.front, slot.direction, slot.inward, w, d);
            if ground.open_with(&Rectangle(&slot.corners), |mark| {
                slot.habitat
                    .fits(mark, |m| m == FREE || m == PLOT || m >= FIRST_STREET)
            }) {
                return Some(slot);
            }
            slot.direction = left(slot.direction);
            slot.inward = left(slot.inward);
        }
        // The next footprint starts in the original frame.
        slot.direction = candidate.slot.direction;
        slot.inward = candidate.slot.inward;
    }
    None
}
pub(super) use crate::town::siting::feasible as eligible;
fn charter_unit(town: &Town) -> f64 {
    town.plot().1
}
fn site_affinity(town: &Town, candidate: &super::Candidate, kind: Kind) -> f64 {
    town.template.affinity(
        kind.definition().activity,
        candidate.slot.front,
        charter_unit(town),
    )
}
/// The means of the household a site would hold: the lot it is born to beside what its
/// work brings in. The town's order says how far apart lots lie, how much birth counts,
/// and what share of households settle by the regard their site is held in among the
/// town's open sites instead of where chance brings them.
fn resources(town: &Town, candidate: &super::Candidate) -> f64 {
    let support = candidate.opportunities.for_activity(Activity::Household);
    let income = (support.demand + support.capability) / (1. + support.burden);
    let [x, y] = candidate.slot.front;
    let draw = |salt| Chance::of(0, salt).unit([x, y]);
    let local = candidate.conditions;
    let rank = crate::town::order::rank_among(&town.regards, local.regard(), draw(0x1e55));
    let lot = town.order.settled_draw([draw(0x4312), draw(0x0dd5)], rank);
    let patronage = local.patronage + local.effects.prestige;
    let costs = 1. + local.density + local.nuisance + local.waste;
    let working_income = income / (2. + income) / costs;
    town.order.means(lot, patronage, working_income)
}
/// A site as the businesses that might take it see it.
struct Siting<'a> {
    town: &'a Town,
    candidate: &'a super::Candidate,
    demand: &'a Demand,
    activities: &'a [Activity],
    influence: crate::town::siting::PlacementInfluence,
    location: crate::town::siting::Location,
    means: f64,
}
impl Siting<'_> {
    /// The weight a kind of business bids for the site with, or why it makes no bid.
    fn business(&self, i: usize, kind: Kind) -> Result<Bid, &'static str> {
        use crate::town::effects::{Placement, Requirement};
        let (candidate, demand) = (self.candidate, self.demand);
        let definition = kind.definition();
        let target = Placement::Premises(kind);
        if kind.open() || definition.roles.household {
            return Err("not a business");
        }
        if demand.space.working <= 0. {
            return Err("the town has the working floor it needs");
        }
        if !eligible(kind, candidate.conditions, candidate.slot.street) {
            return Err("the site does not suit it");
        }
        if !self.influence.permitted(target) {
            return Err("its neighbours do not permit it");
        }
        if !self.activities.is_empty() && !self.activities.contains(&definition.activity) {
            return Err("another activity is wanted here");
        }
        let support = candidate.opportunities.for_activity(definition.activity);
        let custom = if definition.roles.effects.attracts.is_empty() {
            support.demand
        } else {
            candidate
                .opportunities
                .custom(definition.roles.effects.attracts)
        };
        let productive = candidate
            .opportunities
            .production
            .support(definition.roles.production.needs);
        let audience =
            (custom + support.capability + productive) / (1. + definition.demand + support.burden);
        let required = self.influence.requirement(
            target,
            Requirement::Support,
            definition.roles.effects.minimum_support,
        );
        if audience < required {
            return Err("too little custom and supply");
        }
        let order = self.town.order;
        let on_street = candidate
            .slot
            .street
            .and_then(|street| demand.on_streets.get(street))
            .map_or(0., |street| street[i]);
        // A town's own signature trades bid above the rest.
        let signature = if self.town.signature.iter().any(|own| own.same_family(kind)) {
            order.signature
        } else {
            1.
        };
        let bid = Bid {
            audience,
            fit: self.location.attraction(definition) * order.trade_pull(self.location.traffic),
            cost: (1. + (definition.typical_means - self.means).max(0.) * 3.)
                * order.crowding(demand.families[i], on_street),
            affinity: order.favour(site_affinity(self.town, candidate, kind)) * signature,
            working: demand.space.working,
        };
        if bid.weight() <= 0. {
            return Err("nothing draws it to this site");
        }
        Ok(bid)
    }
}
/// What a business's bid for a site is made of: the custom and supply it can reach, how
/// well the location suits it, what it costs its household beside how many of its family
/// already stand, how the town's template favours it there, and the working floor the
/// town still lacks.
#[derive(Clone, Copy, serde::Serialize)]
struct Bid {
    audience: f64,
    fit: f64,
    cost: f64,
    affinity: f64,
    working: f64,
}
impl Bid {
    fn weight(&self) -> f64 {
        self.audience * self.fit * self.working / self.cost * self.affinity
    }
}
fn choose(
    town: &Town,
    candidate: &super::Candidate,
    sample: f64,
    demand: &Demand,
    activities: &[Activity],
    spatial: &dyn crate::spatial::SpatialKernel,
) -> Option<Kind> {
    let siting = Siting {
        town,
        candidate,
        demand,
        activities,
        influence: town.placement_at(candidate.slot.front, spatial).ok()?,
        location: location(town, candidate),
        means: resources(town, candidate),
    };
    let activity = candidate.opportunities.for_activity(Activity::Trade).demand;
    let local = candidate.conditions;
    let mut opportunity = 0.;
    let mut competing_uses = 0.;
    let mut best = None;
    // A few sites of a traced town record every business's bid or why it made none.
    let traced = std::env::var("ATLAS_TRACE_TOWN").is_ok_and(|name| name == town.seat.name)
        && site_draw(town, candidate, 0x7ace) < 0.004;
    let mut bids = Vec::new();
    for (i, kind) in PLACES.iter().copied().enumerate() {
        let kind = crate::town::catalogue::productive_variant(
            kind,
            sample,
            &candidate.opportunities.production,
        );
        let bid = siting.business(i, kind);
        if traced {
            bids.push(serde_json::json!({
                "place": kind.definition().label,
                "weight": bid.as_ref().ok().map(Bid::weight),
                "bid": bid.as_ref().ok(),
                "declined": bid.as_ref().err(),
            }));
        }
        let Ok(weight) = bid.map(|bid| bid.weight()) else {
            continue;
        };
        opportunity += weight;
        competing_uses += 1.;
        let order = weighted_order(weight, site_draw(town, candidate, 0x6080 + i as i32));
        if best.is_none_or(|(previous, _)| order > previous) {
            best = Some((order, kind));
        }
    }
    if traced {
        eprintln!(
            "{}",
            serde_json::json!({
                "event": "town.construction-choice", "town": town.seat.name,
                "round": town.round + 1, "at": candidate.slot.front,
                "workingNeed": demand.space.working, "livingNeed": demand.space.living,
                "bids": bids,
            })
        );
    }
    if let Some((_, kind)) = best {
        let work = candidate.opportunities.for_activity(Activity::Household);
        let residential = demand.space.living * (1. + work.demand + work.capability)
            / (1. + local.density + work.burden);
        // The number of named businesses in the catalogue does not multiply local demand.
        let business = opportunity / competing_uses;
        if (!activities.is_empty() && !activities.contains(&Activity::Household))
            || site_draw(town, candidate, 0x40a6) * (business + residential) < business
        {
            return Some(kind);
        }
    }
    let distance = crate::town::geometry::distance(candidate.slot.front, town.seat.centre);
    let farming = Chance::of(town.round as i32, 0x5719).unit(candidate.slot.front);
    let kind = household(
        &HousingSite {
            scale: town.scale(),
            conditions: local,
            distance_from_seat: distance,
            trade_demand: activity,
            means: resources(town, candidate),
            form_sample: sample,
            livelihood_sample: farming,
        },
        &demand.housing,
    );
    (demand.space.living > 0.
        && (activities.is_empty() || activities.contains(&kind.definition().activity)))
    .then_some(kind)
}
impl UnmetDemand {
    fn supports(self, kind: Kind) -> bool {
        if kind.definition().roles.household {
            self.living > 0.
        } else {
            self.working > 0.
        }
    }
}
pub fn maintain(town: &mut Town, context: &super::Exposure<'_>) -> io::Result<()> {
    for i in 0..town.holdings().len() {
        let holding = &town.holdings()[i];
        let site = context.conditions.get(i).copied().unwrap_or_default();
        let care = holding.means * holding.occupation;
        let exposure = site.flood + site.waste + site.nuisance;
        let condition = ((site.standing.unwrap_or(0.25) + care) / (1. + exposure)).clamp(0., 1.);
        let claim = (0.5 + holding.means + site.protection) * (0.5 + holding.occupation);
        let claim = if site.forgetting * site.yielding <= 0. {
            holding.claim.max(claim)
        } else {
            claim
        };
        town.maintain(holding.id, condition, claim, holding.occupation);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::influence::{support_for, OpportunitySource, Reachable};

    #[test]
    fn premises_take_larger_plots_where_the_towns_order_offers_them() {
        use crate::town::{catalogue::MetresRange, order::Order, templates::civic::Civic};
        let house = [
            MetresRange { low: 6., high: 12. },
            MetresRange {
                low: 16.,
                high: 30.,
            },
        ];
        let area = |civic: Option<Civic>| {
            let mut order = Order::default();
            if let Some(civic) = civic {
                civic.write(&mut order);
            }
            let (wide, deep) = plot_taken(house, 0.5, order.plot_offer());
            wide * deep
        };
        // An ordinary town leaves the house the size its own range gives.
        assert_eq!(area(None), 9. * 23.);
        // A freehold's households hold several times the ground a slave-holding's do.
        assert!(area(Some(Civic::Freehold)) > 2. * area(None));
        assert!(area(Some(Civic::SlaveHolding)) < 0.6 * area(None));
        // However little a town offers, a house keeps the least it can stand on.
        assert_eq!(plot_taken(house, 0.5, [0.1, 0.1]), (6., 16.));
    }

    #[test]
    fn housing_frontage_follows_reachable_demand_when_a_place_moves() {
        let land = Conditions::default();
        let frontage = |activity, travel_cost| {
            let source = OpportunitySource {
                productive: None,
                clientele: None,
                endpoint: crate::town::fabric::Endpoint::External(atlas_map::Id::from_name(
                    "source",
                )),
                id: crate::town::influence::SourceId::Named(atlas_map::Id::from_name("source")),
                label: "Occupied premises".into(),
                position: [0., 0.],
                activity,
                demand: 2.,
                capability: 0.,
            };
            let support = support_for(
                Activity::Household,
                &[Reachable {
                    source: &source,
                    cost: travel_cost,
                    competitors: 0.,
                }],
                land,
                crate::town::scale::TownScale::default(),
            );
            frontage_priority(&support, land, 1., 0.5)
        };
        for activity in [Activity::Trade, Activity::Production] {
            let before = [frontage(activity, 10.), frontage(activity, 200.)];
            let after = [frontage(activity, f64::INFINITY), frontage(activity, 10.)];
            assert!(before[0] > before[1]);
            assert!(after[0] < after[1]);
        }
    }
}
