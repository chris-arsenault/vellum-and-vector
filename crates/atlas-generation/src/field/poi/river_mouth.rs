use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    kinds::{AreaKind, Group, Kind},
    map_records, places, reads,
    river_courses::{self, RiverState},
    sites,
    state::State,
    values::*,
    visibility, water_reads,
};
use crate::{
    field::{shared::Scalar, significance::measure},
    hpc::BitSet,
    rock::ground::GroundField,
    water::network::RIVER_DISCHARGE,
};
use std::{io, rc::Rc};
const FAN_GRADIENT: f64 = 0.001;
const REACH_TO_SEA: f64 = 3.0;
fn sea_beside(state: &impl State, cell: usize) -> io::Result<Option<usize>> {
    let field = state.field()?;
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            if field.water().column.kind.get(next)? == 1 {
                return Ok(Some(next));
            }
        }
    }
    Ok(None)
}
fn is_a(state: &impl RiverState, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    if field.water().column.kind.get(cell)? != 0 || !river_courses::mapped_cells(state)?.has(cell) {
        return Ok(false);
    }
    match water_reads::flow_target(field, cell)? {
        Some(target) => Ok(field.water().column.kind.get(target)? == 1),
        None => Ok(sea_beside(state, cell)?.is_some()),
    }
}
fn found(state: &impl RiverState) -> io::Result<Vec<Place>> {
    Ok(
        places::cell_places(state, Kind::RiverMouth, |cell| is_a(state, cell))?
            .as_ref()
            .clone(),
    )
}
pub fn river_mouth_form(state: &impl State, cell: usize) -> io::Result<&'static str> {
    Ok(
        if state
            .field()?
            .shared
            .scalar(Scalar::DeltaIntensity)
            .get(cell)?
            > 0.0
        {
            "delta"
        } else {
            "estuary"
        },
    )
}
fn delta(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(state
        .field()?
        .shared
        .scalar(Scalar::DeltaIntensity)
        .get(cell)?
        / 1000.0)
}
fn greatness(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    Ok(visibility::sized(
        reads::discharge(field, place.anchor)?,
        measure(&field.scale, RIVER_DISCHARGE, 3, 1.0)?,
    ))
}
fn around(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(8.0))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, around(state)?, |cell| {
        reads::discharge(state.field()?, cell)
    })
}
fn isolation(state: &impl RiverState, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn toward_sea(state: &impl State, cell: usize) -> io::Result<Option<usize>> {
    let field = state.field()?;
    if let Some(target) = water_reads::flow_target(field, cell)? {
        return Ok(Some(target));
    }
    let distance = field.shared.scalar(Scalar::OceanDistance);
    let own = distance.get(cell)?;
    let mut least = if own < 0.0 { f64::INFINITY } else { own };
    let mut best = None;
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            let d = distance.get(next)?;
            if d >= 0.0 && d < least {
                best = Some(next);
                least = d;
            }
        }
    }
    Ok(best)
}
fn land_to_sea<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    start: usize,
) -> io::Result<Vec<usize>> {
    let field = state.field()?;
    let steps = REACH_TO_SEA * state.parent_cell_span() / field.scale.cells(1.0);
    let mut path = Vec::new();
    let mut seen = BitSet::new(field.mesh.len());
    let mut cell = Some(start);
    while let Some(at) = cell {
        if field.water().column.kind.get(at)? == 1 {
            return Ok(path);
        }
        if seen.has(at) || path.len() as f64 > steps {
            break;
        }
        path.push(at);
        seen.add(at);
        cell = toward_sea(state, at)?;
    }
    Ok(Vec::new())
}
fn channel_to_sea<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let mapped = river_courses::mapped_cells(state)?;
    let start = sites::nearest_where(
        &field.mesh,
        state.spatial(),
        carried.cell,
        state.parent_cell_span(),
        |cell| Ok(mapped.has(cell)),
    )?
    .unwrap_or(carried.cell);
    let path = land_to_sea(state, start)?;
    let Some(&first) = path.first() else {
        return Ok(Vec::new());
    };
    let sea = field.water().effective_sea_level;
    let head = sea.max(field.ground().view(GroundField::Elevation).get(first)?);
    Ok(path
        .iter()
        .enumerate()
        .map(|(at, &cell)| {
            FieldChange::Physical(PhysicalChange {
                cell,
                band: PhysicalBand::Ground(GroundField::Elevation),
                change: Change::AtMost(
                    sea + (head - sea) * (path.len() - at) as f64 / path.len() as f64,
                ),
            })
        })
        .collect())
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        is_a(state, cell)
    })
}
fn where_it_stands<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Unrealized> {
    if let Some(cell) = counterpart(state, carried)? {
        return Ok(Unrealized::Move(cell));
    }
    let field = state.field()?;
    let sea = sites::nearest_where(
        &field.mesh,
        state.spatial(),
        carried.cell,
        state.parent_cell_span(),
        |cell| Ok(field.water().column.kind.get(cell)? == 1),
    )?;
    Ok(if sea.is_some() {
        Unrealized::Keep
    } else {
        Unrealized::Drop
    })
}
fn fan(state: &impl State, place: &Place) -> io::Result<Vec<usize>> {
    let field = state.field()?;
    let mut cells = Vec::new();
    for cell in sites::within(&field.mesh, place.anchor, around(state)?) {
        if delta(state, cell)? > 0.0 && field.water().column.kind.get(cell)? == 0 {
            cells.push(cell);
        }
    }
    Ok(cells)
}
fn held_fan(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    Ok(fan(state, place)?
        .into_iter()
        .map(|cell| FieldChange::GradeGround {
            cell,
            gradient: FAN_GRADIENT,
        })
        .collect())
}
fn open_sea(state: &impl State, place: &Place) -> io::Result<f64> {
    match sea_beside(state, place.anchor)? {
        Some(sea) => Ok(state
            .field()?
            .shared
            .scalar(Scalar::WaveExposure)
            .get(sea)?
            / 1000.0),
        None => Ok(0.0),
    }
}
fn near<S: State + 'static>(kind: Kind, spans: f64) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |state, a, b| {
            places::within(state, a, b, state.field()?.scale.cells(spans))
        }),
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value(
            "The sea sets the river's base level; the delta holds its fan nearly flat.".into(),
        ),
        terrain: Slot::Value(Rc::new(held_fan)),
        water: Slot::NotApplicable("Routing and delta processes own channels and orders."),
        climate: Slot::NotApplicable("Coastal air reaches inland independently of the river."),
        cover: Slot::NotApplicable("Ecology reads delta intensity for marsh cover."),
        magic: Slot::NotApplicable("River carriage accounts for stock leaving into the sea."),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    Movement {
        statement: Must::Value("Estuaries pass boats cheaply, delta channels slow them and soft ground costs roads; drainage is drawn to the mouth.".into()),
        roads: Slot::Value(Rc::new(|state, place| fan(state, place)?.into_iter().map(|cell| Ok(Cost { cell, factor: 1.0 + 3.0 * delta(state, cell)? })).collect())),
        boats: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, if river_mouth_form(state, place.anchor)? == "delta" { 1.5 } else { 0.7 }, state.field()?.scale.cells(2.0)))),
        drainage: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.7, 0.0))),
        magic: Slot::NotApplicable("River carriage ends at the sea without a cost modifier."), links: Slot::NotApplicable("Ferries belong to roads."), crosses: Slot::NotApplicable("Routes avoid the widest soft river reach."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value(
            "Towns and harbours meet the river at sea, beside wetlands, bays or fjords.".into(),
        ),
        needs: Slot::NotApplicable("Recognition requires river and sea."),
        excludes: Slot::Value(vec![Relation {
            kind: Kind::Lake,
            holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
        }]),
        contains: Slot::NotApplicable("The fan is the last river cell's ground."),
        pairs_with: Slot::Value(vec![
            near(Kind::Harbour, 3.0),
            near(Kind::Settlement, 8.0),
            near(Kind::Wetland, 3.0),
            near(Kind::Bay, 3.0),
            near(Kind::Fjord, 3.0),
        ]),
    }
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value(
            "Inland and sea trade meet on fertile delta ground exposed to storm surge and floods."
                .into(),
        ),
        offers: Slot::Value(Rc::new(|state, place| {
            let great = greatness(state, place)?;
            Ok([
                (Benefit::Trade, great),
                (
                    Benefit::Food,
                    (great / 2.0).max(delta(state, place.anchor)? * great),
                ),
                (Benefit::Water, great / 2.0),
            ]
            .into_iter()
            .collect())
        })),
        threatens: Slot::Value(Rc::new(|state, place| {
            Ok(vec![Hazard {
                hazard: "storm surge and river flood".into(),
                reach: around(state)? / 2.0,
                severity: open_sea(state, place)?.max(greatness(state, place)? / 2.0),
            }])
        })),
    }
}
fn through_time<S: RiverState + 'static>() -> ThroughTime<S> {
    ThroughTime {
        statement: Must::Value("A mouth follows the shore; a river that stops reaching sea leaves its delta as wetland.".into()),
        fate: Slot::Value(Rc::new(|state, place| Ok(if is_a(state, place.anchor)? { Fate::Persists }
            else { Fate::Ends { leaves: if delta(state, place.anchor)? > 0.0 { Some(Kind::Wetland) } else { None } } }))),
    }
}
fn visible<S: RiverState + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "Flow, contrast with nearby streams and port towns dominate isolation.".into(),
        ),
        magnitude: Slot::Value(Rc::new(greatness)),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(isolation)),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| {
            Ok((0.6 * greatness(state, place)?
                + 0.3 * local(state, place)?
                + 0.1 * isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::RiverMouth, group: Group::Water, name: "River mouth".into(),
        recognition: Recognition { distinct: Must::Value("A drawn retained river's last land cell targets sea or ends beside it; lake inflow and frame exits are not mouths.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("A river reaching sea forms a delta or estuary according to its sediment and receiving water.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Recognition reads river and shore."), suitability: Slot::NotApplicable("The ground determines the meeting."), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Publish the river-sea meeting with form and discharge.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(|state: &S, place: &Place| {
            let mut attributes = crate::features::records::Attributes::new();
            attributes.insert("form".into(), river_mouth_form(state, place.anchor)?.into()); attributes.insert("discharge".into(), reads::discharge(state.field()?, place.anchor)?.into());
            map_records::site(state, place, "riverMouth", "geology", "River mouth", attributes)
        })) },
        across_maps: AcrossMaps {
            statement: Must::Value("The finer river gets an unbroken fall to the shore; the place follows its developed mouth and goes only when no sea remains near.".into()), stands_on: Slot::Value(AreaKind::River),
            carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::Value(Rc::new(channel_to_sea)), counterpart: Slot::Value(Rc::new(counterpart)),
            unrealized: Slot::Value(Rc::new(where_it_stands)), settle: Slot::Value(Rc::new(where_it_stands)), schedule: Slot::NotApplicable("Realized ground supplies the fall without a separate step."),
        }, event: None,
        roles: Roles {
            true_size: super::true_sizes::sited(&super::true_sizes::RIVER_MOUTH), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::RiverMouth),
            fields: fields(), movement: movement(), others: others(), people: people(), time: through_time(), visibility: visible(),
            naming: Naming { statement: Must::Value("People name it after the river and towns take the mouth's name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::NotApplicable("The river is not a place in this catalogue."), lends_name_to: Slot::Value(vec![near(Kind::Settlement, 8.0)]), term: Slot::Unwritten },
        },
    }
}
