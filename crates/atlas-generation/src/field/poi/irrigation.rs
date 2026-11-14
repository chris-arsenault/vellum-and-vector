use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{AreaKind, Group, Kind},
    places, reads, river_courses, settlement_reads as settled, sites,
    state::State,
    values::*,
    visibility,
    work_records::{self, SitedWork, WorkState},
};
use crate::{
    field::{shared::Scalar, significance::measure},
    magic::channels::Channel,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
};
use std::{io, rc::Rc};

fn wanted_from(state: &impl State) -> io::Result<f64> {
    measure(&state.field()?.scale, 0.0075, 1, 1.0)
}
fn typical(state: &impl State) -> io::Result<f64> {
    measure(&state.field()?.scale, 1.5625e-20, 3, 1.0)
}
fn dry(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(1.0 - state.field()?.shared.scalar(Scalar::Moisture).get(cell)? / 1000.0)
}
fn requires(state: &impl WorkState, cell: usize) -> io::Result<bool> {
    Ok(river_courses::mapped_cells(state)?.has(cell)
        && settled::near_town(state, cell, wanted_from(state)?, 500.0)?)
}
fn suitable(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let flow = reads::discharge(field, cell)?;
    let level = 1.0 - (field.shared.scalar(Scalar::Slope).get(cell)? / 0.02).min(1.0);
    let soil = (MapScale::metres(
        field
            .ground()
            .view(GroundField::SedimentThickness)
            .get(cell)?,
        LengthUnit::Native,
    ) / measure(&field.scale, 0.00000025, 1, 0.5)?)
    .min(1.0);
    Ok((dry(state, cell)? + level + soil + flow / (flow + typical(state)?)) / 4.0)
}
fn found<S: WorkState + 'static>(state: &S) -> io::Result<Vec<Place>> {
    let shape = SitedWork {
        record: "irrigation",
        layer: "waterworks",
        label: "Irrigation",
        radius: RelativeMeasure::length(0.00075).map_err(io::Error::other)?,
        spacing: RelativeMeasure::length(0.005).map_err(io::Error::other)?,
        requires: Rc::new(requires),
        suitability: Rc::new(suitable),
    };
    Ok(
        work_records::work_places(state, Kind::Irrigation, &shape, || Ok(Vec::new()))?
            .as_ref()
            .clone(),
    )
}
fn diverted(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(reads::discharge(state.field()?, place.anchor)?.min(settled::strength(place)))
}
fn magnitude(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(diverted(state, place)?, typical(state)?))
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(6.0))
}
fn visible<S: WorkState + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value("The diverted water, dry country, isolation and community attachment determine visibility.".into()),
        magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(|state, place| dry(state, place.anchor))),
        isolation: Slot::Value(Rc::new(|state: &S, place| visibility::alone_among(state, place, &found(state)?, state.field()?.scale.cells(6.0)))), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state: &S, place| {
            if state.physical().is_none() || place.anchor == usize::MAX { return Ok(0.0); }
            Ok((0.4 * magnitude(state, place)? + 0.4 * dry(state, place.anchor)? + 0.2 * visibility::alone_among(state, place, &found(state)?, state.field()?.scale.cells(6.0))?).max(cultural(state, place)?))
        })),
    }
}
fn water(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let withdrawal = settled::strength(place).max(0.0);
    let mut changes = Vec::new();
    if withdrawal > 0.0 {
        changes.push(FieldChange::WaterPassage {
            cell: place.anchor,
            withdrawal,
            transmission: 1.0,
        });
    }
    let water = diverted(state, place)? * measure(&state.field()?.scale, 3.2e11, -2, 1.0)?;
    changes.extend(
        settled::work_reach(state, place)?
            .into_iter()
            .map(|sample| {
                FieldChange::Physical(PhysicalChange {
                    cell: sample.cell,
                    band: PhysicalBand::SoilWater,
                    change: Change::Add(water * sample.share),
                })
            }),
    );
    Ok(changes)
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value("Declare an intake withdrawal to the shared water owner and add the diverted water to nearby soil; maintained works keep a Hallowed line.".into()),
        terrain: Slot::NotApplicable("Ditches are narrower than a field cell."), water: Slot::Value(Rc::new(water)), climate: Slot::NotApplicable("Field evaporation has no additional climate forcing."), cover: Slot::NotApplicable("Ecology reads the soil water; clearance owns crops."), magic: Slot::Value(Rc::new(|_, place| Ok(settled::kept_line(place, place.anchor)))),
    }
}
fn counterpart<S: CatalogueState<Schedule> + WorkState, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    let mapped = river_courses::mapped_cells(state)?;
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        Ok(mapped.has(cell))
    })
}
fn across<S: CatalogueState<Schedule> + WorkState + 'static, Schedule: 'static>(
) -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value("The captured intake follows the nearest finer channel, or goes when no river lies near.".into()), stands_on: Slot::Value(AreaKind::River), carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::NotApplicable("The water effect applies at the intake without another ground shape."), counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(|state, carried| Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)))),
        settle: Slot::NotApplicable("The intake reads each round's water without moving itself."), schedule: Slot::NotApplicable("Irrigation adds no refinement step."),
    }
}
fn reach(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(settled::attribute(place, "radius", 0.0).max(state.field()?.scale.cells(1.0)))
}
fn on_land(state: &impl State, place: &Place, factor: f64) -> io::Result<Vec<Cost>> {
    Ok(
        sites::within(&state.field()?.mesh, place.anchor, reach(state, place)?)
            .into_iter()
            .map(|cell| Cost { cell, factor })
            .collect(),
    )
}
fn movement<S: State + 'static>() -> Movement<S> {
    let river: OnPlace<S, Vec<Cost>> = Rc::new(|state, place| on_land(state, place, 0.8));
    Movement {
        statement: Must::Value(
            "Ditches obstruct roads while canals carry river stock over the watered land.".into(),
        ),
        roads: Slot::Value(Rc::new(|state, place| on_land(state, place, 1.15))),
        boats: Slot::NotApplicable("Field ditches float no boats."),
        drainage: Slot::NotApplicable("Intake withdrawal changes flow without rerouting the tree."),
        magic: Slot::Value([(Carrier::River, river)].into_iter().collect()),
        links: Slot::NotApplicable("A ditch joins no walkable route."),
        crosses: Slot::NotApplicable("A ditch is an obstacle rather than a crossing."),
    }
}
fn wanted_relation<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|state, a, b| places::within(state, a, b, wanted_from(state)?)),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value(
            "Irrigation serves people and clearance, often below a dam, but fails on salt pans."
                .into(),
        ),
        needs: Slot::Value(vec![wanted_relation(Kind::Settlement)]),
        excludes: Slot::Value(vec![Relation {
            kind: Kind::SaltPan,
            holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
        }]),
        contains: Slot::NotApplicable("The watered fields belong to clearance."),
        pairs_with: Slot::Value(vec![
            wanted_relation(Kind::Dam),
            cover_shared::near(Kind::Clearance, 6.0),
            cover_shared::near(Kind::Mill, 6.0),
        ]),
    }
}
pub fn entry<S: CatalogueState<Schedule> + WorkState + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    Entry {
        id: Kind::Irrigation, group: Group::Settlements, name: "Irrigation".into(),
        recognition: Recognition { distinct: Must::Value("An intake transfers channel water onto land, reducing downstream flow unlike a dam or mill.".into()), is_a: Must::Value(Rc::new(|state, cell| places::holds_record(state, Kind::Irrigation, cell, || found(state)))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Site works on dry, level, soiled rivers within reach of at least 500 people.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(requires)), suitability: Slot::Value(Rc::new(suitable)), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Publish the located water work selected by this map's ground.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(work_records::work_record)) }, across_maps: across(), event: None,
        roles: Roles {
            true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten, fields: fields(), movement: movement(), others: others(),
            people: People { statement: Must::Value("Diverted water feeds dry-country harvests, but rising brine salts fields.".into()), offers: Slot::Value(Rc::new(|state, place| { let size = magnitude(state, place)?; Ok([(Benefit::Water, size), (Benefit::Food, size * dry(state, place.anchor)?)].into_iter().collect()) })), threatens: Slot::Value(Rc::new(|state, place| { let salt = reads::magic_value(state, "salt", Channel::Intensity, place.anchor)? / 1000.0; Ok(if salt > 0.0 { vec![Hazard { hazard: "salted fields".into(), reach: reach(state, place)?, severity: salt.min(1.0) }] } else { Vec::new() }) })) },
            time: ThroughTime { statement: Must::Value("An unkept work ends and leaves its cleared land.".into()), fate: Slot::Value(Rc::new(|_, place| Ok(if settled::kept(place) { Fate::Persists } else { Fate::Ends { leaves: Some(Kind::Clearance) } }))) }, visibility: visible(),
            naming: Naming { statement: Must::Value("The digging community names the work, usually for its settlement.".into()), named_by: Slot::Value(Rc::new(settled::culture)), takes_name_from: Slot::Value(vec![NameRelation { relation: wanted_relation(Kind::Settlement), chance: None }]), lends_name_to: Slot::NotApplicable("A canal's name stays on the canal."), term: Slot::Unwritten },
        },
    }
}
