use super::{
    kinds::Kind,
    map_records::{self, MapState, Record},
    sites,
    state::State,
    values::Place,
};
use crate::{
    features::{records::Attributes, Feature},
    field::{events::Event, geographic_contours},
    hpc::BitSet,
    lattice::Membership,
    spatial::Predicate,
};
use atlas_map::{Geometry, Position};
// hpc-exempt: sparse event identity deduplication, never cell-indexed storage.
use std::{collections::BTreeSet, io, rc::Rc};

pub fn places(
    state: &impl State,
    kind: Kind,
    stands: impl Fn(&Event) -> io::Result<bool>,
    reach: impl Fn(&Event) -> f64,
    suffix: &str,
) -> io::Result<Rc<Vec<Place>>> {
    state
        .held()
        .get(&format!("relief:events:{}", kind.as_str()), || {
            let mesh = &state.field()?.mesh;
            // hpc-exempt: sparse event identities, not cell storage.
            let mut seen = BTreeSet::new();
            let mut places = Vec::new();
            for event in &state.field()?.events {
                if seen.contains(&event.id) || !stands(event)? {
                    continue;
                }
                let Some(anchor) = mesh.cell_at(event.x, event.y) else {
                    continue;
                };
                let cells = sites::within(mesh, anchor, reach(event))
                    .into_iter()
                    .filter(|&cell| mesh.membership(cell) == Membership::Content)
                    .collect::<Vec<_>>();
                if cells.is_empty() {
                    continue;
                }
                seen.insert(event.id.clone());
                let mut place = Place::at(kind, anchor, cells);
                place.id = format!("{}{suffix}", event.id);
                places.push(place);
            }
            Ok(places)
        })
}
pub fn on_places(
    state: &impl State,
    kind: Kind,
    cell: usize,
    places: impl FnOnce() -> io::Result<Vec<Place>>,
) -> io::Result<bool> {
    let cells = state
        .held()
        .get(&format!("relief:on:{}", kind.as_str()), || {
            let mut cells = BitSet::new(state.field()?.mesh.len());
            for place in places()? {
                for cell in place.cells {
                    cells.add(cell);
                }
            }
            Ok(cells)
        })?;
    Ok(cells.has(cell))
}
pub fn event_of<'a>(state: &'a impl State, place: &Place) -> io::Result<Option<&'a Event>> {
    Ok(state
        .field()?
        .events
        .iter()
        .find(|event| place.id == event.id || place.id.starts_with(&format!("{}:", event.id))))
}
pub struct Shape<'a> {
    pub kind: &'a str,
    pub name: String,
    pub share: f64,
    pub located: bool,
    pub attributes: Attributes,
}
pub fn record(
    state: &impl MapState,
    place: &Place,
    shape: Shape<'_>,
) -> io::Result<Option<Feature>> {
    let Some(event) = event_of(state, place)? else {
        return Ok(None);
    };
    let [ox, oy] = state.field()?.mesh.origin();
    let center = state
        .chart()
        .position(Position::XYZ([ox + event.x, oy + event.y, 0.0]));
    let point = Geometry::Point {
        coordinates: center,
    };
    let radius = event.radius * shape.share;
    let disk = state
        .spatial()
        .buffer(&point, radius)
        .map_err(io::Error::other)?;
    let Some(disk) = geographic_contours::clip(state, disk)? else {
        return Ok(None);
    };
    let [x, y, z] = center.coordinates();
    let mut attributes = Attributes::new();
    for (key, value) in [
        ("sourceAlgorithm", serde_json::json!("atlas-1")),
        ("causeId", serde_json::json!(event.id)),
        ("radius", serde_json::json!(radius)),
        ("center", serde_json::json!({"x":x,"y":y,"z":z})),
        ("epoch", serde_json::json!(event.epoch)),
        ("strength", serde_json::json!(event.strength)),
    ] {
        attributes.insert(key.into(), value);
    }
    attributes.extend(shape.attributes);
    let mut feature = map_records::generated(
        state,
        Record {
            key: &place.id,
            name: &shape.name,
            kind: shape.kind,
            layer: "geology",
            geometry: disk,
            attributes,
        },
    )?;
    if shape.located
        && state
            .spatial()
            .relation(&point, state.footprint(), Predicate::Intersects)
            .map_err(io::Error::other)?
    {
        feature.footprint = Some(feature.geometry);
        feature.geometry = point;
    }
    Ok(Some(feature))
}
