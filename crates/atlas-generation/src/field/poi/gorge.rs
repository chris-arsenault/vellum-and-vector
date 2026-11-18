use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{AreaKind, Group, Kind},
    places, reads, records,
    relief_landmarks::{self as landmarks, LandmarkState},
    relief_shape as shape,
    river_courses::{self, RiverState},
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{
        landforms::Settings,
        landmarks::{
            canyon::{self, Canyon},
            catalogue::Kind as LandmarkKind,
        },
        shared::{CellCode, Scalar},
        significance::measure,
    },
    hpc::BitSet,
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};

pub trait GorgeState: LandmarkState + RiverState {
    fn landform_settings(&self) -> &Settings;
}
fn floors(state: &impl LandmarkState) -> io::Result<Rc<BitSet>> {
    state.held().get("relief:canyonFloors", || {
        let field = state.field()?;
        let mut floors = BitSet::new(field.mesh.len());
        for placed in landmarks::landmarks_of(state, LandmarkKind::Canyon)?.iter() {
            let p = &placed.landmark.parameters;
            let input = Canyon {
                id: placed.landmark.id.clone(),
                path: placed.path.clone(),
                rim_width_km: p["rimWidth"],
                depth_metres: p["depth"],
                capture_distance_km: p["captureDistance"],
            };
            let corridor = field
                .landmark_ledger
                .iter()
                .find(|r| r.id == placed.landmark.id)
                .map_or(&[][..], |r| r.corridor.as_slice());
            for cell in canyon::floor_cells(field, &input, corridor, state.spatial())? {
                floors.add(cell);
            }
        }
        Ok(floors)
    })
}
fn is_a(state: &impl GorgeState, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    if field.water().column.kind.get(cell)? != 0 {
        return Ok(false);
    }
    let code = field.shared.code(CellCode::LandformCodes).get(cell)?;
    Ok(code == 16
        || (code == 17
            && field.with_landscape(|landscape| {
                landscape.incised_reach(cell, state.landform_settings())
            })?)
        || floors(state)?.has(cell))
}
fn incision(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(MapScale::metres(
        state
            .field()?
            .shared
            .scalar(Scalar::CumulativeFluvialErosion)
            .get(cell)?,
        LengthUnit::Native,
    ))
}
fn found(state: &impl GorgeState) -> io::Result<Vec<Place>> {
    Ok(places::region_places(
        state,
        Kind::Gorge,
        |cell| is_a(state, cell),
        |cell| incision(state, cell),
    )?
    .as_ref()
    .clone())
}
fn magnitude(state: &impl State, place: &Place) -> io::Result<f64> {
    let scale = &state.field()?.scale;
    let evidence = shape::evidence(state, place)?;
    Ok(
        (visibility::sized(evidence.span, measure(scale, 0.025, 1, 1.0)?)
            + visibility::sized(evidence.relief, measure(scale, 0.000075, 1, 0.5)?))
            / 2.0,
    )
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, state.field()?.scale.cells(6.0), |cell| {
        incision(state, cell)
    })
}
fn isolation(state: &impl GorgeState, place: &Place) -> io::Result<f64> {
    visibility::alone_among(
        state,
        place,
        &found(state)?,
        state.field()?.scale.cells(12.0),
    )
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(8.0))
}
fn water_size(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        reads::discharge(state.field()?, place.anchor)?,
        measure(&state.field()?.scale, 3.90625e-18, 3, 1.0)?,
    ))
}
fn counterpart<S: GorgeState + CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        is_a(state, cell)
    })
}
fn across<S: GorgeState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Names resolve on the child's incised river; a canyon record remains even when its counterpart is absent.".into()), stands_on: Slot::Value(AreaKind::River), carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), counterpart: Slot::Value(Rc::new(counterpart)), realize: Slot::NotApplicable("Captured ground develops without restoring parent heights."), unrealized: Slot::Value(Rc::new(|state, carried| {
        if let Some(cell) = counterpart(state, carried)? { return Ok(Unrealized::Move(cell)); }
        Ok(if carried.feature.kind == "landmark" && carried.feature.attributes.get("landmarkKind").and_then(|v| v.as_str()) == Some("canyon") { Unrealized::Keep } else { Unrealized::Drop })
    })), settle: Slot::NotApplicable("Incision is booked over epochs rather than each round's water."), schedule: Slot::NotApplicable("The canyon's landmark cause owns its steps.") }
}
fn fields<S>() -> Fields<S> {
    Fields { statement: Must::Value("The incised floor and resistant walls confine the river; their existing process owners supply the changes.".into()), terrain: Slot::NotApplicable("Fluvial incision and canyon maintenance cut the floor."), water: Slot::NotApplicable("Floodplain spreading already reads its maximum slope."), climate: Slot::NotApplicable("Local shade and damp have no climate band."), cover: Slot::NotApplicable("Ecology reads slope and soil on the walls."), magic: Slot::NotApplicable("Stock follows its existing river carrier.") }
}
fn movement<S: State + 'static>() -> Movement<S> {
    let river: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 0.8, 0.0));
    Movement { on_foot: None, statement: Must::Value("The confined gorge obstructs roads and boats while drawing drainage and river-borne stock along it.".into()), roads: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 3.0, 0.0))), boats: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 2.0, 0.0))), drainage: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.15, 0.0))), magic: Slot::Value([(Carrier::River, river)].into_iter().collect()), links: Slot::NotApplicable("A gorge joins no fixed pair of cells."), crosses: Slot::NotApplicable("A bridge crosses the gorge; the gorge is the barrier.") }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value(
            "Gorges hold falls, meet bridges and cut through scarps and plateaus into valleys."
                .into(),
        ),
        needs: Slot::NotApplicable("Recognition reads the river, or a canyon captures its own."),
        excludes: Slot::Value(vec![Relation {
            kind: Kind::Lake,
            holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
        }]),
        contains: Slot::Value(cover_shared::holds(&[Kind::Waterfall])),
        pairs_with: Slot::Value(vec![
            cover_shared::near(Kind::Valley, 4.0),
            cover_shared::near(Kind::Escarpment, 6.0),
            cover_shared::near(Kind::Plateau, 6.0),
            cover_shared::near(Kind::Bridge, 2.0),
        ]),
    }
}
fn visible<S: GorgeState + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "Length, depth, local incision, isolation and people determine visibility.".into(),
        ),
        magnitude: Slot::Value(Rc::new(magnitude)),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(isolation)),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| {
            Ok((0.6 * magnitude(state, place)?
                + 0.25 * local(state, place)?
                + 0.15 * isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
pub fn entry<S: GorgeState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    Entry { id: Kind::Gorge, group: Group::Relief, name: "Gorge".into(), recognition: Recognition { distinct: Must::Value("A steep deeply incised river, including where a waterfall's class takes precedence, or the actual floor of a captured canyon.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten }, existence: Existence { origins: Slot::Unwritten, statement: Must::Value("River incision makes gorges; landmark siting captures a river into a canyon beside high ground.".into()), way: Must::Value(ExistenceWay::Both), requires: Slot::Value(Rc::new(|state, cell| landmarks::admits(state, LandmarkKind::Canyon, cell))), suitability: Slot::Value(Rc::new(|state, cell| landmarks::suits(state, LandmarkKind::Canyon, cell))), places: Must::Value(Rc::new(found)) }, publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("A gorge publishes its river course; a canyon record publishes once through the landmark.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(|state: &S, place: &Place| { if floors(state)?.has(place.anchor) { Ok(None) } else { records::course(state, place, records::Shape { kind: "gorge", name: "Gorge", layer: "geology", attributes: Default::default() }) } })) }, across_maps: across(), event: None,
        roles: Roles { true_size: super::true_sizes::extent(), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Gorge), fields: fields(), movement: movement(), others: others(), people: People { statement: Must::Value("The walls defend ground and confine floods; the river supplies power and the gorge inspires sanctity.".into()), offers: Slot::Value(Rc::new(|state, place| { let great = magnitude(state, place)?; Ok([(Benefit::Defence, great), (Benefit::Power, water_size(state, place)?), (Benefit::Sanctity, great / 2.0)].into_iter().collect()) })), threatens: Slot::Value(Rc::new(|state: &S, place| Ok(vec![Hazard { hazard: "flash flood".into(), reach: state.field()?.scale.cells(4.0), severity: water_size(state, place)? }]))) }, time: ThroughTime { statement: Must::Value("A gorge persists on a mapped river and otherwise becomes a valley.".into()), fate: Slot::Value(Rc::new(|state, place| Ok(if river_courses::mapped_cells(state)?.has(place.anchor) { Fate::Persists } else { Fate::Becomes(Kind::Valley) }))) }, visibility: visible(), naming: Naming { statement: Must::Value("Local people name the gorge; its falls and nearby towns can borrow that name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::NotApplicable("Rivers are not catalogue places."), lends_name_to: Slot::Value(vec![cover_shared::holds(&[Kind::Waterfall]).remove(0), cover_shared::near(Kind::Settlement, 6.0)]), term: Slot::Unwritten } },
    }
}
