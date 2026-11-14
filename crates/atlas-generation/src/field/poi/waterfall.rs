//! The waterfall catalogue entry binds its existing origin, owner, carry and publication rules.
use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    fall_forms::Form,
    fall_origins, fall_shape, fall_size,
    kinds::{AreaKind, Group, Kind},
    map_records, origins, places, reads,
    values::*,
    visibility,
};
use crate::{
    field::significance::{measure, FALLS_DISCHARGE, FALLS_DROP},
    rock::ground::queries::SurfaceResponse,
};
use std::{io, rc::Rc};

fn claims<S: CatalogueState<Schedule>, Schedule>(state: &S) -> io::Result<Rc<origins::Claims>> {
    let entry = state.catalogue().get(Kind::Waterfall);
    origins::claims(
        state,
        Kind::Waterfall,
        entry
            .existence
            .origins
            .value()
            .map_or(&[], |v| v.as_slice()),
        |kind| {
            state
                .catalogue()
                .get(kind)
                .publication
                .moment
                .value()
                .is_some_and(|&moment| origins::reached(state, moment))
        },
    )
}
fn found<S: CatalogueState<Schedule>, Schedule>(state: &S) -> io::Result<Vec<Place>> {
    Ok(origins::places(Kind::Waterfall, claims(state)?.as_ref()))
}
fn is_a<S: CatalogueState<Schedule>, Schedule>(state: &S, cell: usize) -> io::Result<bool> {
    Ok(claims(state)?.contains(cell))
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        is_a(state, cell)
    })
}
fn height(state: &impl fall_size::FallState, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        fall_size::of(state, place)?.height,
        measure(&state.field()?.scale, FALLS_DROP, 1, 0.5)?,
    ))
}
fn flow(state: &impl fall_size::FallState, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        reads::discharge(state.field()?, place.anchor)?,
        measure(&state.field()?.scale, FALLS_DISCHARGE, 3, 1.0)?,
    ))
}
fn greatness(state: &impl fall_size::FallState, place: &Place) -> io::Result<f64> {
    Ok((height(state, place)? + flow(state, place)?) / 2.0)
}
fn around(state: &impl super::state::State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(6.0))
}
fn local(state: &impl fall_size::FallState, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, around(state)?, |cell| {
        state
            .field()?
            .with_landscape(|land| land.river_gradient(cell))
    })
}
fn isolation<S: CatalogueState<Schedule>, Schedule>(state: &S, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl fall_size::FallState, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn name_term(state: &impl fall_size::FallState, place: &Place) -> io::Result<NameTerm> {
    let system = fall_size::of(state, place)?.members > 1.0;
    let term = match (fall_shape::form_in(state, place)?, system) {
        (Form::Plunge, _) => "Falls",
        (Form::Cataract, false) => "Cataract",
        (Form::Cataract, true) => "Cataracts",
        (Form::Cascade, false) => "Cascade",
        (Form::Cascade, true) => "Cascades",
        (Form::Ribbon, false) => "Veil",
        (Form::Ribbon, true) => "Veils",
        (Form::Chute, false) => "Chute",
        (Form::Chute, true) => "Chutes",
    };
    Ok(NameTerm {
        kind: NameKind::Landform,
        subkind: Some("waterfall".into()),
        term: Some(term.into()),
    })
}
fn record(
    state: &(impl super::map_records::MapState + fall_size::FallState),
    place: &Place,
) -> io::Result<Option<crate::features::Feature>> {
    let mut attributes = crate::features::records::Attributes::new();
    attributes.insert("drop".into(), fall_size::of(state, place)?.height.into());
    attributes.insert(
        "discharge".into(),
        reads::discharge(state.field()?, place.anchor)?.into(),
    );
    map_records::site(
        state,
        place,
        "waterfall",
        "geology",
        "Waterfall",
        attributes,
    )
}
fn fields<S: CatalogueState<Schedule> + 'static, Schedule>() -> Fields<S> {
    Fields {
        statement: Must::Value("A fall holds its step and works the surrounding ground by its form; wet rock beside the lip grows nothing.".into()),
        terrain: Slot::Value(Rc::new(fall_shape::shaped)),
        water: Slot::NotApplicable("It keeps the discharge it receives; only the height of the bed changes."),
        climate: Slot::NotApplicable("Its spray is below what the climate field resolves."),
        cover: Slot::Value(Rc::new(fall_shape::wet_rock)),
        magic: Slot::NotApplicable("The river's own carriage passes magic."),
    }
}
fn movement<S: CatalogueState<Schedule> + 'static, Schedule>() -> Movement<S> {
    Movement {
        statement: Must::Value("Boats portage round a fall; roads read its river.".into()),
        roads: Slot::NotApplicable("Road crossing costs read the river."),
        boats: Slot::Value(Rc::new(|state, place| {
            carry_rules::cost_near(state, place, f64::INFINITY, 0.0)
        })),
        drainage: Slot::NotApplicable(
            "The network already runs through it; it only steps the bed.",
        ),
        magic: Slot::NotApplicable("A river's carried magic passes over a fall."),
        links: Slot::NotApplicable("A portage is a road's own way round it."),
        crosses: Slot::NotApplicable("A fall is no crossing; fords and bridges are."),
    }
}
fn nearby<S: CatalogueState<Schedule> + 'static, Schedule>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|state, a, b| places::within(state, a, b, around(state)?)),
    }
}
fn others<S: CatalogueState<Schedule> + 'static, Schedule>() -> Others<S> {
    Others {
        statement: Must::Value("A fall stands on a river, often in a gorge; it supplies a nearby mill's head and an upstream dam reduces its water.".into()),
        needs: Slot::NotApplicable("Recognition already requires its river."),
        excludes: Slot::Value(vec![Relation { kind: Kind::Lake, holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))) }]),
        contains: Slot::NotApplicable("A fall is one point of a river."),
        pairs_with: Slot::Value(vec![Relation { kind: Kind::Gorge, holds: Rc::new(|_, a, b| Ok(places::holds(b, a))) }, nearby(Kind::Mill)]),
    }
}
fn visibility<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value("Drop, discharge and a break in the river's gradient show a fall; a portage town carries a small one.".into()),
        magnitude: Slot::Value(Rc::new(greatness)), local_conditions: Slot::Value(Rc::new(local)), isolation: Slot::Value(Rc::new(isolation)), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| Ok((0.5 * greatness(state, place)? + 0.3 * local(state, place)? + 0.2 * isolation(state, place)?).max(cultural(state, place)?)))),
    }
}
fn across_maps<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> AcrossMaps<S, Schedule>
{
    AcrossMaps {
        statement: Must::Value("A captured fall keeps its river's identity and source position; the finer ground holds its step on the retained river.".into()),
        stands_on: Slot::Value(AreaKind::River), carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::Value(Rc::new(|state, carried| match state.hosted_cell(&carried.feature)? {
            Some(cell) => fall_shape::carried_step(state, cell, carried.feature.attributes.get("drop").and_then(|v| v.as_f64()).unwrap_or(0.0)), None => Ok(Vec::new()),
        })),
        counterpart: Slot::Value(Rc::new(counterpart)),
        unrealized: Slot::Value(Rc::new(|state, carried| Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)))),
        settle: Slot::NotApplicable("A fall changes with epoch erosion, not a round's water."),
        schedule: Slot::NotApplicable("Its step is a realized change, not a refinement schedule step."),
    }
}
fn roles<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Roles<S> {
    Roles {
        true_size: Slot::Value(TrueSize {
            statement: "A coarse record represents the fall or system in that river stretch."
                .into(),
            size: Rc::new(|state, place| {
                let size = fall_size::of(state, place)?;
                Ok(Size {
                    height: Some(size.height),
                    width: Some(size.width),
                    length: Some(size.length),
                })
            }),
            represents: Rc::new(|state, place| Ok(fall_size::of(state, place)?.members as usize)),
        }),
        variety: Slot::Value(Variety {
            statement: "The rock and water give the fall its form.".into(),
            of: Rc::new(|state, place| Ok(fall_shape::choose_form(state, place)?.name().into())),
        }),
        appearance: Slot::Unwritten,
        account: Slot::Unwritten,
        fields: fields(),
        movement: movement(),
        others: others(),
        visibility: visibility(),
        people: People {
            statement: Must::Value(
                "A fall offers power and awe, and a portage where towns grow.".into(),
            ),
            offers: Slot::Value(Rc::new(|state, place| {
                Ok([
                    (Benefit::Power, height(state, place)?),
                    (Benefit::Sanctity, greatness(state, place)? / 2.0),
                    (Benefit::Trade, flow(state, place)? / 2.0),
                ]
                .into_iter()
                .collect())
            })),
            threatens: Slot::NotApplicable("A fall endangers only those on the river above it."),
        },
        time: ThroughTime {
            statement: Must::Value(
                "A fall cuts back and lowers, leaving a gorge when graded away.".into(),
            ),
            fate: Slot::Value(Rc::new(|state, place| {
                Ok(
                    if reads::rock(state.field()?, place.anchor, SurfaceResponse::Resistance)?
                        <= 0.0
                    {
                        Fate::Ends {
                            leaves: Some(Kind::Gorge),
                        }
                    } else {
                        Fate::Persists
                    },
                )
            })),
        },
        naming: Naming {
            statement: Must::Value(
                "Nearest people name it for its form; a portage town may take its name.".into(),
            ),
            named_by: Slot::Value(Rc::new(places::naming_culture_near)),
            takes_name_from: Slot::NotApplicable("Falls give names; they do not take them."),
            lends_name_to: Slot::Value(vec![nearby(Kind::Settlement)]),
            term: Slot::Value(Rc::new(name_term)),
        },
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::Waterfall, group: Group::Water, name: "Waterfall".into(),
        recognition: Recognition {
            distinct: Must::Value("A step on a mapped river, with sufficient drop and gradient contrast, claimed by a physical or cultural origin.".into()),
            is_a: Must::Value(Rc::new(is_a)), landform: Slot::Value(LandformMark { code: 17, yields_to: Vec::new() }),
        },
        existence: Existence {
            origins: Slot::Value(fall_origins::origins(Rc::new(|state: &S, _| fall_origins::carried(state, state.catalogue())), Rc::new(|state| state.settlement_places()), Rc::new(|state, cell| state.link_on(AreaKind::River, cell)))),
            statement: Must::Value("The river profile supplies steps; rock, faults, hanging tributaries, cliffs, height, portage towns or captured identity claim falls, spaced apart.".into()),
            way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Recognition reads the river itself."), suitability: Slot::NotApplicable("Nothing chooses where a fall stands."), places: Must::Value(Rc::new(found)),
        },
        publication: Publication { statement: Must::Value("Publish each fall's site, true size and discharge; town-named falls arrive after towns.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(record)) },
        across_maps: across_maps(), event: None, roles: roles(),
    }
}
