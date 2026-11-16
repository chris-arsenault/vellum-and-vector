use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    kinds::{Group, Kind},
    places, reads, records, sites,
    state::State,
    values::*,
    visibility, water_reads,
};
use crate::{
    ecology::{
        environment::{wetland, STANDING_WATER_SLOPE},
        regions::wetland_kind,
    },
    features::records::Attributes,
    field::{
        shared::Scalar,
        significance::{measure, LANDSCAPE_MINIMUM_AREA},
    },
    rock::ground::{queries::SurfaceResponse, GroundField},
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};
const FEVER_WARMTH: f64 = 18.0;
fn is_a(state: &impl State, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    Ok(wetland(
        field.water().column.kind.get(cell)?,
        field.shared.scalar(Scalar::WetlandCover).get(cell)?,
    ))
}
fn cover(state: &impl State, cell: usize) -> io::Result<f64> {
    state.field()?.shared.scalar(Scalar::WetlandCover).get(cell)
}
fn found(state: &impl State) -> io::Result<Vec<Place>> {
    Ok(places::region_places(
        state,
        Kind::Wetland,
        |cell| is_a(state, cell),
        |cell| cover(state, cell),
    )?
    .as_ref()
    .clone())
}
fn around(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(6.0))
}
fn greatness(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    Ok(visibility::sized(
        water_reads::area_of(field, place),
        measure(&field.scale, LANDSCAPE_MINIMUM_AREA, 2, 1.0)?,
    ))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, around(state)?, |cell| cover(state, cell))
}
fn isolation(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn mean(state: &impl State, place: &Place, band: Scalar) -> io::Result<f64> {
    let field = state.field()?;
    let read = field.shared.scalar(band);
    let mut total = 0.0;
    let mut sum = 0.0;
    for &cell in &place.cells {
        let area = field.mesh.area(cell);
        total += area;
        sum += read.get(cell)? * area;
    }
    Ok(sum / total)
}
fn record(
    state: &impl super::map_records::MapState,
    place: &Place,
) -> io::Result<Option<crate::features::Feature>> {
    let biome = wetland_kind(
        mean(state, place, Scalar::PeatCarbon)?,
        mean(state, place, Scalar::FloodFrequency)?,
        mean(state, place, Scalar::BroadleafCover)?,
        mean(state, place, Scalar::ConiferCover)?,
    );
    let mut attributes = Attributes::new();
    attributes.insert("biome".into(), biome.into());
    attributes.insert(
        "wetlandCover".into(),
        mean(state, place, Scalar::WetlandCover)?.into(),
    );
    records::area(
        state,
        place,
        records::Shape {
            kind: "wetland",
            layer: "ecology",
            name: biome,
            attributes,
        },
        Some(&|cell| cover(state, cell)),
    )
}
fn flat(cells: &[usize]) -> Vec<FieldChange> {
    cells
        .iter()
        .map(|&cell| FieldChange::GradeGround {
            cell,
            gradient: STANDING_WATER_SLOPE,
        })
        .collect()
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        is_a(state, cell)
    })
}
fn realize<S: CatalogueState<Schedule>, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let water = field.water().column.kind;
    let mut cells = Vec::new();
    for cell in sites::within(&field.mesh, carried.cell, state.parent_cell_span() / 2.0) {
        if water.get(cell)? == 0 {
            cells.push(cell);
        }
    }
    Ok(flat(&cells))
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
        statement: Must::Value("Wetland stores water, brakes floods and holds flat ground; ecology and climate own its soil, cover and runoff.".into()), terrain: Slot::Value(Rc::new(|_, place| Ok(flat(&place.cells)))),
        water: Slot::NotApplicable("Ecology soil balance writes the water."), climate: Slot::NotApplicable("Climate already reads evapotranspiration."), cover: Slot::NotApplicable("Ecology establishment and waterlogging own cover and trees."), magic: Slot::NotApplicable("Peat sources and anoxic preservation already read wetland and peat."),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    let roots: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 0.8, 0.0));
    Movement {
        statement: Must::Value("Carts need causeways, shallow boats move slowly, drainage loses its way and roots follow connected cover.".into()),
        roads: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 3.0, 0.0))), boats: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 2.0, 0.0))), drainage: Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 1.5, 0.0))),
        magic: Slot::Value([(Carrier::Roots, roots)].into_iter().collect()), links: Slot::NotApplicable("A causeway is a road's own."), crosses: Slot::NotApplicable("The wetland is the barrier, not its crossing."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value("Excludes lake surfaces and settlement seats; gathers near mouths, melt lines and lakes, often on ground clearance would drain.".into()), needs: Slot::NotApplicable("Cover already implies wet ground."),
        excludes: Slot::Value(vec![Relation { kind: Kind::Lake, holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))) }, Relation { kind: Kind::Settlement, holds: Rc::new(|_, a, b| Ok(a.cells.contains(&b.anchor))) }]),
        contains: Slot::NotApplicable("It contains cover, not another owned place kind."), pairs_with: Slot::Value(vec![near(Kind::RiverMouth, 3.0), near(Kind::MeltLine, 3.0), near(Kind::Lake, 3.0), near(Kind::Clearance, 6.0)]),
    }
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value(
            "Fish, birds, reeds, peat and refuge; warm standing water brings fever to neighbors."
                .into(),
        ),
        offers: Slot::Value(Rc::new(|state, place| {
            let great = greatness(state, place)?;
            let peat = state
                .field()?
                .shared
                .scalar(Scalar::PeatCarbon)
                .get(place.anchor)?;
            Ok([
                (Benefit::Food, great),
                (Benefit::Defence, great / 2.0),
                (Benefit::Materials, (peat / 20.0).min(1.0)),
            ]
            .into_iter()
            .collect())
        })),
        threatens: Slot::Value(Rc::new(|state, place| {
            Ok(
                if reads::celsius(state.field()?, place.anchor)? > FEVER_WARMTH
                    && places::settlement_within(state, place.anchor, around(state)?)?
                {
                    vec![Hazard {
                        hazard: "fever".into(),
                        reach: around(state)? / 2.0,
                        severity: 0.4,
                    }]
                } else {
                    Vec::new()
                },
            )
        })),
    }
}
fn through_time<S: State + 'static>() -> ThroughTime<S> {
    ThroughTime {
        statement: Must::Value(
            "It fills with peat and sediment; drying may leave grassland on deep soft ground."
                .into(),
        ),
        fate: Slot::Value(Rc::new(|state, place| {
            if is_a(state, place.anchor)? {
                return Ok(Fate::Persists);
            }
            let field = state.field()?;
            let soft = reads::rock(field, place.anchor, SurfaceResponse::HardestShare)? < 0.5
                && MapScale::metres(
                    field
                        .ground()
                        .view(GroundField::SedimentThickness)
                        .get(place.anchor)?,
                    LengthUnit::Native,
                ) >= 1.0;
            Ok(Fate::Ends {
                leaves: soft.then_some(Kind::Grassland),
            })
        })),
    }
}
fn visible<S: State + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "Area, contrast with dry ground and nearby people establish its significance.".into(),
        ),
        magnitude: Slot::Value(Rc::new(greatness)),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(isolation)),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| {
            Ok((0.55 * greatness(state, place)?
                + 0.35 * local(state, place)?
                + 0.1 * isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
fn naming<S: State + 'static>() -> Naming<S> {
    Naming {
        statement: Must::Value("Named by people at its edge; its residents take its name.".into()),
        named_by: Slot::Value(Rc::new(places::naming_culture_near)),
        takes_name_from: Slot::NotApplicable("Named for what it is, not a nearby place."),
        lends_name_to: Slot::Value(vec![near(Kind::Settlement, 6.0)]),
        term: Slot::Unwritten,
    }
}
fn across_maps<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> AcrossMaps<S, Schedule>
{
    AcrossMaps {
        statement: Must::Value("Flat finer land within half a parent cell develops its own cover; without cover the captured wetland goes.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::Value(Rc::new(realize)), counterpart: Slot::Value(Rc::new(counterpart)),
        unrealized: Slot::Value(Rc::new(|state, carried| Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)))), settle: Slot::Value(Rc::new(|state, carried| Ok(carry_rules::moves_to(counterpart(state, carried)?)))), schedule: Slot::NotApplicable("Ecology grows it; no separate refinement step."),
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::Wetland, group: Group::Water, name: "Wetland".into(), recognition: Recognition { distinct: Must::Value("Land with wetland cover at the ecology threshold; peat, flood and canopy distinguish bog, marsh and swamp.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Ecology establishes cover on flat, flooding or poorly drained ground, including thaw fens and delta marsh.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Cover carries the conditions it read."), suitability: Slot::NotApplicable("Ecology establishes it without a siting step."), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Publish its cover outline as a bog, marsh or swamp.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(record)) }, across_maps: across_maps(), event: None,
        roles: Roles { true_size: super::true_sizes::extent(), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Wetland), fields: fields(), movement: movement(), others: others(), people: people(), time: through_time(), visibility: visible(), naming: naming() },
    }
}
