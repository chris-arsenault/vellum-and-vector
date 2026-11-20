use super::Frontage;
use crate::town::{
    edits::line,
    fabric::{EditOutcome, FabricEdit, FabricOwner, Town},
    geometry::{add, angle, at, distance, heading, left, scale, Point},
    ground::{Ground, FIRST_STREET},
    network::{main_street, Arm, Class, Street},
    scale::TownScale,
    story::Size,
};
use atlas_map::{Geometry, Position};
use std::io;

/// Distance to the frame along a heading. The map may show either end of a longer journey.
fn to_edge(start: Point, direction: Point, ground: &Ground) -> f64 {
    [ground.columns, ground.rows]
        .into_iter()
        .enumerate()
        .filter_map(|(i, cells)| {
            let d = direction[i];
            if d.abs() < 1e-9 {
                return None;
            }
            let edge = ground.origin[i]
                + if d > 0. {
                    cells as f64 * ground.cell
                } else {
                    0.
                };
            Some((edge - start[i]) / d)
        })
        .fold(f64::INFINITY, f64::min)
}

/// Where a crossing runs and how it is laid: from a junction along a heading, in a place of
/// `size` at `scale`, its street giving way to a country road over `core` metres.
#[derive(Clone, Copy)]
struct Course {
    start: Point,
    direction: Point,
    size: Size,
    scale: TownScale,
    core: f64,
}

fn crossing(course: Course, ground: &Ground) -> Option<Street> {
    let Course {
        start,
        direction,
        size,
        scale: town_scale,
        core,
    } = course;
    let reach = to_edge(start, direction, ground);
    if reach < core {
        return None;
    }
    let arm = Arm {
        points: vec![start, add(start, scale(direction, reach))],
        destination: None,
    };
    let mut street = main_street(&arm, reach, size, ground, town_scale)?;
    if street.length() < core {
        return None;
    }
    street.class = Class::Street;
    let (urban, rural) = (
        town_scale.street_width(Class::Street, size),
        town_scale.street_width(Class::Road, size),
    );
    for (point, width) in street.points.iter().zip(&mut street.widths) {
        let rural_share = (distance(start, *point) / core).min(1.);
        *width = urban * (1. - rural_share) + rural * rural_share;
    }
    Some(street)
}

// owner-direction(2026-11-18): major crossings of the main road lead out into the countryside.
pub(super) fn establish(
    town: &mut Town,
    context: &mut Frontage<'_>,
    trace: &super::movement::StreetTrace<'_>,
) -> io::Result<()> {
    let size = town.seat.story.size();
    if size < Size::Town || town.access_effort <= 0. {
        trace.event(|| serde_json::json!({"stage":"crossing","result":"size or effort below threshold","effort":town.access_effort}));
        return Ok(());
    }
    let town_scale = town.scale();
    let depth = town.plot().1;
    let core = depth * 5.;
    let trunks: Vec<_> = town
        .streets()
        .iter()
        .enumerate()
        .filter(|(_, s)| s.class == Class::Main)
        .map(|(i, s)| (i, s.clone()))
        .collect();
    for (id, trunk) in trunks {
        let occupied = town
            .holdings()
            .iter()
            .filter(|h| h.slot.street == Some(id))
            .map(|h| h.slot.along + h.slot.depth)
            .fold(0., f64::max);
        let available = occupied.min(trunk.length());
        if available < depth * 3. {
            trace.event(|| serde_json::json!({"stage":"crossing","result":"insufficient occupied trunk","available":available,"required":depth*3.}));
            continue;
        }
        let ways = select_crossing(
            &trunk,
            available,
            Course {
                start: [0.; 2],
                direction: [0.; 2],
                size,
                scale: town_scale,
                core,
            },
            town.streets(),
            context,
        )?;
        trace.event(|| serde_json::json!({"stage":"crossing","directions":ways.len()}));
        for way in ways {
            let arm = Arm {
                points: way.points,
                destination: way.destination,
            };
            let reach = (depth * 2.).min(town.access_effort * 2.);
            if reach < depth {
                continue;
            }
            let Some(mut street) = main_street(&arm, reach, size, context.ground, town_scale)
            else {
                continue;
            };
            street.class = Class::Street;
            street.through_route &= street.length() + context.ground.cell
                >= crate::town::geometry::line_length(&arm.points);
            street
                .widths
                .fill(town_scale.street_width(Class::Street, size));
            if let EditOutcome::Route(id) = town.apply(
                FabricEdit::Connect {
                    street: street.clone(),
                    priority: 2.,
                },
                context.spatial,
            )? {
                trace.event(|| serde_json::json!({"stage":"crossing","result":"built","street":id,"to":street.points.last()}));
                town.follow_course(arm, id);
                town.access_effort -= street.length() * 0.5;
                context.ground.take_line(
                    &street.points,
                    street.width() + context.ground.cell,
                    FIRST_STREET + id as u32,
                );
            }
        }
    }
    Ok(())
}

/// The best crossing of the trunk's occupied length, laid as `laid` lays one; its start and
/// direction are each junction's own.
fn select_crossing(
    trunk: &Street,
    available: f64,
    laid: Course,
    existing: &[Street],
    context: &Frontage<'_>,
) -> io::Result<Vec<Street>> {
    let core = laid.core;
    let roads: Vec<_> = existing.iter().map(|s| line(&s.points)).collect();
    let index = context.spatial.index(&roads).map_err(io::Error::other)?;
    let mut best = None;
    let mut best_gain = 0.;
    for fraction in [0.5, 0.33, 0.67] {
        let Some((junction, axis)) = at(&trunk.points, available * fraction) else {
            continue;
        };
        if existing
            .iter()
            .any(|s| s.class == Class::Street && distance(s.points[0], junction) < core)
        {
            continue;
        }
        for bend in [0., 0.32, -0.32] {
            let normal = heading(angle(left(axis)) + bend);
            let mut ways = Vec::new();
            let mut gain = 0.;
            for sign in [-1., 1.] {
                let Some(street) = crossing(
                    Course {
                        start: junction,
                        direction: scale(normal, sign),
                        core: core * 0.65,
                        ..laid
                    },
                    context.ground,
                ) else {
                    continue;
                };
                let end = street.points.last().unwrap();
                let at = Position::xy(end[0], end[1]);
                let Some(i) = index.nearest(at).map_err(io::Error::other)? else {
                    continue;
                };
                let unserved = context
                    .spatial
                    .distance(&roads[i], &Geometry::Point { coordinates: at })
                    .map_err(io::Error::other)?;
                if unserved < core * 0.5 {
                    continue;
                }
                gain += unserved * (1. - bend.abs());
                ways.push(street);
            }
            if gain > best_gain {
                best_gain = gain;
                best = Some(ways);
            }
        }
    }
    Ok(best.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cross_street_reaches_the_frame_at_country_road_width() {
        let ground = Ground::new([0., 0., 600., 400.], 1.);
        let course = Course {
            start: [150., 125.],
            direction: [0., 1.],
            size: Size::Town,
            scale: TownScale::default(),
            core: 100.,
        };
        let street = crossing(course, &ground).unwrap();
        assert!(street.destination.is_none());
        assert!(street.through_route);
        assert_eq!(
            street.widths.first(),
            Some(&Class::Street.width(Size::Town))
        );
        assert_eq!(street.widths.last(), Some(&Class::Road.width(Size::Town)));
        assert!(distance(*street.points.last().unwrap(), [150., 400.]) <= ground.cell);
    }
}
