//! Collective investment retains spatial purposes while projects change the fabric underneath them.
use super::Exposure;
use crate::town::{
    catalogue::{Kind, PlaceRules},
    fabric::{
        Anchor, FabricEdit, FabricOwner, HoldingId, Purpose, Relationship, Specification, Town,
    },
    scale::Measure,
};
use std::io;
/// The margin the search for premises to share pads an accommodation's reach by. Street
/// metres, resolved by `Measure::Layout`.
const PREMISES_PAD: f64 = 5.;

pub fn advance(town: &mut Town, context: &Exposure<'_>) -> io::Result<()> {
    extend_precincts(town, context)?;
    collective_needs(town, context);
    let mut pledges = Pledges::default();
    let mut investments = Vec::new();
    for i in 0..town.purposes().len() {
        let purpose = &town.purposes()[i];
        let mut unmet = 0;
        let mut adaptations = Vec::new();
        for relation in &purpose.relationships {
            if relation.satisfied(purpose.site, town, context.spatial)? {
                continue;
            }
            unmet += 1;
            if let Relationship::Accommodation(kind) = relation {
                if purpose.investment >= 1. {
                    adaptations.extend(
                        STRATEGIES
                            .iter()
                            .filter_map(|propose| propose(town, purpose, *kind, context)),
                    );
                }
            }
        }
        if unmet > 0 {
            town.invest(
                i,
                context.exposure * unmet as f64 / town.purposes()[i].relationships.len() as f64,
            );
        }
        if let Some((value, edit)) = adaptations.into_iter().max_by(|a, b| a.0.total_cmp(&b.0)) {
            investments.extend(pledges.finance(town, edit).map(|funded| (value, funded)));
        }
    }
    investments.extend(town.holdings().iter().zip(context.conditions).filter_map(
        |(holding, local)| {
            let use_ = holding.secondary.unwrap_or(holding.kind);
            let definition = use_.definition();
            if !matches!(
                definition.roles.effects.improvement,
                Some(crate::town::effects::Improvement::ExpandedOperation)
            ) || holding.operation_tier >= 2
                || holding.occupation < 0.5
                || holding.established + 2 > town.round
            {
                return None;
            }
            let support = holding.support
                * (1.
                    + local.patronage
                    + local.effects.prestige
                    + definition.roles.learns_from * local.effects.learning);
            (support > definition.demand)
                .then(|| {
                    pledges
                        .finance(
                            town,
                            FabricEdit::Improve {
                                premises: holding.id,
                                use_,
                            },
                        )
                        .map(|edit| (support, edit))
                })
                .flatten()
        },
    ));
    invest_together(town, investments, context.spatial)?;
    Ok(())
}
fn invest_together(
    town: &mut Town,
    mut improvements: Vec<(f64, FabricEdit)>,
    spatial: &dyn crate::spatial::SpatialKernel,
) -> io::Result<()> {
    // hpc-exempt: patrons choose among specific town fabric interventions.
    improvements.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut groups: Vec<Vec<FabricEdit>> = Vec::new();
    let mut first_group = vec![usize::MAX; town.holdings().len()];
    for (_, edit) in improvements {
        let contributors = match &edit {
            FabricEdit::Sponsored { contributors, .. } => contributors.as_slice(),
            _ => &[],
        };
        let group = contributors
            .iter()
            .map(|id| first_group[id.0 as usize])
            .min()
            .unwrap_or(usize::MAX)
            .min(groups.len());
        for id in contributors {
            let first = &mut first_group[id.0 as usize];
            *first = (*first).min(group);
        }
        if group < groups.len() {
            groups[group].push(FabricEdit::Optional(Box::new(edit)));
        } else {
            groups.push(vec![edit]);
        }
    }
    for projects in groups {
        town.apply(FabricEdit::Project(projects), spatial)?;
    }
    Ok(())
}
/// A collective purpose may draw on several operating premises across town. Physical
/// requirements belong to its proposed site, independently of contributors' addresses.
#[derive(Default)]
pub(super) struct Pledges {
    // hpc-exempt: positive named pledges rank by amount, then by their order in the town.
    ranked: std::collections::BTreeSet<(std::cmp::Reverse<u64>, HoldingId)>,
    previous: Vec<u64>,
}
impl Pledges {
    fn record(&mut self, id: HoldingId, amount: f64) {
        let index = id.0 as usize;
        let pledge = amount.max(0.).to_bits();
        if index < self.previous.len() {
            let old = std::mem::replace(&mut self.previous[index], pledge);
            self.ranked.remove(&(std::cmp::Reverse(old), id));
        } else {
            self.previous.push(pledge);
        }
        if amount > 0. {
            self.ranked.insert((std::cmp::Reverse(pledge), id));
        }
    }
    fn contributors(&self, cost: f64, existing: Option<HoldingId>) -> Option<Vec<HoldingId>> {
        let mut funds = 0.;
        let mut contributors = Vec::new();
        for &(std::cmp::Reverse(amount), id) in &self.ranked {
            if Some(id) == existing {
                continue;
            }
            funds += f64::from_bits(amount);
            contributors.push(id);
            if funds >= cost {
                return Some(contributors);
            }
        }
        None
    }
    pub(super) fn finance(&mut self, town: &Town, edit: FabricEdit) -> Option<FabricEdit> {
        let (kind, existing) = edit.accommodation()?;
        for holding in &town.holdings()[self.previous.len()..] {
            self.record(holding.id, holding.pledge());
        }
        Some(FabricEdit::Sponsored {
            contributors: self.contributors(kind.definition().investment_cost(), existing)?,
            placement: Box::new(edit),
        })
    }
    pub(super) fn paid(&mut self, town: &Town, project: HoldingId) {
        for &id in &town.holdings()[project.0 as usize].sponsors {
            self.record(id, town.holdings()[id.0 as usize].pledge());
        }
    }
}

fn extend_precincts(town: &mut Town, context: &Exposure<'_>) -> io::Result<()> {
    use crate::town::catalogue::Activity;
    let outlines: Vec<_> = town.holdings().iter().map(|h| h.outline.clone()).collect();
    let index = context.spatial.index(&outlines).map_err(io::Error::other)?;
    let mut proposals = Vec::new();
    for h in town
        .holdings()
        .iter()
        .filter(|h| h.kind.definition().activity == Activity::Institution && h.occupation > 0.35)
    {
        let atlas_map::Bounds(w, s, e, n) = context
            .spatial
            .bounds(&h.outline)
            .map_err(io::Error::other)?;
        for i in index
            .query(atlas_map::Bounds(
                w - h.slot.frontage,
                s - h.slot.frontage,
                e + h.slot.frontage,
                n + h.slot.frontage,
            ))
            .map_err(io::Error::other)?
        {
            let other = &town.holdings()[i];
            if other.occupation < h.occupation
                && context.conditions[i].yielding > 0.
                && other.claim < h.claim * context.conditions[i].yielding
            {
                proposals.push(FabricEdit::Enclose {
                    institution: h.id,
                    premises: other.id,
                });
            }
        }
    }
    for proposal in proposals {
        town.apply(proposal, context.spatial)?;
    }
    Ok(())
}
fn collective_needs(town: &mut Town, context: &Exposure<'_>) {
    for &kind in &crate::town::catalogue::PLACES {
        let Some(requested) =
            crate::town::catalogue::development::collective_need(kind, town.seat.story.people)
        else {
            continue;
        };
        // Sites already seeking this kind, gathered once rather than per holding.
        let sought: Vec<_> = town
            .purposes()
            .iter()
            .filter(|p| p.relationships.contains(&Relationship::Accommodation(kind)))
            .map(|p| town.position(p.site))
            .collect();
        let reach = town.scale().range(kind.definition().depth).high * 6.;
        let centre = town
            .holdings()
            .iter()
            .zip(context.conditions)
            .filter(|(h, c)| {
                h.condition > 0.35 && h.occupation > 0.2 && requested(h.slot.front, c.waste)
            })
            .filter(|(h, _)| {
                !sought
                    .iter()
                    .any(|&site| crate::town::geometry::distance(h.slot.front, site) <= reach)
            })
            .max_by(|(a, ca), (b, cb)| {
                let intensity =
                    |h: &crate::town::fabric::Holding, c: &crate::town::influence::Conditions| {
                        h.occupation
                            * (1.
                                + c.households
                                + c.workshops
                                + c.density
                                + c.waste
                                + c.common_demand)
                    };
                intensity(a, ca).total_cmp(&intensity(b, cb))
            })
            .map(|(h, _)| h.id);
        if let Some(id) = centre {
            town.seek(Anchor::Premises(id), kind);
        }
    }
}
const STRATEGIES: &[super::DevelopmentStrategy] = &[reuse, share];

fn premises(
    town: &Town,
    purpose: &Purpose,
    kind: Kind,
    context: &Exposure<'_>,
    vacant: bool,
) -> Option<(f64, crate::town::fabric::HoldingId)> {
    let site = town.position(purpose.site);
    // Accommodation admits fronts within six of its depths of the site; a holding's front
    // lies on its outline, so the holdings index finds every candidate. Ids stay in
    // order so ties resolve as a scan would.
    let scale = town.scale();
    let depth = scale.range(kind.definition().depth);
    let reach = depth.high * 6. + scale.length(PREMISES_PAD, Measure::Layout);
    let [x, y] = site;
    let mut near = town
        .nearby_holdings(
            atlas_map::Bounds(x - reach, y - reach, x + reach, y + reach),
            context.spatial,
        )
        .ok()?;
    near.sort_unstable();
    near.into_iter()
        .filter_map(|i| Some((&town.holdings()[i], context.conditions.get(i)?)))
        .filter(|(h, conditions)| {
            if purpose.site == Anchor::Premises(h.id) {
                return false;
            }
            if !Relationship::Accommodation(kind).admits_frontage(
                purpose.site,
                town,
                h.slot.front,
                h.slot.depth,
            ) {
                return false;
            }
            let footprint = kind.definition();
            let compatible = h
                .kind
                .definition()
                .premises
                .shares_with
                .contains(&footprint.activity);
            let space = h.slot.depth * h.slot.frontage >= footprint.least_area(scale) * 0.45;
            h.condition > 0.4
                && space
                && h.secondary.is_none()
                && footprint.indoor_sharing()
                && !h.buildings.is_empty()
                && (h.occupation < 0.2) == vacant
                && compatible
                && super::construction::eligible(kind, **conditions, h.slot.street)
        })
        .map(|(h, c)| {
            let distance = crate::town::geometry::distance(h.slot.front, site);
            let learning = kind.definition().roles.learns_from;
            let returns = h.condition
                * (1.
                    + c.households
                    + c.protection
                    + c.effects.prestige
                    + learning * c.effects.learning);
            let cost = (1. + distance / depth.high) * (1. + h.occupation * h.claim + c.waste);
            (returns / cost, h.id)
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
}
fn reuse(
    town: &Town,
    purpose: &Purpose,
    kind: Kind,
    context: &Exposure<'_>,
) -> Option<(f64, FabricEdit)> {
    if kind.open() {
        return None;
    }
    let (utility, id) = premises(town, purpose, kind, context, true)?;
    Some((
        utility,
        FabricEdit::Reuse {
            premises: id,
            conditions: context.conditions[id.0 as usize],
            use_: kind,
        },
    ))
}
fn share(
    town: &Town,
    purpose: &Purpose,
    kind: Kind,
    context: &Exposure<'_>,
) -> Option<(f64, FabricEdit)> {
    let (utility, id) = premises(town, purpose, kind, context, false)?;
    Some((
        utility,
        FabricEdit::Share {
            premises: id,
            conditions: context.conditions[id.0 as usize],
            use_: kind,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::{HoldingId, Pledges};

    #[test]
    fn projects_draw_the_highest_live_pledges_excluding_their_own_premises() {
        let [a, b, c, d] = [0, 1, 2, 3].map(HoldingId);
        let mut offers = Pledges::default();
        for (owner, amount) in [(a, 3.), (b, 4.), (c, 4.), (d, 0.)] {
            offers.record(owner, amount);
        }
        assert_eq!(offers.contributors(5., None), Some(vec![b, c]));
        assert_eq!(offers.contributors(6., Some(b)), Some(vec![c, a]));
        offers.record(b, 0.5);
        offers.record(c, 0.);
        offers.record(HoldingId(4), 2.);
        assert_eq!(offers.contributors(4., None), Some(vec![a, HoldingId(4)]));
        assert_eq!(offers.contributors(6., None), None);
    }
}
