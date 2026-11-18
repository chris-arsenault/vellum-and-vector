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
use crate::{field::significance::measure, magic::channels::Channel};
use std::{io, rc::Rc};
const HELD_WATER: f64 = 0.0000001;
const CARAVAN_REACH: f64 = 4.0;
const CARAVAN_SAVING: f64 = 0.6;
fn is_a(state: &impl State, cell: usize) -> io::Result<bool> {
    reads::magic_rule(state, "greenwood", "oasis", cell)
}
fn found(state: &impl State) -> io::Result<Vec<Place>> {
    Ok(
        places::rule_places(state, Kind::Oasis, "greenwood", "oasis")?
            .as_ref()
            .clone(),
    )
}
fn strength(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok((reads::magic_value(state, "greenwood", Channel::Source, place.anchor)? / 1000.0).min(1.0))
}
fn around(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(8.0))
}
fn magnitude(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    let area = water_reads::area_of(field, place);
    Ok(
        (strength(state, place)? + area / (area + measure(&field.scale, 0.000000625, 2, 1.0)?))
            / 2.0,
    )
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    water_reads::dryness_around(state, place, around(state)?)
}
fn isolation(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn watered(state: &impl State, cells: &[usize]) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let kind = field.water().column.kind;
    let held = measure(&field.scale, HELD_WATER, 1, 0.5)?;
    let mut changes = Vec::new();
    for &cell in cells {
        if kind.get(cell)? == 0 {
            changes.push(FieldChange::Physical(PhysicalChange {
                band: PhysicalBand::SoilWater,
                cell,
                change: Change::AtLeast(held),
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
fn moved<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Unrealized> {
    Ok(carry_rules::moves_to(counterpart(state, carried)?))
}
fn near<S: State + 'static>(kind: Kind, spans: f64) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |state, a, b| {
            places::within(state, a, b, state.field()?.scale.cells(spans))
        }),
    }
}
fn naming<S: State + 'static>() -> Naming<S> {
    Naming {
        statement: Must::Value(
            "Named by those who cross to it; caravan towns and shrines take its name.".into(),
        ),
        named_by: Slot::Value(Rc::new(places::naming_culture_near)),
        takes_name_from: Slot::NotApplicable(
            "Nothing older stands in its country to name it after.",
        ),
        lends_name_to: Slot::Value(vec![near(Kind::Settlement, 8.0), near(Kind::Shrine, 2.0)]),
        term: Slot::Unwritten,
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value("An oasis keeps bare ground wet; Greenwood intensity establishes plants and its spring origin supplies magic.".into()),
        terrain: Slot::NotApplicable("Water rises without cutting; failed springs are the sinkhole rule."),
        water: Slot::Value(Rc::new(|state, place| watered(state, &place.cells))),
        climate: Slot::NotApplicable("Grove shade lies below the climate field's resolution."),
        cover: Slot::NotApplicable("Magic living feedback writes Greenwood verdure by intensity."), magic: Slot::NotApplicable("Greenwood's spring origin writes its source."),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    let roots: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 0.7, around(state)? / 2.0));
    Movement { on_foot: None,
        statement: Must::Value("Caravans bend to its cheap going; groundwater and roots spread into bare ground; it floats no boats.".into()),
        roads: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, CARAVAN_SAVING, state.field()?.scale.cells(CARAVAN_REACH)))),
        boats: Slot::NotApplicable("Seeping water floats nothing."), drainage: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.8, 0.0))),
        magic: Slot::Value([(Carrier::Roots, roots)].into_iter().collect()),
        links: Slot::NotApplicable("A caravan's way to it is a road."), crosses: Slot::NotApplicable("Its road cost supplies the dry crossing benefit."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value("The bare-ground form of a Greenwood spring; towns and shrines gather, roots turn it to a grove spring, overdrawing leaves sinkholes.".into()),
        needs: Slot::NotApplicable("Its rule holds the aquifer and bare ground."),
        excludes: Slot::Value(vec![Relation { kind: Kind::Spring, holds: Rc::new(|_, a, b| Ok(a.cells.contains(&b.anchor))) }, Relation { kind: Kind::Forest, holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))) }]),
        contains: Slot::NotApplicable("Other places stand nearby."), pairs_with: Slot::Value(vec![near(Kind::Settlement, 8.0), near(Kind::Shrine, 2.0), near(Kind::SinkholeField, 8.0)]),
    }
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value(
            "Water and food determine desert crossings and authority; overdraw threatens collapse."
                .into(),
        ),
        offers: Slot::Value(Rc::new(|state, place| {
            let dry = local(state, place)?;
            let strong = strength(state, place)?;
            Ok([
                (Benefit::Water, dry),
                (Benefit::Food, (dry + strong) / 2.0),
                (Benefit::Trade, dry / 2.0),
                (Benefit::Sanctity, strong / 2.0),
            ]
            .into_iter()
            .collect())
        })),
        threatens: Slot::Value(Rc::new(|state, place| {
            Ok(vec![Hazard {
                hazard: "collapse of an overdrawn spring".into(),
                reach: state.field()?.scale.cells(2.0),
                severity: strength(state, place)? / 2.0,
            }])
        })),
    }
}
fn through_time<S: State + 'static>() -> ThroughTime<S> {
    ThroughTime {
        statement: Must::Value(
            "Trees make it a grove spring; drawing past recharge leaves sinkholes.".into(),
        ),
        fate: Slot::Value(Rc::new(|state, place| {
            Ok(
                if reads::magic_rule(state, "greenwood", "sinkhole", place.anchor)? {
                    Fate::Ends {
                        leaves: Some(Kind::SinkholeField),
                    }
                } else if !is_a(state, place.anchor)? {
                    Fate::Becomes(Kind::Spring)
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
            "Dry surroundings, separation and dependent people make its mark.".into(),
        ),
        magnitude: Slot::Value(Rc::new(magnitude)),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(isolation)),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| {
            Ok((0.15 * magnitude(state, place)?
                + 0.5 * local(state, place)?
                + 0.35 * isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
fn across_maps<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> AcrossMaps<S, Schedule>
{
    AcrossMaps {
        statement: Must::Value("The finer ground retains captured water; use the nearest oasis counterpart or keep its place.".into()), stands_on: Slot::Unwritten,
        carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::Value(Rc::new(|state, carried| watered(state, &carried.cells))),
        counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(moved)), settle: Slot::Value(Rc::new(moved)),
        schedule: Slot::NotApplicable("Greenwood's rule reads it; no separate refinement step."),
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::Oasis, group: Group::Water, name: "Oasis".into(),
        recognition: Recognition { distinct: Must::Value("Greenwood spring-origin water on land with low tree cover; its rule distinguishes the bare-ground oasis from a grove or natural spring.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Greenwood aquifer water rises on open soluble rock before cover grows.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Greenwood's rule reads aquifer and cover."), suitability: Slot::NotApplicable("The aquifer rises where rock permits."), places: Must::Value(Rc::new(found)) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Publish as Greenwood's oasis class.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(|state: &S, place: &Place| records::rule(state, place, "greenwood", "oasis"))) },
        across_maps: across_maps(), event: None,
        roles: Roles { true_size: super::true_sizes::extent(), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Oasis), fields: fields(), movement: movement(), others: others(), people: people(), time: through_time(), visibility: visible(), naming: naming() },
    }
}
