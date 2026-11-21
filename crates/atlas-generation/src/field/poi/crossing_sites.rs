use super::{
    carry_rules,
    catalogue::CatalogueState,
    community_records,
    contract::*,
    cover_shared,
    kinds::{AreaKind, Group, Kind},
    places, reads, river_courses,
    settlement_reads::attribute,
    state::State,
    values::*,
    visibility,
    work_crossings::{self, BRIDGE_FLOW, ROAD_TRAVELLERS, TRACK_TRAVELLERS},
    work_records::WorkState,
};
use crate::{
    field::{shared::Scalar, significance::measure},
    rock::ground::{queries::SurfaceResponse, GroundField},
    scale::{LengthUnit, MapScale},
    water::network::RiverSample,
};
use std::{io, rc::Rc};

const RULING_GRADE: f64 = 0.08;
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Crossing {
    Ford,
    Bridge,
}
impl Crossing {
    pub const ALL: [Self; 2] = [Self::Ford, Self::Bridge];
    fn kind(self) -> Kind {
        if self == Self::Ford {
            Kind::Ford
        } else {
            Kind::Bridge
        }
    }
    fn name(self) -> &'static str {
        if self == Self::Ford {
            "Ford"
        } else {
            "Bridge"
        }
    }
    fn found(self, state: &impl WorkState) -> io::Result<Vec<Place>> {
        let crossings = work_crossings::crossings(state)?;
        Ok(if self == Self::Ford {
            &crossings.ford
        } else {
            &crossings.bridge
        }
        .clone())
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let traffic = visibility::sized(travellers(place), ROAD_TRAVELLERS);
        Ok(if self == Self::Ford {
            traffic
        } else {
            (traffic
                + visibility::sized(
                    reads::discharge(state.field()?, place.anchor)?,
                    bridge_flow(state)? * 10.0,
                ))
                / 2.0
        })
    }
    fn suitable(self, state: &impl State, cell: usize) -> io::Result<f64> {
        let field = state.field()?;
        if self == Self::Ford {
            let shallow = 1.0 - fullness(state, cell)?;
            let banks =
                1.0 - (field.shared.scalar(Scalar::Slope).get(cell)? / RULING_GRADE).min(1.0);
            let bed = MapScale::metres(
                field
                    .ground()
                    .view(GroundField::SedimentThickness)
                    .get(cell)?,
                LengthUnit::Native,
            )
            .min(1.0);
            Ok((shallow + banks + bed) / 3.0)
        } else {
            let width = field
                .water
                .borrow()
                .river_reader()
                .sample(cell, RiverSample::Width, 0.0);
            let span = measure(&field.scale, 0.0000125, 1, 1.0)?;
            let dry = 1.0 - field.shared.scalar(Scalar::FloodplainIntensity).get(cell)? / 1000.0;
            Ok((reads::rock(field, cell, SurfaceResponse::HardestShare)?
                + span / (span + width)
                + dry)
                / 3.0)
        }
    }
    fn fate(self, state: &impl WorkState, place: &Place) -> io::Result<Fate> {
        if !river_courses::mapped_cells(state)?.has(place.anchor) {
            return Ok(Fate::Ends {
                leaves: (self == Self::Bridge).then_some(Kind::Ruin),
            });
        }
        let near =
            places::settlement_within(state, place.anchor, state.field()?.scale.cells(24.0))?;
        if self == Self::Bridge {
            return Ok(if travellers(place) >= ROAD_TRAVELLERS && near {
                Fate::Persists
            } else {
                Fate::Becomes(Kind::Ford)
            });
        }
        Ok(if !near {
            Fate::Ends { leaves: None }
        } else if travellers(place) >= ROAD_TRAVELLERS
            && reads::discharge(state.field()?, place.anchor)? >= bridge_flow(state)?
        {
            Fate::Becomes(Kind::Bridge)
        } else {
            Fate::Persists
        })
    }
}
fn travellers(place: &Place) -> f64 {
    attribute(place, "travellers", 0.0)
}
fn bridge_flow(state: &impl State) -> io::Result<f64> {
    measure(&state.field()?.scale, BRIDGE_FLOW, 3, 1.0)
}
fn fullness(state: &impl State, cell: usize) -> io::Result<f64> {
    let flow = reads::discharge(state.field()?, cell)?;
    Ok(flow / (flow + bridge_flow(state)?))
}
fn crossable(state: &impl WorkState, cell: usize) -> io::Result<bool> {
    Ok(state.field()?.water().column.kind.get(cell)? == 0
        && river_courses::mapped_cells(state)?.has(cell))
}
fn wadeable(state: &impl State, cell: usize) -> io::Result<Vec<FieldChange>> {
    Ok(vec![FieldChange::Physical(PhysicalChange {
        cell,
        band: PhysicalBand::RiverDepth,
        change: Change::AtMost(measure(&state.field()?.scale, 0.00000025, 1, 0.5)?),
    })])
}
fn graded(state: &impl State, cell: usize) -> io::Result<Vec<FieldChange>> {
    let field = state.field()?;
    let mut changes = Vec::new();
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            if field.water().column.kind.get(next)? == 0 && !reads::has_channel(field, next)? {
                changes.push(FieldChange::GradeGround {
                    cell: next,
                    gradient: RULING_GRADE,
                });
            }
        }
    }
    Ok(changes)
}
fn fields<S: State + 'static>(kind: Crossing) -> Fields<S> {
    Fields {
        statement: Must::Value("Fords keep a shallow bed and open banks; bridges grade approaches and hold the channel through their drainage cost.".into()),
        terrain: if kind == Crossing::Bridge { Slot::Value(Rc::new(|state, place| graded(state, place.anchor))) } else { Slot::NotApplicable("The ford's physical requirement is water depth.") },
        water: if kind == Crossing::Ford { Slot::Value(Rc::new(|state, place| wadeable(state, place.anchor))) } else { Slot::NotApplicable("Piers narrow the channel below the field's width resolution.") },
        climate: Slot::NotApplicable("Crossings have no climate forcing."),
        cover: if kind == Crossing::Ford { Slot::Value(Rc::new(|_, place| Ok(vec![FieldChange::Physical(PhysicalChange { cell: place.anchor, band: PhysicalBand::Scalar(Scalar::TreeCover), change: Change::AtMost(1.0 / (1.0 + (1.0 + travellers(place) / TRACK_TRAVELLERS).log2())) })]))) } else { Slot::NotApplicable("The road's own wear thins cover.") },
        magic: Slot::NotApplicable("The crossing holds no magical stock."),
    }
}
fn counterpart<S: CatalogueState<Schedule> + WorkState, Schedule>(
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        crossable(state, cell)
    })
}
fn across<S: CatalogueState<Schedule> + WorkState + 'static, Schedule: 'static>(
    kind: Crossing,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value("New ways site their crossings; a captured crossing follows the nearest channel and goes if none lies near.".into()),
        stands_on: Slot::Value(AreaKind::River), carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::Value(Rc::new(move |state, carried| match counterpart(state, carried)? { Some(cell) if kind == Crossing::Ford => wadeable(state, cell), Some(cell) => graded(state, cell), None => Ok(Vec::new()) })),
        counterpart: Slot::Value(Rc::new(counterpart)),
        unrealized: Slot::Value(Rc::new(|state, carried| Ok(counterpart(state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)))),
        settle: Slot::NotApplicable("Crossings publish after the final water round."),
        schedule: Slot::NotApplicable("Crossing drainage costs supply any channel influence."),
    }
}
fn movement<S: State + 'static>(kind: Crossing) -> Movement<S> {
    Movement { on_foot: None,
        statement: Must::Value("Known crossings reduce road taxes; boats pay for shallows or piers, and bridge abutments hold the channel.".into()),
        roads: Slot::NotApplicable("Travel crosses a river as cheap going already; a known crossing saves nothing more."),
        boats: Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, if kind == Crossing::Ford { 2.0 } else { 1.25 }, 0.0))),
        drainage: if kind == Crossing::Bridge { Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 0.9, 0.0))) } else { Slot::NotApplicable("A ford reads an existing shallow channel.") },
        magic: Slot::NotApplicable("River stock passes through; people pay ordinary road costs."),
        links: Slot::NotApplicable("A crossing is a ground step, not a distant join."),
        crosses: Slot::Value(Rc::new(move |state: &S, place| {
            let mut barriers = vec![Barrier::River];
            if kind == Crossing::Bridge {
                for edge in 0..3 {
                    if let Some(next) = state.field()?.mesh.neighbor(place.anchor, edge) {
                        if state.field()?.shared.scalar(Scalar::WetlandCover).get(next)? >= 0.3 { barriers.push(Barrier::Wetland); break; }
                    }
                }
            }
            Ok(barriers)
        })),
    }
}
fn others<S: State + 'static>(kind: Crossing) -> Others<S> {
    let mut pairs = vec![cover_shared::near(Kind::Settlement, 6.0)];
    if kind == Crossing::Bridge {
        pairs.push(Relation {
            kind: Kind::Gorge,
            holds: Rc::new(|_, a, b| Ok(places::holds(b, a))),
        });
        pairs.push(cover_shared::near(Kind::Mill, 6.0));
    }
    Others {
        statement: Must::Value("Crossings join towns; bridges pair with gorges and mills. Falls and lakes exclude crossings.".into()),
        needs: Slot::Value(vec![cover_shared::near(Kind::Settlement, 24.0)]),
        excludes: Slot::Value(vec![Relation { kind: if kind == Crossing::Ford { Kind::Bridge } else { Kind::Ford }, holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)) }, Relation { kind: Kind::Waterfall, holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)) }, Relation { kind: Kind::Lake, holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))) }]),
        contains: Slot::NotApplicable("A crossing is one point on a river."), pairs_with: Slot::Value(pairs),
    }
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(6.0))
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, state.field()?.scale.cells(6.0), |cell| {
        reads::discharge(state.field()?, cell)
    })
}
fn isolation(state: &impl WorkState, place: &Place) -> io::Result<f64> {
    visibility::alone_among(
        state,
        place,
        &work_crossings::all(state)?,
        state.field()?.scale.cells(6.0),
    )
}
fn visible<S: WorkState + 'static>(kind: Crossing) -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "Traffic, river size, crossing isolation and nearby towns determine visibility.".into(),
        ),
        magnitude: Slot::Value(Rc::new(move |state, place| kind.magnitude(state, place))),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(isolation)),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(move |state: &S, place| {
            if state.physical().is_none() || place.anchor == usize::MAX {
                return Ok(0.0);
            }
            let (m, i) = if kind == Crossing::Ford {
                (0.4, 0.4)
            } else {
                (0.5, 0.3)
            };
            Ok((m * kind.magnitude(state, place)?
                + 0.2 * local(state, place)?
                + i * isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
fn naming<S: State + 'static>(kind: Crossing) -> Naming<S> {
    Naming {
        statement: Must::Value("People name crossings for their use or nearby town, and towns can take the crossing's name.".into()),
        named_by: Slot::Value(Rc::new(places::naming_culture_near)),
        takes_name_from: if kind == Crossing::Bridge { Slot::Value(vec![NameRelation { relation: cover_shared::near(Kind::Settlement, 6.0), chance: None }]) } else { Slot::NotApplicable("The river and crossing use are not catalogue places.") },
        lends_name_to: Slot::Value(vec![cover_shared::near(Kind::Settlement, 6.0)]), term: Slot::Unwritten,
    }
}
pub fn entry<S: CatalogueState<Schedule> + WorkState + 'static, Schedule: 'static>(
    kind: Crossing,
) -> Entry<S, Schedule> {
    Entry {
        id: kind.kind(), group: Group::Settlements, name: kind.name().into(),
        recognition: Recognition { distinct: Must::Value("A way crosses a land channel; busy roads over sufficient discharge earn bridges and other crossings are fords.".into()), is_a: Must::Value(Rc::new(move |state, cell| places::holds_record(state, kind.kind(), cell, || kind.found(state)))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Regional ways create crossings away from seat cells; world roads pay crossing costs without publishing sites.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(move |state, cell| Ok(crossable(state, cell)? && (kind == Crossing::Ford || reads::discharge(state.field()?, cell)? >= bridge_flow(state)?)))), suitability: Slot::Value(Rc::new(move |state, cell| kind.suitable(state, cell))), places: Must::Value(Rc::new(move |state| kind.found(state))) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Publish each crossing once after tracing ways.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(community_records::once_written)) },
        across_maps: across(kind), event: None,
        roles: Roles {
            true_size: super::true_sizes::crossing(kind == Crossing::Bridge), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::crossing_account(kind.kind()), fields: fields(kind), movement: movement(kind), others: others(kind),
            people: People { statement: Must::Value("Crossings carry trade and provide defensible choke points; high water makes fords dangerous.".into()), offers: Slot::Value(Rc::new(move |_, place| { let traffic = visibility::sized(travellers(place), ROAD_TRAVELLERS); Ok([(Benefit::Trade, traffic), (Benefit::Defence, traffic / if kind == Crossing::Ford { 3.0 } else { 2.0 })].into_iter().collect()) })), threatens: if kind == Crossing::Ford { Slot::Value(Rc::new(|state: &S, place| Ok(vec![Hazard { hazard: "drowning in spate".into(), reach: state.field()?.scale.cells(1.0), severity: fullness(state, place.anchor)? }]))) } else { Slot::NotApplicable("Bridges reduce crossing danger; destructive floods are separate places.") } },
            time: ThroughTime { statement: Must::Value("Traffic can earn a bridge or leave it a ford; a moving river ends the crossing and strands a bridge's ruin.".into()), fate: Slot::Value(Rc::new(move |state, place| kind.fate(state, place))) }, visibility: visible(kind), naming: naming(kind),
        },
    }
}
