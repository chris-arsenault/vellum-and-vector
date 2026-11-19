use super::{Commission, WorkFamily, WorkOrigin};
use crate::{
    noise::hash_unit,
    processes::town::{Candidate, Frontage},
    town::{
        catalogue::{works::Part, PlaceRules},
        fabric::{EditOutcome, FabricEdit, FabricOwner, HoldingId, Proposal, Town},
        geometry::{distance, left, rectangle, Point},
        ground::{Rectangle, FREE, PLOT},
        plots::Slot,
    },
};
use atlas_map::{spatial::BoundsIndex, Bounds};
use std::io;

pub fn advance(town: &mut Town, context: &mut Frontage<'_>) -> io::Result<()> {
    let Some(seed) = town.works.seed else {
        return Ok(());
    };
    organic(town, seed, context)?;
    for work in &mut town.works.commissions {
        work.check_route(town.template.site.door, context.links);
    }
    if town.works.commissions.iter().all(Commission::complete) {
        return Ok(());
    }
    let mut candidates = BoundsIndex::default();
    for c in context.candidates {
        let [x, y] = c.slot.front;
        candidates.push(Bounds(x, y, x, y));
    }
    for i in 0..town.works.commissions.len() {
        let work = &town.works.commissions[i];
        let Some(target) = work.target() else {
            continue;
        };
        let part = work.design.parts[work.members.len()].clone();
        let cost = (part.frontage * part.depth).sqrt() / 10.;
        if town.effort < cost {
            continue;
        }
        let near = ranked_sites(&candidates, context.candidates, target, &part);
        for candidate in near {
            let work = &town.works.commissions[i];
            let Some(slot) = fit(candidate, work, &part, context) else {
                continue;
            };
            let buildings = crate::town::roofs::components(&slot, part.use_, 0.85, 0.5);
            let outdoor = part.use_.open();
            let edit = FabricEdit::Establish {
                conditions: candidate.conditions,
                purpose: None,
                buildings,
                outdoor,
                proposal: Proposal {
                    slot,
                    kind: part.use_,
                    means: 0.85,
                    priority: 2.,
                    cause: format!("{} — {}", work.family.label(), part.label),
                },
            };
            let EditOutcome::Premises(id) = town.apply(edit, context.spatial)? else {
                continue;
            };
            let custodian = work_partner(town, i);
            if let Some(partner) = custodian {
                town.apply(
                    FabricEdit::Bind {
                        premises: id,
                        partner,
                    },
                    context.spatial,
                )?;
            }
            town.occupy(id, 0.8, 0.85, 0.9, 0.);
            if town.works.commissions[i].members.is_empty() {
                super::grounds::claim(town, i, id, context)?;
            }
            town.works.commissions[i].members.push(id);
            town.effort -= cost;
            context.ground.mark_shapes(
                std::slice::from_ref(&town.holdings()[id.0 as usize].outline),
                PLOT,
                context.spatial,
            )?;
            break;
        }
    }
    Ok(())
}

fn work_partner(town: &Town, i: usize) -> Option<HoldingId> {
    let work = &town.works.commissions[i];
    work.members.first().or(work.sponsors.first()).copied()
}

fn organic(town: &mut Town, seed: i32, context: &Frontage<'_>) -> io::Result<()> {
    for &family in WorkFamily::ALL {
        for anchor in family
            .definition()
            .sites(&town.template.site, &town.seat.story)
        {
            if !town.works.established_near(family, anchor)
                && !town.works.observed.contains(&(family, anchor))
            {
                subscribe(town, seed, context, family, anchor)?;
            }
        }
    }
    Ok(())
}
fn subscribe(
    town: &mut Town,
    seed: i32,
    context: &Frontage<'_>,
    family: WorkFamily,
    anchor: Point,
) -> io::Result<()> {
    let def = family.definition();
    let ticket = hash_unit(
        seed.wrapping_add(family as i32) ^ 0x1593,
        anchor[0],
        anchor[1],
    );
    // The draw belongs to this undertaking and locality, rather than to a particular round.
    if ticket >= 0.018 {
        return Ok(());
    }
    let reach = def.sponsor_reach();
    let [x, y] = anchor;
    let nearby = town.nearby_holdings(
        Bounds(x - reach, y - reach, x + reach, y + reach),
        context.spatial,
    )?;
    let sponsors = nearby
        .into_iter()
        .map(|id| &town.holdings()[id])
        .filter(|h| {
            h.occupation > 0.
                && def.custodians.iter().any(|kind| {
                    kind.same_family(h.kind) || h.secondary.is_some_and(|k| kind.same_family(k))
                })
        })
        .map(|h| h.id)
        .collect::<Vec<_>>();
    let supported_from_outside = sponsors.len() == 1
        && town.seat.story.ways > 1
        && town.holdings()[sponsors[0].0 as usize]
            .ties
            .iter()
            .any(|tie| {
                matches!(
                    tie.destination,
                    crate::town::fabric::Endpoint::External(_)
                        | crate::town::fabric::Endpoint::Catchment { .. }
                )
            });
    if (sponsors.len() >= 2 || supported_from_outside) && town.works.consider(family, anchor) {
        let sponsors_kinds = sponsors
            .iter()
            .map(|id| town.holdings()[id.0 as usize].kind)
            .collect::<Vec<_>>();
        let design = def.design(
            &town.template.site,
            anchor,
            &sponsors_kinds,
            seed.wrapping_add(family as i32),
        );
        town.works
            .start(
                family,
                WorkOrigin::Organic,
                anchor,
                &town.template.site,
                design,
            )
            .sponsors = sponsors;
    }
    Ok(())
}

fn ranked_sites<'a>(
    index: &BoundsIndex,
    candidates: &'a [Candidate],
    target: Point,
    part: &Part,
) -> Vec<&'a Candidate> {
    let reach = part.frontage.max(part.depth);
    let [x, y] = target;
    let mut sites = index
        .query(Bounds(x - reach, y - reach, x + reach, y + reach))
        .into_iter()
        .map(|i| &candidates[i])
        .filter(|c| {
            c.slot.participant.is_none()
                && crate::town::siting::feasible(part.use_, c.conditions, c.slot.street)
        })
        .collect::<Vec<_>>();
    // hpc-exempt: orders sites inside a spatially indexed component search envelope.
    sites.sort_unstable_by(|a, b| {
        distance(a.slot.front, target).total_cmp(&distance(b.slot.front, target))
    });
    sites
}

fn fit(
    candidate: &Candidate,
    work: &Commission,
    part: &Part,
    context: &Frontage<'_>,
) -> Option<Slot> {
    let mut slot = candidate.slot.clone();
    let wet = part.station.wet();
    if wet != slot.habitat.wet() {
        return None;
    }
    slot.tenure = crate::town::templates::Tenure::Institutional;
    if slot.street.is_none() {
        slot.direction = work.direction;
        slot.inward = left(work.direction);
    }
    slot.frontage = part.frontage;
    slot.depth = part.depth;
    slot.corners = rectangle(
        slot.front,
        slot.direction,
        slot.inward,
        slot.frontage,
        slot.depth,
    );
    let street = slot
        .street
        .map_or(FREE, |i| crate::town::ground::FIRST_STREET + i as u32);
    (context
        .ground
        .open_with(&Rectangle(&slot.corners), |owner| {
            slot.habitat.fits(owner, |m| m == FREE || m == street)
        })
        && (part.use_.open()
            || hash_unit(0x233a, slot.front[0], slot.front[1]) <= candidate.conditions.building))
        .then_some(slot)
}
