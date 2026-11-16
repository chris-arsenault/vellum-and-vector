use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    kinds::{Group, Kind},
    map_records::{self, MapState, Record},
    places, reads,
    state::State,
    values::*,
    visibility, water_reads,
};
use crate::{
    features::{Feature, FeatureSelection},
    field::{
        geographic_regions::{self, Components},
        refinement::network::Lake,
        shared::{CellCode, Scalar},
        significance::{measure, EXCEPTIONAL_LAKE_AREA, LAKE_DEPTH},
    },
    hpc::BitSet,
    lattice::Membership,
    scale::{LengthUnit, MapScale},
    water::{
        column::{Store, NO_WATER_SURFACE},
        routing::LakeMembership,
        significance::OUTLET_DISCHARGE,
    },
};
use atlas_map::Geometry;
use std::{io, rc::Rc};

const LAKE_SHORE_DEPTH: f64 = 0.000000125;
const SHALLOWEST: f64 = 0.00000025;
const ARID_RAIN: f64 = 0.25;
const SHORE_MOISTURE: f64 = 400.0;

pub trait LakeState: MapState {
    fn lake_outline(&self, body: i32) -> Option<&Geometry>;
    fn inherited_height(&self, cell: usize) -> io::Result<f64>;
}
pub type LakeReader<S> = Rc<dyn Fn(&S) -> io::Result<Vec<Lake>>>;
fn is_a(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(state.field()?.water().column.kind.get(cell)? == 2)
}
fn depth(state: &impl State, place: &Place) -> io::Result<f64> {
    state
        .field()?
        .water()
        .column
        .store(Store::Standing)
        .held(place.anchor)
}
fn found(state: &impl State) -> io::Result<Vec<Place>> {
    Ok(state
        .held()
        .get("places:lake", || {
            let field = state.field()?;
            let water = field.water();
            let membership = LakeMembership::read(&water.column.kind, &water.column.body)?;
            let depths = water.column.store(Store::Standing);
            let mut found = Vec::new();
            for members in membership.bodies() {
                let cells: Vec<_> = members
                    .iter()
                    .copied()
                    .filter(|&cell| field.mesh.membership(cell) == Membership::Content)
                    .collect();
                let Some(&first) = cells.first() else {
                    continue;
                };
                let mut anchor = first;
                for &cell in &cells {
                    if depths.held(cell)? > depths.held(anchor)? {
                        anchor = cell;
                    }
                }
                let mut place = Place::at(Kind::Lake, anchor, cells);
                place.id = format!("lake:{}", water.column.body.get(anchor)?);
                found.push(place);
            }
            Ok(found)
        })?
        .as_ref()
        .clone())
}
fn record(state: &impl LakeState, place: &Place) -> io::Result<Option<Feature>> {
    let water = state.field()?.water();
    let body = water.column.body.get(place.anchor)?;
    let Some(shape) = state.lake_outline(body) else {
        return Ok(None);
    };
    let bounds = state.spatial().bounds(shape).map_err(io::Error::other)?;
    let key = [bounds.0, bounds.1, bounds.2, bounds.3]
        .iter()
        .map(|value| format!("{value:.3}"))
        .collect::<Vec<_>>()
        .join(":");
    let mut attributes = crate::features::records::Attributes::new();
    attributes.insert("sourceAlgorithm".into(), "atlas-1".into());
    attributes.insert("waterBody".into(), body.into());
    attributes.insert(
        "waterLevel".into(),
        MapScale::metres(water.column.surface.get(place.anchor)?, LengthUnit::Native).into(),
    );
    attributes.insert(
        "area".into(),
        state
            .spatial()
            .area(shape)
            .map_err(io::Error::other)?
            .into(),
    );
    attributes.insert("depth".into(), depth(state, place)?.into());
    Ok(Some(map_records::generated(
        state,
        Record {
            key: &format!("lake:{key}"),
            name: &format!("Lake {body}"),
            kind: "lake",
            layer: "lakes",
            geometry: shape.clone(),
            attributes,
        },
    )?))
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    Crater,
    Reservoir,
    Basin,
}
pub fn lake_origin(state: &impl State, place: &Place) -> io::Result<Origin> {
    for &cell in &place.cells {
        if reads::magic_rule(state, "fire", "crater", cell)? {
            return Ok(Origin::Crater);
        }
    }
    let field = state.field()?;
    for dam in state.features().values(FeatureSelection {
        kind: Some("dam"),
        ..Default::default()
    })? {
        let Some(cell) = reads::feature_cell(field, &dam?) else {
            continue;
        };
        if place.cells.contains(&cell) {
            return Ok(Origin::Reservoir);
        }
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                if is_a(state, next)? && place.cells.contains(&next) {
                    return Ok(Origin::Reservoir);
                }
            }
        }
    }
    Ok(Origin::Basin)
}
fn area_size(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    Ok(visibility::sized(
        water_reads::area_of(field, place),
        measure(&field.scale, EXCEPTIONAL_LAKE_AREA, 2, 1.0)?,
    ))
}
fn greatness(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    let flow = field.water().flow.mean;
    let mut throughflow = 0.0f64;
    for &cell in &place.cells {
        throughflow = throughflow.max(flow.get(cell)?);
    }
    Ok(area_size(state, place)?
        .max(visibility::sized(
            depth(state, place)?,
            measure(&field.scale, LAKE_DEPTH, 1, 0.5)?,
        ))
        .max(visibility::sized(
            throughflow,
            measure(&field.scale, OUTLET_DISCHARGE, 3, 1.0)?,
        )))
}
fn around(state: &impl State) -> io::Result<f64> {
    Ok(state.field()?.scale.cells(8.0))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, around(state)?, |cell| {
        Ok(f64::from(is_a(state, cell)?))
    })
}
fn isolation(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::alone_among(state, place, &found(state)?, around(state)?)
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, around(state)?)
}
fn shore_cells(state: &impl State, place: &Place) -> io::Result<Vec<usize>> {
    let field = state.field()?;
    let mut seen = BitSet::new(field.mesh.len());
    let mut shore = Vec::new();
    for &cell in &place.cells {
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                if !seen.has(next) && field.water().column.kind.get(next)? == 0 {
                    seen.add(next);
                    shore.push(next);
                }
            }
        }
    }
    Ok(shore)
}
fn damp_shore(state: &impl State, place: &Place) -> io::Result<Vec<FieldChange>> {
    let value = (SHORE_MOISTURE * area_size(state, place)? + 0.5).floor();
    Ok(shore_cells(state, place)?
        .into_iter()
        .map(|cell| {
            FieldChange::Physical(PhysicalChange {
                band: PhysicalBand::Scalar(Scalar::Moisture),
                cell,
                change: Change::AtLeast(value),
            })
        })
        .collect())
}
/// Read captured depth taper and levels before the finer network develops its relief.
pub fn captured_lakes(state: &impl LakeState) -> io::Result<Vec<Lake>> {
    let field = state.field()?;
    let water = field.water();
    let threshold = measure(&field.scale, LAKE_SHORE_DEPTH, 1, 0.5)?;
    let standing = water.column.store(Store::Standing);
    let regions = geographic_regions::components(
        state,
        &|cell| {
            let kind = water.column.kind.get(cell)?;
            if kind == 1 || standing.held(cell)? <= threshold {
                return Ok(false);
            }
            if kind == 2 {
                return Ok(true);
            }
            for edge in 0..3 {
                if let Some(next) = field.mesh.neighbor(cell, edge) {
                    if water.column.kind.get(next)? == 2 {
                        return Ok(true);
                    }
                }
            }
            Ok(false)
        },
        Components {
            polygonal: false,
            splits: false,
        },
        None,
    )?;
    regions
        .regions
        .into_iter()
        .map(|region| {
            let mut level = 0.0;
            for &cell in &region.members {
                let surface = water.column.surface.get(cell)?;
                level += if surface == NO_WATER_SURFACE {
                    state.inherited_height(cell)? + MapScale::native(standing.held(cell)?)
                } else {
                    surface
                } - water.effective_sea_level;
            }
            Ok(Lake {
                level: MapScale::metres(level / region.members.len() as f64, LengthUnit::Native),
                cells: region.members,
            })
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
fn near<S: State + 'static>(kind: Kind, spans: f64) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |state, a, b| {
            places::within(state, a, b, state.field()?.scale.cells(spans))
        }),
    }
}
fn holds<S>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(a.cells.contains(&b.anchor))),
    }
}
fn fields<S: State + 'static>() -> Fields<S> {
    Fields {
        statement: Must::Value(
            "Routing holds the lake's level and outlet; its water damps the shore.".into(),
        ),
        terrain: Slot::NotApplicable("Erosion and sediment own the bed."),
        water: Slot::NotApplicable("Routing owns lake fill and outlet."),
        climate: Slot::Value(Rc::new(damp_shore)),
        cover: Slot::NotApplicable("Ecology reads shallow water."),
        magic: Slot::NotApplicable("Salt remembers lakes through its own process."),
    }
}
fn movement<S: State + 'static>() -> Movement<S> {
    Movement {
        statement: Must::Value(
            "Boats cross cheaply; roads follow the level shore and drainage grows from the lake."
                .into(),
        ),
        roads: Slot::Value(Rc::new(|state, place| {
            Ok(shore_cells(state, place)?
                .into_iter()
                .map(|cell| Cost { cell, factor: 0.85 })
                .collect())
        })),
        boats: Slot::Value(Rc::new(|state, place| {
            carry_rules::cost_near(state, place, 0.5, 0.0)
        })),
        drainage: Slot::Value(Rc::new(|state, place| {
            carry_rules::cost_near(state, place, 0.7, 0.0)
        })),
        magic: Slot::NotApplicable(
            "Roots stop at open water and rivers carry stock through it under their own rules.",
        ),
        links: Slot::NotApplicable("Walkers gain no link across a lake."),
        crosses: Slot::NotApplicable("Boats use their own cost."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value("Dams and craters hold lakes, springs rise in them, and towns and harbours stand beside them.".into()),
        needs: Slot::NotApplicable("Its water is its own requirement."), excludes: Slot::Value(vec![holds(Kind::Settlement), holds(Kind::Waterfall)]),
        contains: Slot::Value(vec![holds(Kind::Spring)]), pairs_with: Slot::Value(vec![near(Kind::Dam, 8.0), near(Kind::Crater, 2.0), near(Kind::Settlement, 8.0), near(Kind::Harbour, 3.0)]),
    }
}
fn threatens(state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let field = state.field()?;
    let mut outburst = lake_origin(state, place)? == Origin::Reservoir;
    let landform = field.shared.code(CellCode::LandformCodes);
    for &cell in &place.cells {
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                outburst |= landform.get(next)? == 12;
            }
        }
    }
    Ok(if outburst {
        vec![Hazard {
            hazard: "outburst flood".into(),
            reach: 2.0 * around(state)?,
            severity: greatness(state, place)?,
        }]
    } else {
        Vec::new()
    })
}
fn people<S: State + 'static>() -> People<S> {
    People {
        statement: Must::Value(
            "Lakes give water, fish and trade; moraine or failing dams threaten outburst floods."
                .into(),
        ),
        offers: Slot::Value(Rc::new(|state, place| {
            let great = greatness(state, place)?;
            Ok([
                (Benefit::Water, great),
                (Benefit::Food, great / 2.0),
                (Benefit::Trade, great / 2.0),
            ]
            .into_iter()
            .collect())
        })),
        threatens: Slot::Value(Rc::new(threatens)),
    }
}
fn through_time<S: State + 'static>() -> ThroughTime<S> {
    ThroughTime {
        statement: Must::Value(
            "Filled or drained lakes leave wetlands, or salt pans in arid country.".into(),
        ),
        fate: Slot::Value(Rc::new(|state, place| {
            let field = state.field()?;
            Ok(
                if depth(state, place)? >= measure(&field.scale, SHALLOWEST, 1, 0.5)? {
                    Fate::Persists
                } else {
                    Fate::Ends {
                        leaves: Some(
                            if field.shared.scalar(Scalar::Rainfall).get(place.anchor)? / 1000.0
                                < ARID_RAIN
                            {
                                Kind::SaltPan
                            } else {
                                Kind::Wetland
                            },
                        ),
                    }
                },
            )
        })),
    }
}
fn visible<S: State + 'static>() -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "Area, depth or throughflow, isolation and shore settlements determine visibility."
                .into(),
        ),
        magnitude: Slot::Value(Rc::new(greatness)),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(isolation)),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(|state, place| {
            Ok((0.6 * greatness(state, place)?
                + 0.25 * local(state, place)?
                + 0.15 * isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
pub fn entry<S: CatalogueState<Schedule> + LakeState + 'static, Schedule: 'static>(
    schedule: impl FnOnce(LakeReader<S>) -> Schedule,
) -> Entry<S, Schedule> {
    Entry {
        id: Kind::Lake, group: Group::Water, name: "Lake".into(),
        recognition: Recognition { distinct: Must::Value("Lake-coded standing water owns its body and level; ocean and wet ground are separate kinds.".into()), is_a: Must::Value(Rc::new(is_a)), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Routing fills closed basins, craters and reservoirs where runoff sustains them.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Routing determines fill."), suitability: Slot::NotApplicable("No process sites it."), places: Must::Value(Rc::new(found)) },
        publication: Publication { statement: Must::Value("Publish the traced shoreline with body and level for river-mouth clipping.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(record)) },
        across_maps: AcrossMaps {
            statement: Must::Value("Captured depth and level seed the finer network; records follow a refined counterpart or go if no body remains.".into()), stands_on: Slot::Unwritten,
            carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::NotApplicable("The schedule reads captured water; routing holds it."),
            counterpart: Slot::Value(Rc::new(counterpart)), unrealized: Slot::Value(Rc::new(|state, carried| Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)))),
            settle: Slot::NotApplicable("Routing holds the captured level."), schedule: Slot::Value(schedule(Rc::new(captured_lakes))),
        }, event: None,
        roles: Roles {
            true_size: super::true_sizes::extent(), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(Kind::Lake),
            fields: fields(), movement: movement(), others: others(), people: people(), time: through_time(), visibility: visible(),
            naming: Naming { statement: Must::Value("Shore people name it; reservoirs may take dam names and towns borrow lake names.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(vec![NameRelation { relation: near(Kind::Dam, 8.0), chance: None }]), lends_name_to: Slot::Value(vec![near(Kind::Settlement, 8.0)]), term: Slot::Unwritten },
        },
    }
}
