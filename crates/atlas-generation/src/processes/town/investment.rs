//! Collective investment retains spatial purposes while projects change the fabric underneath them.
use super::Exposure;
use crate::town::{
    catalogue::{Kind, PlaceRules},
    fabric::{Anchor, FabricEdit, FabricOwner, Purpose, Relationship, Specification, Town},
};
use std::io;

pub fn advance(town: &mut Town, context: &Exposure<'_>) -> io::Result<()> {
    extend_precincts(town, context)?;
    collective_needs(town, context);
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
            investments.extend(finance(town, edit).map(|funded| (value, funded)));
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
                    finance(
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
    let mut groups: Vec<(Vec<crate::town::fabric::HoldingId>, Vec<FabricEdit>)> = Vec::new();
    for (_, edit) in improvements {
        let contributors = match &edit {
            FabricEdit::Sponsored { contributors, .. } => contributors.clone(),
            _ => Vec::new(),
        };
        if let Some((funders, projects)) = groups
            .iter_mut()
            .find(|(funders, _)| contributors.iter().any(|id| funders.contains(id)))
        {
            funders.extend(contributors);
            projects.push(FabricEdit::Optional(Box::new(edit)));
        } else {
            groups.push((contributors, vec![edit]));
        }
    }
    for (_, projects) in groups {
        town.apply(FabricEdit::Project(projects), spatial)?;
    }
    Ok(())
}
/// A collective purpose may draw on several operating premises across town. Physical
/// requirements belong to its proposed site, independently of contributors' addresses.
pub(super) fn finance(town: &Town, edit: FabricEdit) -> Option<FabricEdit> {
    let (kind, existing) = edit.accommodation()?;
    let cost = kind.definition().investment_cost();
    let mut offers: Vec<_> = town
        .holdings()
        .iter()
        .filter(|h| Some(h.id) != existing && h.pledge() > 0.)
        .map(|h| (h.id, h.pledge()))
        .collect();
    // hpc-exempt: compares named premises making financial offers for one physical project.
    offers.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut funds = 0.;
    let mut contributors = Vec::new();
    for (id, pledge) in offers {
        contributors.push(id);
        funds += pledge;
        if funds >= cost {
            return Some(FabricEdit::Sponsored {
                contributors,
                placement: Box::new(edit),
            });
        }
    }
    None
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
        // Sites already seeking this kind, gathered once rather than per holding.
        let sought: Vec<_> = town
            .purposes()
            .iter()
            .filter(|p| p.relationships.contains(&Relationship::Accommodation(kind)))
            .map(|p| town.position(p.site))
            .collect();
        let reach = kind.definition().depth.high * 6.;
        let centre = town
            .holdings()
            .iter()
            .zip(context.conditions)
            .filter(|(h, c)| {
                h.condition > 0.35
                    && h.occupation > 0.2
                    && crate::town::catalogue::development::collective_need(
                        kind,
                        town.seat.story.people,
                        h.slot.front,
                        c.waste,
                    )
            })
            .filter(|(h, _)| {
                !sought
                    .iter()
                    .any(|&site| crate::town::geometry::distance(h.slot.front, site) <= reach)
            })
            .max_by(|(a, ca), (b, cb)| {
                let intensity =
                    |h: &crate::town::fabric::Holding, c: &crate::town::influence::Conditions| {
                        h.occupation * (1. + c.households + c.workshops + c.density + c.waste)
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
    let reach = kind.definition().depth.high * 6. + 5.;
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
            let space = h.slot.depth * h.slot.frontage
                >= footprint.depth.low * footprint.frontage.low * 0.45;
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
            let cost = (1. + distance / kind.definition().depth.high)
                * (1. + h.occupation * h.claim + c.waste);
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
