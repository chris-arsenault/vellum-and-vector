use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    kinds::{Group, Kind},
    places, reads, records,
    state::State,
    values::*,
    visibility, water_reads,
};
use crate::{
    ecology::environment::WETLAND_COVER,
    field::{
        shared::{CellCode, Scalar},
        significance::measure,
    },
    hpc::BitSet,
    magic::channels::Channel,
};
use std::{io, rc::Rc};
fn is_a(state: &impl State, cell: usize) -> io::Result<bool> {
    reads::magic_rule(state, "aurora", "melt", cell)
}
fn found(state: &impl State) -> io::Result<Vec<Place>> {
    Ok(
        places::rule_places(state, Kind::MeltLine, "aurora", "melt")?
            .as_ref()
            .clone(),
    )
}
fn charge(state: &impl State, cell: usize) -> io::Result<f64> {
    reads::magic_value(state, "aurora", Channel::Intensity, cell)
}
fn around(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(6.0))
}
fn greatness(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    let area = water_reads::area_of(field, place);
    Ok(((charge(state, place.anchor)? / 1000.0).min(1.0)
        + area / (area + measure(&field.scale, 0.00000625, 2, 1.0)?))
        / 2.0)
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, around(state)?, |cell| charge(state, cell))
}
fn isolation(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn fen(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let ice = field.shared.scalar(Scalar::IceThickness);
    let water = field.water().column.kind;
    let mut edge = BitSet::new(field.mesh.len());
    let mut changes = Vec::new();
    for &cell in &place.cells {
        for side in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, side) {
                if water.get(next)? == 0 && ice.get(next)? <= 0.0 && edge.add(next) {
                    changes.push(FieldChange::Physical(PhysicalChange {
                        band: PhysicalBand::Scalar(Scalar::WetlandCover),
                        cell: next,
                        change: Change::AtLeast(WETLAND_COVER),
                    }));
                }
            }
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
        statement: Must::Value("A charged thaw feeds rivers and grows fen beside ice; the same meltwater carries Aurora away.".into()),
        terrain: Slot::NotApplicable("Glacial deposition lays the outwash."), water: Slot::NotApplicable("Glacial meltwater and Aurora feedback supply the water."), climate: Slot::NotApplicable("Aurora's heat effect already changes temperature."),
        cover: Slot::Value(Rc::new(fen)), magic: Slot::NotApplicable("Ice carriage loses charge to meltwater; no second drain is declared."),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    let ice: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 1.5, 0.0));
    Movement {
        statement: Must::Value("Rotten ice and slush hinder travel; drainage starts here and ice-carried charge is lost.".into()),
        roads: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 2.0, 0.0))), boats: Slot::NotApplicable("Water under and over ice has no boat reach."),
        drainage: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.8, 0.0))), magic: Slot::Value([(Carrier::Ice, ice)].into_iter().collect()),
        links: Slot::NotApplicable("A line joins no two cells."), crosses: Slot::NotApplicable("Rotten ice loses crossings; it opens none."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value("At an Aurora ice field's edge, with wetlands below, moraine behind and frost prisms in colder ice.".into()),
        needs: Slot::Value(vec![near(Kind::AuroraField, 6.0)]), excludes: Slot::Value(vec![Relation { kind: Kind::ThawedHalo, holds: Rc::new(|_, a, b| Ok(a.cells.contains(&b.anchor))) }]),
        contains: Slot::NotApplicable("A band of thawing ice holds no place of its own."), pairs_with: Slot::Value(vec![near(Kind::Wetland, 3.0), near(Kind::Moraine, 6.0), near(Kind::FrostPrism, 6.0)]),
    }
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value("Clean seasonal water, rich fen and material released from ice, with a risk of outburst.".into()),
        offers: Slot::Value(Rc::new(|state, place| { let great = greatness(state, place)?; Ok([(Benefit::Water, great), (Benefit::Food, great / 2.0), (Benefit::Materials, great / 2.0), (Benefit::Sanctity, great / 3.0)].into_iter().collect()) })),
        threatens: Slot::Value(Rc::new(|state, place| Ok(vec![Hazard { hazard: "ice-dammed outburst".into(), reach: 2.0 * around(state)?, severity: greatness(state, place)? }]))),
    }
}
fn through_time<S: State + 'static>() -> ThroughTime<S> {
    ThroughTime {
        statement: Must::Value(
            "The thaw moves; thicker ice becomes an Aurora field, vanished ice may leave moraine."
                .into(),
        ),
        fate: Slot::Value(Rc::new(|state, place| {
            Ok(if is_a(state, place.anchor)? {
                Fate::Persists
            } else if reads::magic_rule(state, "aurora", "field", place.anchor)? {
                Fate::Becomes(Kind::AuroraField)
            } else {
                Fate::Ends {
                    leaves: (state
                        .field()?
                        .shared
                        .code(CellCode::LandformCodes)
                        .get(place.anchor)?
                        == 12)
                        .then_some(Kind::Moraine),
                }
            })
        })),
    }
}
fn visible<S: State + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value("Charge and ice-edge extent matter most; clustered fronts make isolation less significant.".into()),
        magnitude: Slot::Value(Rc::new(greatness)), local_conditions: Slot::Value(Rc::new(local)), isolation: Slot::Value(Rc::new(isolation)), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| Ok((0.5 * greatness(state, place)? + 0.4 * local(state, place)? + 0.1 * isolation(state, place)?).max(cultural(state, place)?)))),
    }
}
fn naming<S: State + 'static>() -> Naming<S> {
    Naming {
        statement: Must::Value(
            "Named by nearby people living on its water; it lends its name to nearby wetland."
                .into(),
        ),
        named_by: Slot::Value(Rc::new(places::naming_culture_near)),
        takes_name_from: Slot::NotApplicable(
            "Named for its action, without an older nearby place.",
        ),
        lends_name_to: Slot::Value(vec![near(Kind::Wetland, 3.0)]),
        term: Slot::Unwritten,
    }
}
fn across_maps<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> AcrossMaps<S, Schedule>
{
    AcrossMaps {
        statement: Must::Value("Captured ice and warmth establish the finer thaw; each round follows a counterpart, dropping an unrealized line.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::NotApplicable("Regional ice and climate supply the rule's inputs across the map."),
        counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(|state, carried| Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)))),
        settle: Slot::Value(Rc::new(|state, carried| Ok(carry_rules::moves_to(counterpart(state, carried)?)))), schedule: Slot::NotApplicable("Aurora's rule reads it; no separate refinement step."),
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::MeltLine, group: Group::Water, name: "Melt line".into(),
        recognition: Recognition { distinct: Must::Value("Aurora's melt rule on charged thawing ice; ordinary uncharged glacial melt is not this place.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Aurora's charged ice meets a thaw it cannot hold back.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Aurora's rule reads charge, ice and warmth."), suitability: Slot::NotApplicable("Thaw and charge decide its site."), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Publish as Aurora's melt class.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(|state: &S, place: &Place| records::rule(state, place, "aurora", "melt"))) },
        across_maps: across_maps(), event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten, fields: fields(), movement: movement(), others: others(), people: people(), time: through_time(), visibility: visible(), naming: naming() },
    }
}
