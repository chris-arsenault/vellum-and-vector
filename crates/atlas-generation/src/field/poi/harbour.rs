use super::{
    carry_rules,
    catalogue::CatalogueState,
    community_records::CommunityState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads, sea_shared, settlement_reads as settled, sites,
    state::State,
    values::*,
    visibility,
    work_records::{self, SitedWork},
};
use crate::{
    field::{shared::Scalar, significance::measure},
    magic::channels::Channel,
    rock::ground::GroundField,
    scale::{MapScale, RelativeMeasure},
};
use std::{io, rc::Rc};

fn land(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(state.field()?.water.borrow().kind_at(cell)? == 0)
}
fn sea(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(state.field()?.water.borrow().kind_at(cell)? == 1)
}
fn land_share(state: &impl State, cell: usize) -> io::Result<f64> {
    let mut all = 0;
    let mut met = 0;
    for edge in 0..3 {
        if let Some(next) = state.field()?.mesh.neighbor(cell, edge) {
            all += 1;
            met += usize::from(land(state, next)?);
        }
    }
    Ok(if all == 0 {
        0.0
    } else {
        met as f64 / all as f64
    })
}
fn shallows(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(sea(state, cell)?
        && (sea_shared::depth(state, cell)? < measure(&state.field()?.scale, 0.0000075, 1, 0.5)?
            || land_share(state, cell)? > 0.0))
}
fn surged(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(reads::magic_value(state, "pressure", Channel::Intensity, cell)? >= 400.0)
}
fn waters(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let mut count = 0;
    let mut waves = 0.0;
    let mut depth = 0.0f64;
    for next in
        std::iter::once(cell).chain((0..3).filter_map(|edge| field.mesh.neighbor(cell, edge)))
    {
        if !sea(state, next)? {
            continue;
        }
        count += 1;
        waves += field.shared.scalar(Scalar::WaveExposure).get(next)? / 1000.0;
        depth = depth.max(sea_shared::depth(state, next)?);
    }
    if count == 0 {
        return Ok(0.0);
    }
    let lee = 1.0 - waves / count as f64;
    let deep = if depth >= measure(&field.scale, 0.0000025, 1, 1.0)? {
        1.0
    } else {
        0.4
    };
    Ok(
        (land_share(state, cell)? + lee + deep) / 3.0
            * if surged(state, cell)? { 0.3 } else { 1.0 },
    )
}
fn serving_reach(state: &impl State) -> io::Result<f64> {
    measure(&state.field()?.scale, 0.0025, 1, 1.0)
}
fn requires(state: &impl CommunityState, cell: usize) -> io::Result<bool> {
    Ok(shallows(state, cell)? && settled::near_town(state, cell, serving_reach(state)?, 1000.0)?)
}
fn found<S: CommunityState + 'static>(state: &S) -> io::Result<Vec<Place>> {
    let shape = SitedWork {
        record: "harbor",
        layer: "transportSites",
        label: "Harbour",
        radius: RelativeMeasure::length(0.000125).map_err(io::Error::other)?,
        spacing: RelativeMeasure::length(0.0075).map_err(io::Error::other)?,
        requires: Rc::new(requires),
        suitability: Rc::new(|state, cell| Ok(waters(state, cell)?.min(1.0))),
    };
    Ok(
        work_records::work_places(state, Kind::Harbour, &shape, || Ok(Vec::new()))?
            .as_ref()
            .clone(),
    )
}
fn quay(state: &impl State) -> io::Result<f64> {
    settled::touching(state, measure(&state.field()?.scale, 0.00025, 1, 1.0)?)
}
fn shore(state: &impl State, cell: usize, reach: f64) -> io::Result<Option<usize>> {
    sites::nearest_where(&state.field()?.mesh, state.spatial(), cell, reach, |next| {
        land(state, next)
    })
}
fn magnitude(state: &impl CommunityState, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        settled::seat_people(state, place)?,
        5000.0,
    ))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, state.field()?.scale.cells(6.0), |cell| {
        waters(state, cell)
    })
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(6.0))
}
fn visible<S: CommunityState + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value("The served population, shelter, isolation and community attachment determine visibility.".into()), magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(|state: &S, place| visibility::alone_among(state, place, &found(state)?, state.field()?.scale.cells(12.0)))), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state: &S, place| {
            if state.physical().is_none() || place.anchor == usize::MAX { return Ok(0.0); }
            Ok((0.5 * magnitude(state, place)? + 0.2 * local(state, place)? + 0.3 * visibility::alone_among(state, place, &found(state)?, state.field()?.scale.cells(12.0))?).max(cultural(state, place)?))
        })),
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value("The harbour raises a quay, shelters waves and maintains Hallowed's line on the adjacent kept shore.".into()),
        terrain: Slot::Value(Rc::new(|state: &S, place| { let height = measure(&state.field()?.scale, 0.00000125, 1, 0.5)? * settled::strength(place); Ok(settled::work_reach(state, place)?.into_iter().map(|sample| FieldChange::Physical(PhysicalChange { cell: sample.cell, band: PhysicalBand::Ground(GroundField::Elevation), change: Change::Add(MapScale::native(height * sample.share)) })).collect()) })),
        water: Slot::Value(Rc::new(|_, place| Ok(vec![sheltered(place.anchor)]))), climate: Slot::NotApplicable("A quay and mole add no weather forcing."), cover: Slot::NotApplicable("The work stands in water and on bare quay."),
        magic: Slot::Value(Rc::new(|state, place| Ok(shore(state, place.anchor, quay(state)?)?.map_or_else(Vec::new, |cell| settled::kept_line(place, cell))))),
    }
}
fn sheltered(cell: usize) -> FieldChange {
    FieldChange::Physical(PhysicalChange {
        cell,
        band: PhysicalBand::Scalar(Scalar::WaveExposure),
        change: Change::AtMost(300.0),
    })
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        shallows(state, cell)
    })
}
fn moved<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Unrealized> {
    Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move))
}
fn across<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value("A captured harbour follows finer shallows, calming water and grading the nearest loading shore.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::Value(Rc::new(|state: &S, carried| {
            let Some(cell) = counterpart(state, carried)? else { return Ok(Vec::new()); };
            let mut changes = vec![sheltered(cell)];
            if let Some(land) = shore(state, cell, state.field()?.scale.cells(2.0))? { changes.push(FieldChange::GradeGround { cell: land, gradient: 0.03 }); }
            Ok(changes)
        })), counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(moved)), settle: Slot::Value(Rc::new(|state, carried| if shallows(state, carried.cell)? { Ok(Unrealized::Keep) } else { moved(state, carried) })), schedule: Slot::NotApplicable("Following the shallows requires no additional step."),
    }
}
fn roads(state: &impl State, place: &Place) -> io::Result<Vec<Cost>> {
    let mut costs = Vec::new();
    for cell in sites::within(&state.field()?.mesh, place.anchor, quay(state)?) {
        if land(state, cell)? {
            costs.push(Cost { cell, factor: 0.7 });
        }
    }
    Ok(costs)
}
fn boats(state: &impl State, place: &Place) -> io::Result<Vec<Cost>> {
    sites::within(&state.field()?.mesh, place.anchor, quay(state)?)
        .into_iter()
        .map(|cell| {
            Ok(Cost {
                cell,
                factor: if land(state, cell)? { 1.0 / 4.0 } else { 0.9 },
            })
        })
        .collect()
}
fn movement<S: State + 'static>() -> Movement<S> {
    let current: OnPlace<S, Vec<Cost>> = Rc::new(|_, place| {
        Ok(vec![Cost {
            cell: place.anchor,
            factor: 2.0,
        }])
    });
    Movement {
        statement: Must::Value("Quays ease land-sea interchange; the raised mole obstructs currents and Pressure rays.".into()), roads: Slot::Value(Rc::new(roads)), boats: Slot::Value(Rc::new(boats)), drainage: Slot::NotApplicable("The harbour stands below the drainage network."), magic: Slot::Value([(Carrier::Current, current)].into_iter().collect()), links: Slot::NotApplicable("Sea lanes supply the connection through the harbour."), crosses: Slot::Value(Rc::new(|_, _| Ok(vec![Barrier::Strait]))),
    }
}
fn serving<S: State + 'static>() -> Relation<S> {
    Relation {
        kind: Kind::Settlement,
        holds: Rc::new(|state, a, b| places::within(state, a, b, serving_reach(state)?)),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others { statement: Must::Value("A harbour serves a town and favours bays, fjords, mouths and headland shelter, but cannot stand in a crush zone.".into()), needs: Slot::Value(vec![serving()]), excludes: Slot::Value(vec![Relation { kind: Kind::CrushZone, holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))) }]), contains: Slot::NotApplicable("Mole and quay are parts of the same work."), pairs_with: Slot::Value([Kind::Bay, Kind::Fjord, Kind::RiverMouth, Kind::Headland].into_iter().map(|kind| cover_shared::near(kind, 6.0)).collect()) }
}
fn threatens(state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let field = state.field()?;
    let strained = field
        .shared
        .scalar(Scalar::TectonicStrain)
        .get(place.anchor)?
        > 0.0;
    let exposed = reads::height(field, place.anchor)? < measure(&field.scale, 0.000005, 1, 0.5)?
        && field
            .shared
            .scalar(Scalar::OceanDistance)
            .get(place.anchor)?
            < measure(&field.scale, 0.0025, 1, 1.0)?;
    let mut hazards = Vec::new();
    if strained && exposed {
        hazards.push(Hazard {
            hazard: "tsunami".into(),
            severity: 0.4,
            reach: measure(&field.scale, 0.0025, 1, 1.0)?,
        });
    }
    if surged(state, place.anchor)? {
        hazards.push(Hazard {
            hazard: "pressure surge".into(),
            reach: settled::attribute(place, "radius", 0.0).max(field.scale.cells(6.0)),
            severity: 0.7,
        });
    }
    Ok(hazards)
}
pub fn entry<S: CatalogueState<Schedule> + CommunityState + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    Entry {
        id: Kind::Harbour, group: Group::Settlements, name: "Harbour".into(), recognition: Recognition { distinct: Must::Value("A work in shore-adjacent sea joins routes and lanes; natural bays and mouths have no work record.".into()), is_a: Must::Value(Rc::new(|state, cell| places::holds_record(state, Kind::Harbour, cell, || found(state)))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Site spaced works at sheltered shores within reach of at least 1000 people.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(requires)), suitability: Slot::Value(Rc::new(|state, cell| Ok(waters(state, cell)?.min(1.0)))), places: Must::Value(Rc::new(found)) }, publication: Publication { statement: Must::Value("Publish a located harbour where the map supports its site.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(work_records::work_record)) }, across_maps: across(), event: None,
        roles: Roles { true_size: super::true_sizes::sited(&super::true_sizes::HARBOUR), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Harbour), fields: fields(), movement: movement(), others: others(),
            people: People { statement: Must::Value("The harbour provides trade and fish while exposing people to tsunamis and Pressure surges.".into()), offers: Slot::Value(Rc::new(|state, place| { let size = magnitude(state, place)?; Ok([(Benefit::Trade, size), (Benefit::Food, size / 2.0)].into_iter().collect()) })), threatens: Slot::Value(Rc::new(threatens)) },
            time: ThroughTime { statement: Must::Value("The harbour lasts while kept in the sea; abandonment or retreat leaves a shore ruin.".into()), fate: Slot::Value(Rc::new(|state, place| Ok(if settled::kept(place) && sea(state, place.anchor)? { Fate::Persists } else { Fate::Ends { leaves: Some(Kind::Ruin) } }))) }, visibility: visible(),
            naming: Naming { statement: Must::Value("The building community names its harbour for the settlement or bay; a settlement can take the harbour's name.".into()), named_by: Slot::Value(Rc::new(settled::culture)), takes_name_from: Slot::Value(vec![NameRelation { relation: serving(), chance: None }, NameRelation { relation: cover_shared::near(Kind::Bay, 6.0), chance: None }]), lends_name_to: Slot::Value(vec![serving()]), term: Slot::Unwritten },
        },
    }
}
