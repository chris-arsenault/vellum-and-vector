use super::{drawing::lines, State};
use crate::{
    features::{network::Selection, FeatureSelection, State as FeatureState},
    field::{
        poi::map_records::{self, Record},
        significance::measure,
    },
    lattice::Membership,
    water::{reaches::Reach, significance::RIVER_LENGTH},
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

fn line_of(state: &State, cells: &[usize]) -> io::Result<Vec<Position>> {
    let mut line = cells
        .iter()
        .filter(|&&cell| state.field().mesh().membership(cell) == Membership::Content)
        .map(|&cell| {
            let [x, y, _] = map_records::native_position(state, cell)?.coordinates();
            Ok(Position::xy((x + 0.5).floor(), (y + 0.5).floor()))
        })
        .collect::<io::Result<Vec<_>>>()?;
    // Retained courses may revisit the same cell; coincident vertices have no line extent.
    line.dedup();
    Ok(line)
}
fn course<'a>(end: &'a Reach, dry: &[&'a Reach]) -> Vec<&'a Reach> {
    let mut course = vec![end];
    let mut n = 0;
    while n < course.len() {
        for &reach in dry {
            if reach.downstream() == Some(course[n].id())
                && (reach.river().is_none() || reach.river() == end.river())
                && !course.iter().any(|r| r.id() == reach.id())
            {
                course.push(reach);
            }
        }
        n += 1;
    }
    course
}
fn members(state: &State, reach: &Reach, all: &[Reach]) -> Vec<usize> {
    let mut cells = reach.cells().to_vec();
    let next = reach
        .downstream()
        .and_then(|id| all.iter().find(|r| r.id() == id))
        .and_then(|r| r.cells().first());
    if let (Some(&last), Some(&next)) = (cells.last(), next) {
        if (0..3).any(|edge| state.field().mesh().neighbor(last, edge) == Some(next)) {
            cells.push(next);
        }
    }
    cells
}
fn clear_members(state: &mut State) -> io::Result<()> {
    let records = state
        .records
        .features
        .values(FeatureSelection {
            area_id: Some(&state.scope.area),
            kind: Some("river"),
            ..Default::default()
        })?
        .collect::<io::Result<Vec<_>>>()?;
    for feature in records {
        if feature
            .attributes
            .get("dryMember")
            .and_then(|v| v.as_bool())
            != Some(true)
            || feature.state != FeatureState::Generated
            || feature.protected
        {
            continue;
        }
        state.records.features.remove(&feature.id)?;
        let reaches = state
            .records
            .networks
            .reaches(Selection {
                feature_id: Some(&feature.id),
                node_id: None,
            })?
            .collect::<io::Result<Vec<_>>>()?;
        for reach in reaches {
            state.records.networks.remove_reach(&reach.id)?;
        }
    }
    Ok(())
}
pub(super) fn publish(state: &mut State) -> io::Result<()> {
    clear_members(state)?;
    let reaches = state.field().retained_reaches();
    let dry = reaches.iter().filter(|r| r.dry()).collect::<Vec<_>>();
    // hpc-exempt: published river identities, not numerical cell membership.
    let mut published = std::collections::BTreeSet::new();
    for end in &dry {
        let (Some(river), Some(record)) = (end.river(), end.record()) else {
            continue;
        };
        if !published.insert(river) {
            continue;
        }
        let running = reaches.iter().any(|r| !r.dry() && r.river() == Some(river));
        let mut courses: Vec<&Reach> = Vec::new();
        for reach in dry.iter().filter(|r| r.river() == Some(river)) {
            for reach in course(reach, &dry) {
                if !courses.iter().any(|r| r.id() == reach.id()) {
                    courses.push(reach);
                }
            }
        }
        let coordinates = courses
            .iter()
            .map(|reach| line_of(state, &members(state, reach, &reaches)))
            .collect::<io::Result<Vec<_>>>()?
            .into_iter()
            .filter(|line| line.len() >= 2)
            .collect::<Vec<_>>();
        if coordinates.is_empty() {
            continue;
        }
        let key = if running {
            format!("river-dry:{river}")
        } else {
            record.into()
        };
        let mut feature = map_records::generated(
            state,
            Record {
                key: &key,
                name: "Dry river",
                kind: "river",
                layer: "rivers",
                geometry: lines(coordinates),
                attributes: serde_json::from_value(
                    json!({ "order": end.order(), "regime": "dry", "riverId": river, "dryMember": running, "sourceAlgorithm": "atlas-1" }),
                )?,
            },
        )?;
        if let Some(name) = end.name().filter(|n| !n.is_empty()) {
            feature.name = name.into();
        }
        let id = feature.id.clone();
        state.write_network(feature)?;
        former(state, &courses, Some(&id), river)?;
    }
    Ok(())
}
pub(super) fn former(
    state: &mut State,
    reaches: &[&Reach],
    drawn_as: Option<&str>,
    river: &str,
) -> io::Result<()> {
    let Some(feature) = drawn_as
        .map(|id| state.records.features.get(id))
        .transpose()?
        .flatten()
    else {
        return Ok(());
    };
    let least = measure(&state.field().scale(), RIVER_LENGTH, 1, 1.0)?;
    for reach in reaches {
        for (n, course) in reach.former().iter().enumerate() {
            let coordinates = line_of(state, &course.cells)?;
            if coordinates.len() < 2 {
                continue;
            }
            let geometry = Geometry::LineString { coordinates };
            if state.spatial.length(&geometry).map_err(io::Error::other)? < least {
                continue;
            }
            let mut former = map_records::generated(
                state,
                Record {
                    key: &format!("river-former:{river}:{}:{n}", reach.id()),
                    name: &feature.name,
                    kind: "river",
                    layer: "rivers",
                    geometry,
                    attributes: serde_json::from_value(
                        json!({ "order": reach.order(), "regime": "dry", "former": true, "riverId": river, "sourceAlgorithm": "atlas-1" }),
                    )?,
                },
            )?;
            former.name.clone_from(&feature.name);
            state.write_network(former)?;
        }
    }
    Ok(())
}
