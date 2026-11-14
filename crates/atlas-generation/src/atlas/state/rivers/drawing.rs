use super::State;
use crate::{
    field::{
        poi::map_records::{self, MapState, Record},
        river_drawing::{self, Drawing, Paths},
    },
    spatial::{Overlay, Predicate},
    water::Stations,
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

struct Stretch {
    members: Vec<usize>,
    drawing: Drawing,
}
fn line_parts(shape: Geometry, output: &mut Vec<Vec<Position>>) {
    match shape {
        Geometry::LineString { coordinates } => output.push(coordinates),
        Geometry::MultiLineString { coordinates } => output.extend(coordinates),
        Geometry::GeometryCollection { geometries } => {
            for shape in geometries {
                line_parts(shape, output);
            }
        }
        _ => {}
    }
}
fn pieces_in_frame(
    state: &State,
    coordinates: Vec<Position>,
    original: &Drawing,
) -> io::Result<Vec<Drawing>> {
    let copy = Geometry::LineString {
        coordinates: coordinates.clone(),
    };
    let footprint = &state.scope.footprint;
    let spatial = state.spatial.as_ref();
    if !spatial
        .relation(&copy, footprint, Predicate::Intersects)
        .map_err(io::Error::other)?
        || (state.scope.has_boundary
            && !spatial
                .crossings(&copy, footprint)
                .map_err(io::Error::other)?
                .is_empty())
    {
        return Ok(Vec::new());
    }
    if spatial
        .relation(footprint, &copy, Predicate::Covers)
        .map_err(io::Error::other)?
    {
        return Ok(vec![Drawing {
            coordinates,
            profiles: original.profiles.clone(),
        }]);
    }
    let mut lines = Vec::new();
    if let Some(clipped) = spatial
        .overlay(&copy, footprint, Overlay::Intersection)
        .map_err(io::Error::other)?
    {
        line_parts(clipped, &mut lines);
    }
    lines
        .into_iter()
        .filter(|line| line.len() >= 2)
        .map(|line| {
            let stations = Stations::new(spatial, &coordinates, &line).map_err(io::Error::other)?;
            let profiles = original
                .profiles
                .iter()
                .map(|(key, values)| {
                    Ok((
                        key.clone(),
                        stations.interpolate(values).map_err(io::Error::other)?,
                    ))
                })
                .collect::<io::Result<_>>()?;
            Ok(Drawing {
                coordinates: line,
                profiles,
            })
        })
        .collect()
}
fn chart_pieces(state: &State, stretches: &[Stretch]) -> io::Result<Vec<Vec<Drawing>>> {
    // hpc-exempt: sparse chart-copy metadata kept in first-encounter order.
    let mut copies: Vec<(i64, Vec<Drawing>)> = Vec::new();
    for stretch in stretches {
        let geometry = Geometry::LineString {
            coordinates: stretch.drawing.coordinates.clone(),
        };
        for copy in state
            .chart()
            .copies(&geometry, state.spatial.as_ref())
            .map_err(io::Error::other)?
        {
            let Geometry::LineString { coordinates } = copy else {
                return Err(io::Error::other("A river chart copy must be a line"));
            };
            let shift = (coordinates[0].coordinates()[0]
                - stretch.drawing.coordinates[0].coordinates()[0]
                + 0.5)
                .floor() as i64;
            let pieces = pieces_in_frame(state, coordinates, &stretch.drawing)?;
            if pieces.is_empty() {
                continue;
            }
            if let Some((_, found)) = copies.iter_mut().find(|(at, _)| *at == shift) {
                found.extend(pieces);
            } else {
                copies.push((shift, pieces));
            }
        }
    }
    Ok(copies.into_iter().map(|(_, pieces)| pieces).collect())
}
fn regime(state: &State, stretches: &[Stretch]) -> &'static str {
    let mut months = stretches
        .iter()
        .flat_map(|s| &s.members)
        .map(|&cell| (state.field().river_months(cell) + 0.5).floor())
        .collect::<Vec<_>>();
    // hpc-exempt: median of a course's profile, not a geographic search or key index.
    months.sort_by(f64::total_cmp);
    let middle = months.get(months.len() / 2).copied().unwrap_or(0.0);
    if middle >= 12.0 {
        "perennial"
    } else if middle > 0.0 {
        "seasonal"
    } else {
        "dry"
    }
}
pub(super) fn lines(mut lines: Vec<Vec<Position>>) -> Geometry {
    if lines.len() == 1 {
        Geometry::LineString {
            coordinates: lines.remove(0),
        }
    } else {
        Geometry::MultiLineString { coordinates: lines }
    }
}
pub(super) fn publish_course(
    state: &mut State,
    parts: &[Vec<usize>],
    paths: &Paths,
    basin_discharge: f64,
    river: &str,
) -> io::Result<(Vec<String>, Option<String>)> {
    let stretches = parts
        .iter()
        .filter(|members| members.len() >= 2)
        .map(|members| {
            let valley = paths.draw(state.field(), members, state.spatial.as_ref())?;
            let moved = river_drawing::meander(
                state.field(),
                paths,
                &valley,
                members[0],
                state.spatial.as_ref(),
            )?;
            Ok(Stretch {
                members: members.clone(),
                drawing: moved.map_or(valley, |m| m.drawing),
            })
        })
        .collect::<io::Result<Vec<_>>>()?;
    if stretches.is_empty() {
        return Ok((Vec::new(), None));
    }
    let head = stretches[0].members[0];
    let source = map_records::native_position(state, head)?.coordinates();
    let [ox, oy] = state.field().mesh().origin();
    let mut junctions = Vec::new();
    for &cell in stretches.iter().flat_map(|s| &s.members) {
        if paths.incoming.get(cell)? > 1 {
            junctions.push([paths.x.get(cell)? + ox, paths.y.get(cell)? + oy]);
        }
    }
    let kept = state.field().river_at(head);
    let mut ids = Vec::new();
    let mut first = None;
    for pieces in chart_pieces(state, &stretches)? {
        let mut attributes = serde_json::Map::new();
        for key in pieces[0].profiles.keys() {
            attributes.insert(
                key.clone(),
                json!(pieces
                    .iter()
                    .flat_map(|piece| piece.profiles[key].iter().copied())
                    .collect::<Vec<_>>()),
            );
        }
        attributes.insert(
            "discharge".into(),
            json!(pieces[0].profiles["discharges"][0]),
        );
        attributes.insert(
            "order".into(),
            json!(kept.as_ref().map_or(0, |r| r.order())),
        );
        attributes.insert("junctions".into(), json!(junctions));
        attributes.insert("regime".into(), regime(state, &stretches).into());
        attributes.insert("basinDischarge".into(), basin_discharge.into());
        attributes.insert("sourceAlgorithm".into(), "atlas-1".into());
        let key = format!("river:{river}:{}", ids.len());
        first.get_or_insert_with(|| key.clone());
        let name = format!(
            "River {} {}",
            (source[0] / 1000.0 + 0.5).floor(),
            (source[1] / 1000.0 + 0.5).floor()
        );
        let mut feature = map_records::generated(
            state,
            Record {
                key: &key,
                name: &name,
                kind: "river",
                layer: "rivers",
                geometry: lines(pieces.into_iter().map(|piece| piece.coordinates).collect()),
                attributes: attributes.into_iter().collect(),
            },
        )?;
        if let Some(name) = kept
            .as_ref()
            .and_then(|r| r.name())
            .filter(|n| !n.is_empty())
        {
            feature.name = name.into();
        }
        ids.push(feature.id.clone());
        state.write_network(feature)?;
    }
    Ok((ids, first))
}
