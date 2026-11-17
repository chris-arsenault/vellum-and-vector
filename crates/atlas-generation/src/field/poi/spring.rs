use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    kinds::{AreaKind, Group, Kind},
    map_records::{self, MapState},
    places, reads, records,
    river_courses::{self, RiverState},
    state::State,
    values::*,
    visibility, water_reads,
};
use crate::{
    field::{
        geographic_regions::{self, Components},
        shared::Scalar,
        significance::measure,
    },
    magic::channels::Channel,
    rock::{
        catalogue::{CATALOGUE, PERMEABLE_FROM},
        ground::GroundField,
    },
    scale::MapScale,
};
use std::{io, rc::Rc};

const OPEN_FRACTURE: f64 = 0.32;
const SLOPE_BREAK: f64 = 0.5;
const TYPICAL_DISCHARGE: f64 = 7.8125e-20;
const SAPPED_HOLLOW: f64 = 0.0000005;
const FLUSH_WATER: f64 = 0.000000075;
const FLUSH_COVER: f64 = 0.15;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Form {
    Hot,
    Greenwood,
    Natural,
}
impl Form {
    fn name(self) -> &'static str {
        match self {
            Self::Hot => "hot",
            Self::Greenwood => "greenwood",
            Self::Natural => "natural",
        }
    }
}
pub fn spring_water(state: &impl State, cell: usize) -> io::Result<Form> {
    Ok(if reads::magic_rule(state, "fire", "spring", cell)? {
        Form::Hot
    } else if reads::magic_rule(state, "greenwood", "wellspring", cell)? {
        Form::Greenwood
    } else {
        Form::Natural
    })
}
fn natural(state: &impl RiverState, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    if field.water.borrow().kind_at(cell)? != 0
        || reads::magic_rule(state, "greenwood", "oasis", cell)?
        || spring_water(state, cell)? != Form::Natural
        || field.mesh.boundary(cell)
        || field.shared.scalar(Scalar::IceThickness).get(cell)? > 0.0
        || field.water.borrow().glacial_melt(cell)? > 0.0
        || reads::celsius(field, cell)? <= 0.0
    {
        return Ok(false);
    }
    let mapped = river_courses::mapped_cells(state)?;
    if !mapped.has(cell) {
        return Ok(false);
    }
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            if mapped.has(next) && water_reads::flow_target(field, next)? == Some(cell) {
                return Ok(false);
            }
        }
    }
    if CATALOGUE[reads::rock_kind(field, cell)?].facts.porosity < PERMEABLE_FROM
        && field.shared.scalar(Scalar::FractureConductance).get(cell)? / 1000.0 < OPEN_FRACTURE
    {
        return Ok(false);
    }
    let slope = field.shared.scalar(Scalar::Slope);
    let mut above = 0.0f64;
    for next in water_reads::inflows(field, cell)? {
        above = above.max(slope.get(next)?);
    }
    Ok(above > 0.0 && slope.get(cell)? <= SLOPE_BREAK * above)
}
fn is_a(state: &impl RiverState, cell: usize) -> io::Result<bool> {
    Ok(spring_water(state, cell)? != Form::Natural || natural(state, cell)?)
}
fn strength(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(reads::magic_value(state, "fire", Channel::Intensity, cell)?
        + reads::magic_value(state, "greenwood", Channel::Source, cell)?)
}
fn found<S: MapState + RiverState>(state: &S) -> io::Result<Vec<Place>> {
    Ok(state
        .held()
        .get("places:spring", || {
            let mut found = Vec::new();
            for form in [Form::Hot, Form::Greenwood, Form::Natural] {
                let regions = geographic_regions::components(
                    state,
                    &|cell| match form {
                        Form::Hot => reads::magic_rule(state, "fire", "spring", cell),
                        Form::Greenwood => {
                            reads::magic_rule(state, "greenwood", "wellspring", cell)
                        }
                        Form::Natural => natural(state, cell),
                    },
                    Components {
                        polygonal: false,
                        splits: false,
                    },
                    None,
                )?;
                for region in regions.regions {
                    let mut anchor = region.members[0];
                    for &cell in &region.members {
                        if strength(state, cell)? > strength(state, anchor)? {
                            anchor = cell;
                        }
                    }
                    let mut place = Place::at(Kind::Spring, anchor, region.members);
                    place.id = format!("spring:{}:{anchor}", form.name());
                    found.push(place);
                }
            }
            Ok(found)
        })?
        .as_ref()
        .clone())
}
fn record(state: &impl MapState, place: &Place) -> io::Result<Option<crate::features::Feature>> {
    match place.id.split(':').nth(1) {
        Some("hot") => records::rule(state, place, "fire", "spring"),
        Some("greenwood") => records::rule(state, place, "greenwood", "wellspring"),
        _ => map_records::site(
            state,
            place,
            "spring",
            "geology",
            "Spring",
            Default::default(),
        ),
    }
}
fn flow_size(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    let flow = reads::discharge(field, place.anchor)?;
    Ok(flow / (flow + measure(&field.scale, TYPICAL_DISCHARGE, 3, 1.0)?))
}
fn greatness(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(flow_size(state, place)?.max((strength(state, place.anchor)? / 1000.0).min(1.0)))
}
fn around(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(6.0))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    water_reads::dryness_around(state, place, around(state)?)
}
fn isolation<S: MapState + RiverState>(state: &S, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn head_shape(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    if spring_water(state, place.anchor)? == Form::Hot
        || field.water().column.kind.get(place.anchor)? != 0
    {
        return Ok(Vec::new());
    }
    let heights = field.ground().view(GroundField::Elevation);
    let mut ground = f64::NEG_INFINITY;
    for next in water_reads::inflows(field, place.anchor)? {
        ground = ground.max(heights.get(next)?);
    }
    Ok(if ground == f64::NEG_INFINITY {
        Vec::new()
    } else {
        vec![FieldChange::Physical(PhysicalChange {
            band: PhysicalBand::Ground(GroundField::Elevation),
            cell: place.anchor,
            change: Change::AtMost(
                ground - MapScale::native(measure(&field.scale, SAPPED_HOLLOW, 1, 0.5)?),
            ),
        })]
    })
}
fn watered(state: &impl State, cells: &[usize]) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let held = measure(&field.scale, FLUSH_WATER, 1, 0.5)?;
    let mut changes = Vec::new();
    for &cell in cells {
        if field.water().column.kind.get(cell)? == 0 {
            changes.push(FieldChange::Physical(PhysicalChange {
                band: PhysicalBand::SoilWater,
                cell,
                change: Change::AtLeast(held),
            }));
        }
    }
    Ok(changes)
}
fn flush(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let hot = spring_water(state, place.anchor)? == Form::Hot;
    let mut changes = Vec::new();
    for &cell in &place.cells {
        if field.water().column.kind.get(cell)? == 0 {
            changes.push(FieldChange::Physical(PhysicalChange {
                band: PhysicalBand::Scalar(if hot {
                    Scalar::TreeCover
                } else {
                    Scalar::WetlandCover
                }),
                cell,
                change: if hot {
                    Change::AtMost(FLUSH_COVER)
                } else {
                    Change::AtLeast(FLUSH_COVER)
                },
            }));
        }
    }
    Ok(changes)
}
fn counterpart<S: CatalogueState<Schedule> + RiverState, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        is_a(state, cell)
    })
}
fn moved<S: CatalogueState<Schedule> + RiverState, Schedule>(
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
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value("A spring wets its head; cold water saps a hollow and holds sedge, hot water holds bare ground.".into()),
        terrain: Slot::Value(Rc::new(head_shape)), water: Slot::Value(Rc::new(|state, place| watered(state, &place.cells))),
        climate: Slot::NotApplicable("Fire owns hot spring heat; the water cannot move the air."), cover: Slot::Value(Rc::new(flush)),
        magic: Slot::NotApplicable("Fire river warmth and Greenwood living feedback own these effects."),
    }
}
fn eased<S: State + 'static>(form: Form) -> OnPlace<S, Vec<Cost>> {
    Rc::new(move |state, place| {
        if spring_water(state, place.anchor)? == form {
            carry_rules::cost_near(state, place, 0.7, 0.0)
        } else {
            Ok(Vec::new())
        }
    })
}
fn movement<S: State + 'static>() -> Movement<S> {
    Movement {
        statement: Must::Value("Dry-country tracks bend to water; drainage and the spring's underground carrier run easily through its ground.".into()),
        roads: Slot::Value(Rc::new(|state, place| {
            let field = state.field()?;
            let rain = field.shared.scalar(Scalar::Rainfall).get(place.anchor)? / 1000.0;
            carry_rules::cost_near(state, place, 1.0 - 0.3 * (1.0 - rain).max(0.0), field.scale.cells(2.0))
        })),
        boats: Slot::NotApplicable("The spring is above navigable water."),
        drainage: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.7, 0.0))),
        magic: Slot::Value([(Carrier::Crust, eased(Form::Hot)), (Carrier::Roots, eased(Form::Greenwood))].into_iter().collect()),
        links: Slot::NotApplicable("A spring joins no cells."), crosses: Slot::NotApplicable("A route rounds its head."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value("Shrines and towns gather at springs; hot water follows thermal veins and failed Greenwood water leaves sinkholes.".into()),
        needs: Slot::NotApplicable("Recognition holds its dependencies."),
        excludes: Slot::Value(vec![Relation { kind: Kind::Oasis, holds: Rc::new(|_, a, b| Ok(a.cells.contains(&b.anchor))) }, Relation { kind: Kind::RiverMouth, holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)) }]),
        contains: Slot::NotApplicable("A connected rising is one spring."),
        pairs_with: Slot::Value(vec![near(Kind::Shrine, 2.0), near(Kind::Settlement, 6.0), near(Kind::ThermalVein, 6.0), near(Kind::SinkholeField, 6.0), Relation { kind: Kind::Lake, holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))) }]),
    }
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value(
            "Water sustains and sanctifies the place; hot water supplies minerals and can scald."
                .into(),
        ),
        offers: Slot::Value(Rc::new(|state, place| {
            let great = greatness(state, place)?;
            let form = spring_water(state, place.anchor)?;
            Ok([
                (Benefit::Water, flow_size(state, place)?),
                (
                    Benefit::Sanctity,
                    if form == Form::Natural {
                        great / 2.0
                    } else {
                        great
                    },
                ),
                (
                    Benefit::Materials,
                    if form == Form::Hot { great / 2.0 } else { 0.0 },
                ),
            ]
            .into_iter()
            .collect())
        })),
        threatens: Slot::Value(Rc::new(|state, place| {
            Ok(if spring_water(state, place.anchor)? == Form::Hot {
                vec![Hazard {
                    hazard: "scalding water".into(),
                    reach: state.field()?.scale.cells(1.0),
                    severity: greatness(state, place)?,
                }]
            } else {
                Vec::new()
            })
        })),
    }
}
fn through_time<S: State + 'static>() -> ThroughTime<S> {
    ThroughTime {
        statement: Must::Value("Rock and catchment sustain natural springs; spent Fire leaves basalt and exhausted Greenwood leaves sinkholes or an oasis.".into()),
        fate: Slot::Value(Rc::new(|state, place| Ok(if reads::magic_rule(state, "fire", "scar", place.anchor)? {
            Fate::Ends { leaves: Some(Kind::BasaltFlat) }
        } else if reads::magic_rule(state, "greenwood", "sinkhole", place.anchor)? {
            Fate::Ends { leaves: Some(Kind::SinkholeField) }
        } else if reads::magic_rule(state, "greenwood", "oasis", place.anchor)? { Fate::Becomes(Kind::Oasis) } else { Fate::Persists }))),
    }
}
fn visible<S: MapState + RiverState + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "Dryness, separation, flow or charge, and dependent people give the spring its mark."
                .into(),
        ),
        magnitude: Slot::Value(Rc::new(greatness)),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(isolation)),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| {
            Ok((0.25 * greatness(state, place)?
                + 0.45 * local(state, place)?
                + 0.3 * isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
pub fn entry<S: CatalogueState<Schedule> + RiverState + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    Entry {
        id: Kind::Spring, group: Group::Water, name: "Spring".into(),
        recognition: Recognition { distinct: Must::Value("Fire or Greenwood spring rules, or an unfrozen natural channel head on permeable or fractured rock at a slope break; exclude frame inflow, meltwater and oases.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Groundwater emerges where rock and drainage permit, or through Fire's conduit or Greenwood's aquifer.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Recognition reads rock, river and magic."), suitability: Slot::NotApplicable("No process chooses the rising."), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Each spring form publishes its own record kind.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(record)) },
        across_maps: AcrossMaps {
            statement: Must::Value("Captured water wets the finer channel head and follows the nearest spring counterpart, retaining its realized head when absent.".into()), stands_on: Slot::Value(AreaKind::River),
            carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::Value(Rc::new(|state, carried| watered(state, &[carried.cell]))),
            counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(moved)), settle: Slot::Value(Rc::new(moved)),
            schedule: Slot::NotApplicable("Drainage cost draws the network; no additional step."),
        }, event: None,
        roles: Roles {
            true_size: super::true_sizes::sited(&super::true_sizes::SPRING), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Spring),
            fields: fields(), movement: movement(), others: others(), people: people(), time: through_time(), visibility: visible(),
            naming: Naming { statement: Must::Value("Those who drink from it name it; towns and shrines take its name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::NotApplicable("The spring predates its dependants."), lends_name_to: Slot::Value(vec![near(Kind::Settlement, 6.0), near(Kind::Shrine, 2.0)]), term: Slot::Unwritten },
        },
    }
}
