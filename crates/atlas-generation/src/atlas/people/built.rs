use super::{Inputs, Occurrence, Operation, Publication};
use crate::{
    atlas::{history::Cause, state::State},
    execution::{Command, CommandKind},
    features::{Feature, FeatureSelection, Relation},
    field::poi::{
        map_records::{self, Record},
        values::Moment,
    },
    spatial::Predicate,
};
use atlas_map::{regions::rectangle, Bounds, Geometry, Position};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    Settlements,
    Site,
    Interior,
}
fn structure(
    state: &State,
    key: &str,
    name: &str,
    kind: &str,
    geometry: Geometry,
) -> io::Result<Feature> {
    map_records::generated(
        state,
        Record {
            key,
            name,
            kind,
            layer: "structures",
            geometry,
            attributes: Default::default(),
        },
    )
}
fn covered(state: &State, shape: &Geometry) -> io::Result<bool> {
    state
        .spatial
        .relation(&state.physical.field_footprint, shape, Predicate::Covers)
        .map_err(io::Error::other)
}
fn site(state: &mut State) -> io::Result<()> {
    let [x0, y0, x1, y1] = state.physical.surface.grid().bounds;
    let dx = (x1 - x0) / 5.0;
    let dy = (y1 - y0) / 5.0;
    for y in 1..=3 {
        for x in 1..=3 {
            let shape = rectangle(Bounds(
                x0 + x as f64 * dx - dx * 0.3,
                y0 + y as f64 * dy - dy * 0.3,
                x0 + x as f64 * dx + dx * 0.3,
                y0 + y as f64 * dy + dy * 0.3,
            ));
            if !covered(state, &shape)? {
                continue;
            }
            let center = x == 2 && y == 2;
            let name = if center {
                "The Wayfarer's Rest".into()
            } else {
                format!("Building {}", x + (y - 1) * 3)
            };
            let mut feature = structure(
                state,
                &format!("building:{x}:{y}"),
                &name,
                "building",
                shape,
            )?;
            feature.attributes.insert(
                "nameStatus".into(),
                if center { "proper" } else { "label" }.into(),
            );
            state.write_feature(feature)?;
        }
    }
    Ok(())
}
fn furnish(state: &mut State, room: Feature) -> io::Result<()> {
    let Bounds(a, b, c, d) = state
        .spatial
        .bounds(&room.geometry)
        .map_err(io::Error::other)?;
    let shape = rectangle(Bounds(
        a + (c - a) * 0.35,
        b + (d - b) * 0.35,
        a + (c - a) * 0.6,
        b + (d - b) * 0.6,
    ));
    let mut table = structure(
        state,
        &format!("table:{}", room.id),
        "Table",
        "furniture",
        shape,
    )?;
    table.relations = vec![Relation {
        target_id: room.id.clone(),
        kind: "inside".into(),
    }];
    state.write_feature(table)?;
    let coordinates = match room.geometry {
        Geometry::Polygon { coordinates } => coordinates.into_iter().next().unwrap_or_default(),
        _ => Vec::new(),
    };
    let wall = structure(
        state,
        &format!("wall:{}", room.id),
        &format!("{} walls", room.name),
        "wall",
        Geometry::LineString { coordinates },
    )?;
    state.write_feature(wall)?;
    Ok(())
}
fn interior(state: &mut State) -> io::Result<()> {
    let [x0, y0, x1, y1] = state.physical.surface.grid().bounds;
    let inset = (x1 - x0).min(y1 - y0) * 0.03;
    let middle = x0 + (x1 - x0) * 0.6;
    let mut rooms = state
        .records
        .features
        .values(FeatureSelection {
            area_id: Some(&state.scope.area),
            kind: Some("room"),
            ..Default::default()
        })?
        .collect::<io::Result<Vec<_>>>()?;
    if rooms.is_empty() {
        for (index, bounds) in [
            Bounds(x0 + inset, y0 + inset, middle, y1 - inset),
            Bounds(middle, y0 + inset, x1 - inset, y1 - inset),
        ]
        .into_iter()
        .enumerate()
        {
            let shape = rectangle(bounds);
            if !covered(state, &shape)? {
                continue;
            }
            let room = structure(
                state,
                &format!("room:{index}"),
                if index == 0 {
                    "Common room"
                } else {
                    "Private room"
                },
                "room",
                shape,
            )?;
            state.write_feature(room.clone())?;
            rooms.push(room);
        }
        let mut door = structure(
            state,
            "door:joining",
            "Connecting door",
            "door",
            Geometry::Point {
                coordinates: Position::xy(middle, (y0 + y1) / 2.0),
            },
        )?;
        door.relations = rooms
            .iter()
            .map(|room| Relation {
                target_id: room.id.clone(),
                kind: "connects".into(),
            })
            .collect();
        if covered(state, &door.geometry)? {
            state.write_feature(door)?;
        }
    }
    for room in rooms {
        furnish(state, room)?;
    }
    Ok(())
}
pub(super) fn operation(input: Rc<Inputs>, publication: Rc<Publication>) -> Operation {
    Command::with_inputs(
        "built.layout",
        CommandKind::Publish,
        vec![],
        move |scope, _: &Occurrence| {
            let state: &mut State = scope.state_mut();
            (input.progress)(0.0, "Laying out settlements and structures");
            match input.layout {
                Layout::Site => site(state)?,
                Layout::Interior => interior(state)?,
                Layout::Settlements => {
                    let mut places = publication.places.borrow_mut();
                    state.publish_places(&mut places, Moment::Society)?;
                    let catalogue = state.catalogue.clone();
                    places.late(state, &catalogue, Moment::Society)?;
                    state.publish_ways(input.parameters.highways as usize, |part, message| {
                        (input.progress)(part, message)
                    })?;
                }
            }
            state.causes.push(Cause::Domain {
            process: "built.layout".into(), subjects: Vec::new(), description: if input.layout == Layout::Interior {
                "Rooms, connecting doors, walls and furnishings occupy this located floor."
            } else { "Settlement and structure placement follows the requested area's geography and available habitable land." }.into(),
        });
            Ok(())
        },
    )
}
