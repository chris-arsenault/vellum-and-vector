use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    kinds::{Group, Kind},
    places, records,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{
        region_evidence::region_evidence,
        shared::{CellCode, Scalar},
        significance::measure,
    },
    rock::ground::GroundField,
    scale::MapScale,
    water::column::Store,
};
use std::{io, rc::Rc};

const FILLED: f64 = 0.00000125;
const TROUGH_DEPTH: f64 = 0.0000075;
const REGIONAL_FJORD_EROSION: f64 = 0.0000075;
const FJORD_LENGTH: f64 = 0.02;
fn is_a(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(state
        .field()?
        .shared
        .code(CellCode::LandformCodes)
        .get(cell)?
        == 11)
}
fn depth(state: &impl State, cell: usize) -> io::Result<f64> {
    state
        .field()?
        .water()
        .column
        .store(Store::Standing)
        .held(cell)
}
fn found(state: &impl State) -> io::Result<Vec<Place>> {
    Ok(places::region_places(
        state,
        Kind::Fjord,
        |cell| is_a(state, cell),
        |cell| depth(state, cell),
    )?
    .as_ref()
    .clone())
}
fn length(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(*state.held().get(&format!("fjord:{}:span", place.id), || {
        Ok(region_evidence(state.field()?, &place.cells, |_| Ok(1.0), |_| true)?.span)
    })?)
}
fn greatness(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        length(state, place)?,
        measure(&state.field()?.scale, FJORD_LENGTH, 1, 1.0)?,
    ))
}
fn around(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(8.0))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, around(state)?, |cell| depth(state, cell))
}
fn isolation(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn held_trough(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let limit = measure(&field.scale, TROUGH_DEPTH, 1, 0.5)?;
    place
        .cells
        .iter()
        .map(|&cell| {
            Ok(FieldChange::Physical(PhysicalChange {
                cell,
                band: PhysicalBand::Ground(GroundField::Elevation),
                change: Change::AtMost(
                    field.water().effective_sea_level
                        - MapScale::native(depth(state, cell)?.min(limit)),
                ),
            }))
        })
        .collect()
}
fn realized_trough(state: &impl State, carried: &Carried) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let value = MapScale::native(measure(&field.scale, REGIONAL_FJORD_EROSION, 1, 1.0)?);
    let mut changes = vec![FieldChange::Physical(PhysicalChange {
        cell: carried.cell,
        band: PhysicalBand::Ground(GroundField::Elevation),
        change: Change::AtMost(
            field.water().effective_sea_level
                - MapScale::native(measure(&field.scale, TROUGH_DEPTH, 1, 0.5)?),
        ),
    })];
    for &cell in &carried.cells {
        if cell == carried.cell || field.water().column.kind.get(cell)? == 1 {
            changes.push(FieldChange::Physical(PhysicalChange {
                cell,
                band: PhysicalBand::Scalar(Scalar::CumulativeGlacialErosion),
                change: Change::AtLeast(value),
            }));
        }
    }
    Ok(changes)
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        is_a(state, cell)
    })
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
        statement: Must::Value("The drowned trough holds its bed below the sea; wall streams descend into it and fetch determines shelter.".into()),
        terrain: Slot::Value(Rc::new(held_trough)), water: Slot::NotApplicable("Currents and shore processes own exposure."),
        climate: Slot::NotApplicable("The narrow arm shares the coast's air."), cover: Slot::NotApplicable("Sea has no cover; flanks follow their height."),
        magic: Slot::NotApplicable("Aurora's shelf carrier owns its stock."),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    let currents: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 1.5, 0.0));
    Movement {
        statement: Must::Value("Deep sheltered water carries boats inland; walkers round the head and narrows impede carried current stock.".into()),
        roads: Slot::NotApplicable("Roads already avoid sea and pay for flank grade."),
        boats: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.7, 0.0))),
        drainage: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.85, 0.0))),
        magic: Slot::Value([(Carrier::Current, currents)].into_iter().collect()),
        links: Slot::NotApplicable("It separates shores."), crosses: Slot::NotApplicable("A boat crossing belongs to a strait."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value(
            "Falls, moraine, harbours and river mouths occupy the trough and its shores.".into(),
        ),
        needs: Slot::NotApplicable("The landform owns the ice and flank test."),
        excludes: Slot::Value(vec![Relation {
            kind: Kind::Bay,
            holds: Rc::new(|_, a, b| Ok(a.cells.contains(&b.anchor))),
        }]),
        contains: Slot::NotApplicable("Harbours stand on its edge."),
        pairs_with: Slot::Value(vec![
            near(Kind::Waterfall, 8.0),
            near(Kind::Harbour, 3.0),
            near(Kind::Moraine, 8.0),
            near(Kind::RiverMouth, 8.0),
            near(Kind::Valley, 3.0),
        ]),
    }
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value("A safe harbour and inland water road support trade, defence and fishing; wall rockfalls drive waves.".into()),
        offers: Slot::Value(Rc::new(|state, place| { let great = greatness(state, place)?; Ok([(Benefit::Trade, great), (Benefit::Defence, great / 2.0), (Benefit::Food, great / 2.0)].into_iter().collect()) })),
        threatens: Slot::Value(Rc::new(|state, place| Ok(vec![Hazard { hazard: "rockfall wave".into(), reach: length(state, place)?, severity: if state.field()?.shared.scalar(Scalar::MaximumIceThickness).get(place.anchor)? > 0.0 { 0.5 } else { 0.25 } }]))),
    }
}
fn through_time<S: State + 'static>() -> ThroughTime<S> {
    ThroughTime {
        statement: Must::Value(
            "Filling turns the trough into a bay; sea withdrawal leaves a valley.".into(),
        ),
        fate: Slot::Value(Rc::new(|state, place| {
            Ok(
                if state.field()?.water().column.kind.get(place.anchor)? != 1 {
                    Fate::Becomes(Kind::Valley)
                } else if depth(state, place.anchor)?
                    < measure(&state.field()?.scale, FILLED, 1, 0.5)?
                {
                    Fate::Becomes(Kind::Bay)
                } else {
                    Fate::Persists
                },
            )
        })),
    }
}
fn visible<S: State + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "Length, depth against the shelf, isolation and harbour towns determine its mark."
                .into(),
        ),
        magnitude: Slot::Value(Rc::new(greatness)),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(isolation)),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| {
            Ok((0.6 * greatness(state, place)?
                + 0.15 * local(state, place)?
                + 0.25 * isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::Fjord, group: Group::Water, name: "Fjord".into(),
        recognition: Recognition { distinct: Must::Value("The landform process identifies drowned, glacially scoured water with opposite land flanks, distinct from open shelf and ordinary bays.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("The sea enters an ice-cut trough below its present level.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("The landform reads ice and flanks."), suitability: Slot::NotApplicable("No process sites past glacial cutting."), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Publish its outline, length and depth.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(|state: &S, place: &Place| {
            let mut attributes = crate::features::records::Attributes::new();
            attributes.insert("length".into(), length(state, place)?.into()); attributes.insert("depth".into(), depth(state, place.anchor)?.into());
            records::area(state, place, records::Shape { kind: "fjord", layer: "geology", name: "Fjord", attributes }, None)
        })) },
        across_maps: AcrossMaps {
            statement: Must::Value("The captured trough remains drowned with glacial evidence; its record moves to a refined fjord or goes when no flanked trough remains.".into()), stands_on: Slot::Unwritten,
            carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::Value(Rc::new(realized_trough)), counterpart: Slot::Value(Rc::new(counterpart)),
            unrealized: Slot::Value(Rc::new(|state, carried| Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)))),
            settle: Slot::NotApplicable("Only ice and sea change the trough, not a round's water."), schedule: Slot::NotApplicable("The landform reads it without another refinement step."),
        }, event: None,
        roles: Roles {
            true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten,
            fields: fields(), movement: movement(), others: others(), people: people(), time: through_time(), visibility: visible(),
            naming: Naming { statement: Must::Value("Shore people name the fjord; its head town takes its name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::NotApplicable("The town takes the fjord's name."), lends_name_to: Slot::Value(vec![near(Kind::Settlement, 8.0), near(Kind::Harbour, 3.0)]), term: Slot::Unwritten },
        },
    }
}
