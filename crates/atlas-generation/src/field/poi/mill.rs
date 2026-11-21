use super::{
    carry_rules,
    catalogue::CatalogueState,
    community_records,
    contract::*,
    cover_shared,
    kinds::{AreaKind, Group, Kind},
    land_places,
    map_records::{self, Record},
    places, reads, river_courses, settlement_reads, sites,
    state::State,
    values::*,
    visibility,
    work_records::WorkState,
};
use crate::{
    features::records::Attributes,
    field::{shared::Scalar, significance::measure},
    rock::ground::GroundField,
    scale::MapScale,
};
use atlas_map::Geometry;
use std::{io, rc::Rc};

fn power(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(state.field()?.shared.scalar(Scalar::Slope).get(cell)?
        * reads::discharge(state.field()?, cell)?)
}
fn falling(state: &impl WorkState, cell: usize) -> io::Result<bool> {
    Ok(river_courses::mapped_cells(state)?.has(cell)
        && state.field()?.shared.scalar(Scalar::Slope).get(cell)? >= 0.01)
}
fn mill_site(state: &impl WorkState, anchor: usize) -> io::Result<Option<usize>> {
    let field = state.field()?;
    let mut best = None;
    let mut fall = 0.0;
    for cell in sites::within(&field.mesh, anchor, field.scale.cells(3.0)) {
        if !falling(state, cell)? {
            continue;
        }
        let amount = power(state, cell)?;
        if amount > fall {
            best = Some(cell);
            fall = amount;
        }
    }
    Ok(best)
}
fn found(state: &impl WorkState) -> io::Result<Vec<Place>> {
    Ok(state
        .held()
        .get("places:mill", || {
            if !state.regional() {
                return Ok(Vec::new());
            }
            let mut places = Vec::new();
            for seat in &state.known_places().known {
                if seat.abandoned.is_some() || seat.absorbed_by.is_some() || seat.town_people <= 0.0
                {
                    continue;
                }
                let Some(cell) = mill_site(state, seat.anchor)? else {
                    continue;
                };
                let key = format!("mill:{}", seat.anchor);
                let mut attributes = Attributes::new();
                attributes.insert("workKind".into(), "mill".into());
                attributes.insert(
                    "flow".into(),
                    reads::discharge(state.field()?, cell)?.into(),
                );
                attributes.insert("seat".into(), land_places::record_id(state, seat).into());
                let mut place = Place::at(Kind::Mill, cell, vec![cell]);
                place.id = community_records::local_id(state, &key).to_string();
                place.feature = Some(community_records::local_record(
                    state,
                    Record {
                        key: &key,
                        name: "Mill",
                        kind: "mill",
                        layer: "waterworks",
                        geometry: Geometry::Point {
                            coordinates: map_records::native_position(state, cell)?,
                        },
                        attributes,
                    },
                )?);
                places.push(place);
            }
            Ok(places)
        })?
        .as_ref()
        .clone())
}
fn magnitude(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        power(state, place.anchor)?,
        measure(&state.field()?.scale, 1.5625e-20, 3, 1.0)?,
    ))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, state.field()?.scale.cells(6.0), |cell| {
        power(state, cell)
    })
}
fn isolation(state: &impl WorkState, place: &Place) -> io::Result<f64> {
    visibility::alone_among(
        state,
        place,
        &found(state)?,
        state.field()?.scale.cells(6.0),
    )
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(6.0))
}
fn visible<S: WorkState + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value("Power, local falling water, isolation and the served town determine a mill's visibility.".into()),
        magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(local)), isolation: Slot::Value(Rc::new(isolation)), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state: &S, place| {
            if state.physical().is_none() || place.anchor == usize::MAX { return Ok(0.0); }
            Ok((0.3 * magnitude(state, place)? + 0.2 * local(state, place)? + 0.5 * isolation(state, place)?).max(cultural(state, place)?))
        })),
    }
}
fn pond(state: &impl State, cell: usize) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    Ok(vec![FieldChange::Physical(PhysicalChange {
        cell,
        band: PhysicalBand::WaterSurfaceElevations,
        change: Change::AtLeast(
            field.ground().view(GroundField::Elevation).get(cell)?
                + MapScale::native(measure(&field.scale, 0.0000005, 1, 0.5)?),
        ),
    })])
}
fn counterpart<S: CatalogueState<Schedule> + WorkState, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        falling(state, cell)
    })
}
fn across<S: CatalogueState<Schedule> + WorkState + 'static, Schedule: 'static>(
) -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value(
            "A child sites its own mills; a captured mill follows a nearby falling reach or goes."
                .into(),
        ),
        stands_on: Slot::Value(AreaKind::River),
        carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::Value(Rc::new(|state, carried| {
            match counterpart(state, carried)? {
                Some(cell) => pond(state, cell),
                None => Ok(Vec::new()),
            }
        })),
        counterpart: Slot::Value(Rc::new(counterpart)),
        unrealized: Slot::Value(Rc::new(|state, carried| {
            Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move))
        })),
        settle: Slot::NotApplicable("Mills publish after the final water round."),
        schedule: Slot::NotApplicable("A mill adds no refinement step."),
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value(
            "The weir holds a small head and returns all water below the wheel.".into(),
        ),
        terrain: Slot::NotApplicable("The mill takes the channel's existing fall."),
        water: Slot::Value(Rc::new(|state, place| pond(state, place.anchor))),
        climate: Slot::NotApplicable("The pond is too small for a resolved air exchange."),
        cover: Slot::NotApplicable("Clearance owns the fields that supply grain."),
        magic: Slot::NotApplicable("River stock passes with the returned water."),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    Movement {
        on_foot: None,
        statement: Must::Value(
            "Grain traffic wears a lane while the weir slows boats through its flash lock.".into(),
        ),
        roads: Slot::NotApplicable("Travel reads the grain lane from the ground its traffic wore."),
        boats: Slot::Value(Rc::new(|state, place| {
            carry_rules::cost_near(state, place, 3.0, 0.0)
        })),
        drainage: Slot::NotApplicable("The leat rejoins the channel below."),
        magic: Slot::NotApplicable("The wheel adds no carrier cost."),
        links: Slot::NotApplicable("A mill joins no cells."),
        crosses: Slot::NotApplicable("The weir carries no road."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value(
            "A mill serves a nearby town and benefits from a fall or upstream dam.".into(),
        ),
        needs: Slot::Value(vec![cover_shared::near(Kind::Settlement, 3.0)]),
        excludes: Slot::Value(vec![
            Relation {
                kind: Kind::Lake,
                holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
            },
            Relation {
                kind: Kind::Dam,
                holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)),
            },
        ]),
        contains: Slot::NotApplicable("A mill is one point on a river."),
        pairs_with: Slot::Value(vec![
            cover_shared::near(Kind::Waterfall, 6.0),
            cover_shared::near(Kind::Dam, 6.0),
        ]),
    }
}
fn fate(state: &impl WorkState, place: &Place) -> io::Result<Fate> {
    if !river_courses::mapped_cells(state)?.has(place.anchor) {
        return Ok(Fate::Ends { leaves: None });
    }
    let seated = place
        .feature
        .as_ref()
        .is_some_and(|f| f.attributes.contains_key("seat"));
    Ok(
        if seated && settlement_reads::gone(settlement_reads::seat(state, place)?.as_ref()) {
            Fate::Ends {
                leaves: Some(Kind::Ruin),
            }
        } else {
            Fate::Persists
        },
    )
}
pub fn entry<S: CatalogueState<Schedule> + WorkState + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    Entry {
        id: Kind::Mill, group: Group::Settlements, name: "Mill".into(),
        recognition: Recognition { distinct: Must::Value("A seated work uses falling channel water and returns it, unlike a storing dam or withdrawing irrigation work.".into()), is_a: Must::Value(Rc::new(|state, cell| places::holds_record(state, Kind::Mill, cell, || found(state)))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Each living regional town sites a mill on the strongest falling channel within three cells.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(|state, cell| Ok(falling(state, cell)? && places::settlement_within(state, cell, state.field()?.scale.cells(3.0))?))), suitability: Slot::Value(Rc::new(|state, cell| { let power = power(state, cell)?; Ok(power / (power + measure(&state.field()?.scale, 1.5625e-20, 3, 1.0)?)) })), places: Must::Value(Rc::new(found)) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Publish regional mills once after tracing ways.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(community_records::once_written)) }, across_maps: across(), event: None,
        roles: Roles {
            true_size: super::true_sizes::sited(&super::true_sizes::MILL), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Mill), fields: fields(), movement: movement(), others: others(),
            people: People { statement: Must::Value("Falling water supplies power and flour without a large impoundment hazard.".into()), offers: Slot::Value(Rc::new(|state, place| { let amount = magnitude(state, place)?; Ok([(Benefit::Power, amount), (Benefit::Food, amount / 2.0)].into_iter().collect()) })), threatens: Slot::NotApplicable("The small head supplies no resolved flood hazard.") },
            time: ThroughTime { statement: Must::Value("A mill stops when the channel moves or its seat dies, leaving foundations at an abandoned seat.".into()), fate: Slot::Value(Rc::new(fate)) }, visibility: visible(),
            naming: Naming { statement: Must::Value("The serving town names the mill; a town growing there may take its name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(vec![NameRelation { relation: cover_shared::near(Kind::Settlement, 3.0), chance: None }]), lends_name_to: Slot::Value(vec![cover_shared::near(Kind::Settlement, 3.0)]), term: Slot::Unwritten },
        },
    }
}
