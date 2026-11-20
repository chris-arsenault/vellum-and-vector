//! Crowding presses on rear gardens while existing buildings and access resist subdivision.
use super::Exposure;
use crate::town::scale::Measure;
use crate::town::{
    catalogue::PlaceRules,
    fabric::{polygon, FabricEdit, FabricOwner, HoldingId, Town},
    geometry::{add, rectangle, scale},
};
use atlas_map::spatial::Overlay;
use std::io;
/// The least depth a divided rear garden keeps and the least frontage a plot is divided at.
/// Street metres, resolved by `Measure::Plot`.
const LEAST_REAR_DEPTH: f64 = 8.;
const LEAST_DIVIDED_FRONTAGE: f64 = 6.;
/// How far a rear holding's passage runs past the division, and its half width. Street
/// metres, resolved by `Measure::Plot` and `Measure::Width`.
const PASSAGE_OVERRUN: f64 = 1.;
const PASSAGE_HALF_WIDTH: f64 = 0.35;
pub fn advance(town: &mut Town, context: &Exposure<'_>) -> io::Result<()> {
    let claims: Vec<_> = town
        .holdings()
        .iter()
        .filter(|h| {
            !h.public && h.crowding > 0.35 && h.occupation > 0.65 && h.established + 2 < town.round
        })
        .map(|h| h.id)
        .collect();
    for id in claims {
        let holding = &town.holdings()[id.0 as usize];
        let land = context.conditions[id.0 as usize];
        if let Some(host) = holding.slot.participant {
            let slot = &holding.slot;
            let strip = polygon(&rectangle(
                slot.front,
                slot.direction,
                scale(slot.inward, -1.),
                slot.frontage * 0.65,
                slot.depth * 0.15,
            ));
            if matches!(
                town.apply(
                    FabricEdit::ExtendFrontage {
                        premises: id,
                        host,
                        strip
                    },
                    context.spatial
                )?,
                crate::town::fabric::EditOutcome::Premises(_)
            ) {
                continue;
            }
        }
        let holding = &town.holdings()[id.0 as usize];
        let upward = holding.means * holding.condition * (1. + land.density)
            / (holding.storeys.iter().min().copied().unwrap_or(1) as f64 * (1. + land.flood));
        if holding.crowding * upward > 0.16 && holding.kind.definition().roles.dwelling {
            town.apply(FabricEdit::Raise { premises: id }, context.spatial)?;
        } else {
            subdivide(town, id, context)?;
        }
    }
    Ok(())
}
fn subdivide(town: &mut Town, id: HoldingId, context: &Exposure<'_>) -> io::Result<()> {
    let original = town.holdings()[id.0 as usize].clone();
    let Some(use_) = original.kind.definition().roles.subdivision_use else {
        return Ok(());
    };
    let slot = &original.slot;
    let back = slot.depth * 0.62;
    let town_scale = town.scale();
    if slot.depth - back < town_scale.length(LEAST_REAR_DEPTH, Measure::Plot)
        || slot.frontage < town_scale.length(LEAST_DIVIDED_FRONTAGE, Measure::Plot)
    {
        return Ok(());
    }
    let Some((front, rear, passage)) = partition(&original, context, town_scale)? else {
        return Ok(());
    };
    let mut rear_slot = slot.clone();
    rear_slot.front = add(slot.front, scale(slot.inward, back));
    rear_slot.depth -= back;
    town.apply(
        FabricEdit::Divide {
            conditions: context.conditions[id.0 as usize],
            premises: id,
            use_,
            front,
            rear,
            slot: rear_slot,
            passage,
        },
        context.spatial,
    )?;
    Ok(())
}

fn partition(
    original: &crate::town::fabric::Holding,
    context: &Exposure<'_>,
    town_scale: crate::town::scale::TownScale,
) -> io::Result<
    Option<(
        atlas_map::Geometry,
        atlas_map::Geometry,
        atlas_map::Geometry,
    )>,
> {
    let slot = &original.slot;
    let back = slot.depth * 0.62;
    let rear = polygon(&rectangle(
        add(slot.front, scale(slot.inward, back)),
        slot.direction,
        slot.inward,
        slot.frontage,
        slot.depth - back,
    ));
    let Some(rear) = context
        .spatial
        .overlay(&original.outline, &rear, Overlay::Intersection)
        .map_err(io::Error::other)?
        .and_then(atlas_map::regions::polygon)
    else {
        return Ok(None);
    };
    let Some(front) = context
        .spatial
        .overlay(&original.outline, &rear, Overlay::Difference)
        .map_err(io::Error::other)?
        .and_then(atlas_map::regions::polygon)
    else {
        return Ok(None);
    };
    let entrance = add(slot.front, scale(slot.direction, slot.frontage * 0.45));
    let overrun = town_scale.length(PASSAGE_OVERRUN, Measure::Plot);
    let passage =
        crate::town::edits::line(&[entrance, add(entrance, scale(slot.inward, back + overrun))]);
    let Some(corridor) = context
        .spatial
        .buffer(
            &passage,
            town_scale.length(PASSAGE_HALF_WIDTH, Measure::Width),
        )
        .map_err(io::Error::other)?
    else {
        return Ok(None);
    };
    if context
        .spatial
        .intersection_areas(&corridor, &original.buildings)
        .map_err(io::Error::other)?
        .iter()
        .any(|a| *a > 0.)
    {
        return Ok(None);
    }
    Ok(Some((front, rear, passage)))
}
