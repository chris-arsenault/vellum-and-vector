use super::{
    community_records,
    kinds::Kind,
    map_records::{self, Record},
    reads, river_courses,
    values::Place,
    work_records::WorkState,
};
use crate::{
    features::records::Attributes,
    field::{people::place_country::WayKind, significance::measure},
    hpc::BitSet,
    storage::Band,
};
use atlas_map::Geometry;
use std::{io, rc::Rc};
pub const TRACK_TRAVELLERS: f64 = 10.0;
pub const ROAD_TRAVELLERS: f64 = 100.0;
pub const FORD_COST: f64 = 3.0;
pub const BRIDGE_FLOW: f64 = 3.125e-19;
#[derive(Default)]
pub struct Crossings {
    pub ford: Vec<Place>,
    pub bridge: Vec<Place>,
}
fn crosses(state: &impl WorkState, cell: usize) -> io::Result<bool> {
    Ok(state.field()?.water().column.kind.get(cell)? == 0
        && river_courses::mapped_cells(state)?.has(cell))
}
fn way_crossings(state: &impl WorkState) -> io::Result<(Band<f64>, Band<f64>)> {
    let field = state.field()?;
    let mut all = field.coverage.borrow_mut().allocate(0.0);
    let mut road = field.coverage.borrow_mut().allocate(0.0);
    for way in state.known_ways().iter() {
        if !matches!(way.kind, WayKind::Road | WayKind::Track) {
            continue;
        }
        let mut run = 0;
        for (n, &cell) in way.cells.iter().enumerate() {
            run = if crosses(state, cell)? { run + 1 } else { 0 };
            let ends = n + 1 == way.cells.len() || !crosses(state, way.cells[n + 1])?;
            if run == 0 || !ends || run > 2 {
                continue;
            }
            let at = way.cells[n - run + 1];
            all.set(at, all.get(at)? + way.travellers)?;
            if way.kind == WayKind::Road {
                road.set(at, road.get(at)? + way.travellers)?;
            }
        }
    }
    Ok((all, road))
}
fn crossing(
    state: &impl WorkState,
    cell: usize,
    travellers: f64,
    bridge: bool,
) -> io::Result<Place> {
    let kind = if bridge { Kind::Bridge } else { Kind::Ford };
    let key = format!("crossing:{cell}");
    let mut attributes = Attributes::new();
    attributes.insert("workKind".into(), kind.as_str().into());
    attributes.insert(
        "flow".into(),
        reads::discharge(state.field()?, cell)?.into(),
    );
    attributes.insert("travellers".into(), travellers.into());
    let feature = community_records::local_record(
        state,
        Record {
            key: &key,
            name: if bridge { "Bridge" } else { "Ford" },
            kind: kind.as_str(),
            layer: "transportSites",
            geometry: Geometry::Point {
                coordinates: map_records::native_position(state, cell)?,
            },
            attributes,
        },
    )?;
    let mut place = Place::at(kind, cell, vec![cell]);
    place.id = community_records::local_id(state, &key).to_string();
    place.feature = Some(feature);
    Ok(place)
}
pub fn crossings(state: &impl WorkState) -> io::Result<Rc<Crossings>> {
    state.held().get("places:crossings", || {
        let mut found = Crossings::default();
        if !state.regional() {
            return Ok(found);
        }
        let field = state.field()?;
        let (all, road) = way_crossings(state)?;
        let mut seats = BitSet::new(field.mesh.len());
        for place in &state.known_places().known {
            seats.add(place.anchor);
        }
        let threshold = measure(&field.scale, BRIDGE_FLOW, 3, 1.0)?;
        for cell in 0..field.mesh.len() {
            let travellers = all.get(cell)?;
            if travellers <= 0.0 || seats.has(cell) {
                continue;
            }
            let bridge = road.get(cell)? > 0.0 && reads::discharge(field, cell)? >= threshold;
            let place = crossing(state, cell, travellers, bridge)?;
            if bridge {
                found.bridge.push(place);
            } else {
                found.ford.push(place);
            }
        }
        Ok(found)
    })
}
pub fn all(state: &impl WorkState) -> io::Result<Vec<Place>> {
    let c = crossings(state)?;
    Ok(c.ford.iter().chain(&c.bridge).cloned().collect())
}
