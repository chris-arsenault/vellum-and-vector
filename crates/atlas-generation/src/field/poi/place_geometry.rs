//! Lines follow directed physical propagation; sites use located sources where available.
use super::map_records::{native_position, MapState, Placement};
use crate::{
    field::shared::Scalar,
    hpc::BitSet,
    magic::{
        channels::Channel,
        configuration::{Cartography, Feature as FeatureRule, Propagation},
        state::MagicField,
    },
    spatial::{Overlay, Predicate},
    storage::ReadBand,
};
use atlas_map::{Geometry, Position};
use std::io;

fn line_parts(geometry: Geometry, lines: &mut Vec<Vec<Position>>) {
    match geometry {
        Geometry::LineString { coordinates } => lines.push(coordinates),
        Geometry::MultiLineString { coordinates } => lines.extend(coordinates),
        Geometry::GeometryCollection { geometries } => {
            for geometry in geometries {
                line_parts(geometry, lines);
            }
        }
        _ => {}
    }
}
pub fn line_geometry(geometry: Option<Geometry>) -> Option<Geometry> {
    let mut lines = Vec::new();
    line_parts(geometry?, &mut lines);
    match lines.len() {
        0 => None,
        1 => Some(Geometry::LineString {
            coordinates: lines.remove(0),
        }),
        _ => Some(Geometry::MultiLineString { coordinates: lines }),
    }
}
pub fn clipped_lines(
    state: &impl MapState,
    lines: Vec<Vec<Position>>,
) -> io::Result<Option<Geometry>> {
    if lines.is_empty() {
        return Ok(None);
    }
    let shape = state
        .chart()
        .geometry(
            &Geometry::MultiLineString { coordinates: lines },
            state.spatial(),
        )
        .map_err(io::Error::other)?;
    Ok(line_geometry(
        state
            .spatial()
            .overlay(&shape, state.footprint(), Overlay::Intersection)
            .map_err(io::Error::other)?,
    ))
}
pub fn linked_course(
    state: &impl MapState,
    members: &[usize],
    successor: impl Fn(usize) -> io::Result<Option<usize>>,
    exits: bool,
) -> io::Result<Option<Geometry>> {
    let mut included = BitSet::new(state.field()?.mesh.len());
    for &cell in members {
        included.add(cell);
    }
    let mut lines = Vec::new();
    for &cell in members {
        let Some(next) = successor(cell)? else {
            continue;
        };
        if !exits && !included.has(next) {
            continue;
        }
        let [ax, ay, _] = native_position(state, cell)?.coordinates();
        let [bx, by, _] = native_position(state, next)?.coordinates();
        lines.push(vec![Position::xy(ax, ay), Position::xy(bx, by)]);
    }
    clipped_lines(state, lines)
}
fn propagation_parents(
    state: &impl MapState,
    field: &MagicField,
    rule: &FeatureRule,
) -> Option<ReadBand<i32>> {
    field.parents().or_else(|| {
        state
            .magic()?
            .iter()
            .find(|field| {
                let participant = rule
                    .seeds
                    .iter()
                    .chain(rule.retains.iter().flatten())
                    .flatten()
                    .any(|condition| {
                        condition
                            .field
                            .strip_prefix("system:")
                            .unwrap_or(&condition.field)
                            == field.definition().id
                    });
                participant
                    && field
                        .definition()
                        .origins
                        .iter()
                        .any(|origin| matches!(origin.propagation, Propagation::Fracture))
            })?
            .parents()
    })
}
fn source_point(
    state: &impl MapState,
    field: &MagicField,
    rule: &str,
    members: &[usize],
) -> io::Result<Option<Geometry>> {
    if !["core", "locus"].contains(&rule) {
        return Ok(None);
    }
    let mesh = &state.field()?.mesh;
    let [ox, oy] = mesh.origin();
    let mut included = BitSet::new(mesh.len());
    for &cell in members {
        included.add(cell);
    }
    for source in field.located() {
        let geometry = state
            .chart()
            .geometry(
                &Geometry::Point {
                    coordinates: Position::xy(source.x + ox, source.y + oy),
                },
                state.spatial(),
            )
            .map_err(io::Error::other)?;
        if mesh
            .cell_at(source.x, source.y)
            .is_some_and(|cell| included.has(cell))
            && state
                .spatial()
                .relation(state.footprint(), &geometry, Predicate::Intersects)
                .map_err(io::Error::other)?
        {
            return Ok(Some(geometry));
        }
    }
    Ok(None)
}
fn wake_course(
    state: &impl MapState,
    field: &MagicField,
    extent: &Geometry,
) -> io::Result<Option<Geometry>> {
    let lines = field
        .wake_paths()
        .iter()
        .map(|path| path.iter().map(|&[x, y]| Position::xy(x, y)).collect())
        .collect();
    let Some(paths) = clipped_lines(state, lines)? else {
        return Ok(None);
    };
    Ok(line_geometry(
        state
            .spatial()
            .overlay(&paths, extent, Overlay::Intersection)
            .map_err(io::Error::other)?,
    ))
}
pub fn magic_place(
    state: &impl MapState,
    field: &MagicField,
    rule: &FeatureRule,
    members: &[usize],
    extent: &Geometry,
) -> io::Result<Option<Placement>> {
    let Some(&first) = members.first() else {
        return Ok(None);
    };
    let physical = state.field()?;
    let score = |cell| -> io::Result<f64> {
        let extra = if rule.id == "spring" {
            physical.shared.scalar(Scalar::Geothermal).get(cell)?
                + physical.shared.scalar(Scalar::Moisture).get(cell)?
        } else {
            field.channel(Channel::Source).get(cell)?
        };
        Ok(field.channel(Channel::Intensity).get(cell)? + extra)
    };
    let mut anchor = first;
    let mut best = score(first)?;
    for &cell in members.iter().skip(1) {
        let value = score(cell)?;
        if value > best {
            anchor = cell;
            best = value;
        }
    }
    match rule.cartography {
        Some(Cartography::Course) => {
            let geometry = if rule.id == "wake" {
                wake_course(state, field, extent)?
            } else if let Some(parents) = propagation_parents(state, field, rule) {
                linked_course(
                    state,
                    members,
                    |cell| Ok(usize::try_from(parents.get(cell)?).ok()),
                    false,
                )?
            } else {
                None
            };
            Ok(geometry.map(|geometry| Placement {
                geometry,
                anchor,
                meaning: "retained physical propagation course",
            }))
        }
        Some(Cartography::Site) => Ok(Some(Placement {
            geometry: source_point(state, field, &rule.id, members)?.unwrap_or(Geometry::Point {
                coordinates: native_position(state, anchor)?,
            }),
            anchor,
            meaning: if ["core", "locus"].contains(&rule.id.as_str()) {
                "source location"
            } else {
                "representative of classified site complex"
            },
        })),
        _ => Ok(None),
    }
}
