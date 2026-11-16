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
    field::{shared::Scalar, significance::measure},
    magic::channels::Channel,
    rock::ground::GroundField,
    scale::MapScale,
    water::column::Store,
};
use std::{io, rc::Rc};
const PLUME_DEPTH: f64 = 0.000075;
const SHOAL_VENT: f64 = 0.0000125;
const FLUSHED_SEDIMENT: f64 = 0.00000025;
const WARMED_WATER: f64 = 30.0;
const PLUME_LIFT: f64 = 500.0;
const VENT_LIFE: f64 = 1.0;
fn is_a(state: &impl State, cell: usize) -> io::Result<bool> {
    reads::magic_rule(state, "fire", "vent", cell)
}
fn found(state: &impl State) -> io::Result<Vec<Place>> {
    Ok(places::rule_places(state, Kind::Vent, "fire", "vent")?
        .as_ref()
        .clone())
}
fn heat(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok((state
        .field()?
        .shared
        .scalar(Scalar::Geothermal)
        .get(place.anchor)?
        / 1000.0)
        .max(reads::magic_value(state, "fire", Channel::Intensity, place.anchor)? / 1000.0))
}
fn depth(state: &impl State, place: &Place) -> io::Result<f64> {
    state
        .field()?
        .water()
        .column
        .store(Store::Standing)
        .held(place.anchor)
}
fn reaches_surface(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok((-depth(state, place)? / measure(&state.field()?.scale, PLUME_DEPTH, 1, 0.5)?).exp())
}
fn shallow(state: &impl State, place: &Place) -> io::Result<bool> {
    Ok(depth(state, place)? < measure(&state.field()?.scale, SHOAL_VENT, 1, 0.5)?)
}
fn around(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(10.0))
}
fn magnitude(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    let area = water_reads::area_of(field, place);
    Ok((heat(state, place)? + area / (area + measure(&field.scale, 0.00000625, 2, 1.0)?)) / 2.0)
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    let geothermal = state.field()?.shared.scalar(Scalar::Geothermal);
    visibility::stands_out(state, place, around(state)?, |cell| {
        Ok(geothermal.get(cell)? / 1000.0)
    })
}
fn isolation(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn flushed(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let limit = MapScale::native(measure(&state.field()?.scale, FLUSHED_SEDIMENT, 1, 0.5)?);
    Ok(place
        .cells
        .iter()
        .map(|&cell| {
            FieldChange::Physical(PhysicalChange {
                band: PhysicalBand::Ground(GroundField::SedimentThickness),
                cell,
                change: Change::AtMost(limit),
            })
        })
        .collect())
}
fn plume(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let reach = reaches_surface(state, place)?;
    let warmth = (WARMED_WATER * reach + 0.5).floor();
    let lift = (PLUME_LIFT * reach + 0.5).floor();
    if warmth <= 0.0 {
        return Ok(Vec::new());
    }
    Ok(place
        .cells
        .iter()
        .flat_map(|&cell| {
            [
                (Scalar::SeaSurfaceAnomaly, warmth),
                (Scalar::Upwelling, lift),
            ]
            .into_iter()
            .map(move |(band, value)| {
                FieldChange::Physical(PhysicalChange {
                    band: PhysicalBand::Scalar(band),
                    cell,
                    change: Change::AtLeast(value),
                })
            })
        })
        .collect())
}
fn fauna(_state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    Ok(place
        .cells
        .iter()
        .map(|&cell| {
            FieldChange::Physical(PhysicalChange {
                band: PhysicalBand::Scalar(Scalar::AquaticProductivity),
                cell,
                change: Change::AtLeast(VENT_LIFE),
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
fn near<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|state, a, b| places::within(state, a, b, around(state)?)),
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value(
            "The vent clears its mound, warms and lifts shallow water and feeds life by chemistry."
                .into(),
        ),
        terrain: Slot::Value(Rc::new(flushed)),
        water: Slot::Value(Rc::new(plume)),
        climate: Slot::NotApplicable("Water carries the warmth reaching the sea surface."),
        cover: Slot::Value(Rc::new(fauna)),
        magic: Slot::NotApplicable(
            "Fire's rule reads the source and heat; the vent adds no stock.",
        ),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    let crust: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 0.7, 0.0));
    Movement {
        statement: Must::Value("Boats avoid shallow gassy water; Fire travels through the conduit; land and drainage do not reach it.".into()),
        roads: Slot::NotApplicable("Ways do not enter the sea floor."), boats: Slot::Value(Rc::new(|state, place| if shallow(state, place)? { carry_rules::cost_near(state, place, 2.0, state.field()?.scale.cells(1.0)) } else { Ok(Vec::new()) })),
        drainage: Slot::NotApplicable("Rivers end at the shore."), magic: Slot::Value([(Carrier::Crust, crust)].into_iter().collect()),
        links: Slot::NotApplicable("A vent joins no two cells."), crosses: Slot::NotApplicable("No route crosses the sea-floor point."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value("Sea-floor heat excludes a hot spring and follows thermal veins, volcanoes and plume upwelling.".into()), needs: Slot::NotApplicable("Its rule reads the sea."),
        excludes: Slot::Value(vec![Relation { kind: Kind::Spring, holds: Rc::new(|_, a, b| Ok(a.cells.contains(&b.anchor))) }, Relation { kind: Kind::Lake, holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))) }]),
        contains: Slot::NotApplicable("The vent field holds no other kind."), pairs_with: Slot::Value(vec![near(Kind::ThermalVein), near(Kind::Volcano), near(Kind::UpwellingFront)]),
    }
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value(
            "Shallow vents offer fish, minerals and awe; deep vents touch no one.".into(),
        ),
        offers: Slot::Value(Rc::new(|state, place| {
            let reach = reaches_surface(state, place)?;
            Ok([
                (Benefit::Food, reach * heat(state, place)?),
                (Benefit::Materials, reach / 2.0),
                (Benefit::Sanctity, reach / 2.0),
            ]
            .into_iter()
            .collect())
        })),
        threatens: Slot::Value(Rc::new(|state, place| {
            Ok(if shallow(state, place)? {
                vec![Hazard {
                    hazard: "boiling water and gas".into(),
                    reach: state.field()?.scale.cells(1.0),
                    severity: heat(state, place)?,
                }]
            } else {
                Vec::new()
            })
        })),
    }
}
fn through_time<S: State + 'static>() -> ThroughTime<S> {
    ThroughTime {
        statement: Must::Value(
            "It lasts while heat reaches the floor; retreating sea leaves a thermal vein.".into(),
        ),
        fate: Slot::Value(Rc::new(|state, place| {
            Ok(
                if state.field()?.water().column.kind.get(place.anchor)? != 1 {
                    Fate::Becomes(Kind::ThermalVein)
                } else if is_a(state, place.anchor)? {
                    Fate::Persists
                } else {
                    Fate::Ends { leaves: None }
                },
            )
        })),
    }
}
fn visible<S: State + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value("Heat, extent and contrast with the sea floor show it; nearby people may carry its significance.".into()),
        magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(local)), isolation: Slot::Value(Rc::new(isolation)), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| Ok((0.5 * magnitude(state, place)? + 0.3 * local(state, place)? + 0.2 * isolation(state, place)?).max(cultural(state, place)?)))),
    }
}
fn naming<S: State + 'static>() -> Naming<S> {
    Naming {
        statement: Must::Value(
            "Sailors name a shallow vent only when people live near enough to see it.".into(),
        ),
        named_by: Slot::Value(Rc::new(|state, place| {
            if shallow(state, place)?
                && places::settlement_within(state, place.anchor, 2.0 * around(state)?)?
            {
                places::naming_culture_near(state, place)
            } else {
                Ok(None)
            }
        })),
        takes_name_from: Slot::NotApplicable("No nearby place names what lies under the sea."),
        lends_name_to: Slot::NotApplicable("Nothing takes the name of a thing out of sight."),
        term: Slot::Unwritten,
    }
}
fn across_maps<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> AcrossMaps<S, Schedule>
{
    AcrossMaps {
        statement: Must::Value("Captured heat reaches the finer sea floor through shared media; without a counterpart the vent keeps its place.".into()), stands_on: Slot::Unwritten,
        carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::NotApplicable("Regional shared media carry Geothermal."), counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep))),
        settle: Slot::NotApplicable("A sea-floor vent is unrelated to a round's water."), schedule: Slot::NotApplicable("Fire's rule reads it; no separate refinement step."),
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::Vent, group: Group::Water, name: "Hydrothermal vent".into(),
        recognition: Recognition { distinct: Must::Value("Fire's vent rule: ocean water over Fire intensity or geothermal heat; the undersea opening distinguishes hot springs, cold upwelling and buried thermal veins.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Fire conduits, ridges or plumes bring heat to the sea floor; Fire's rule grows and keeps the vent.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Fire's rule reads sea and heat."), suitability: Slot::NotApplicable("Heat rises where crust permits."), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Publish as Fire's vent class.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(|state: &S, place: &Place| records::rule(state, place, "fire", "vent"))) },
        across_maps: across_maps(), event: None,
        roles: Roles { true_size: super::true_sizes::extent(), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Vent), fields: fields(), movement: movement(), others: others(), people: people(), time: through_time(), visibility: visible(), naming: naming() },
    }
}
