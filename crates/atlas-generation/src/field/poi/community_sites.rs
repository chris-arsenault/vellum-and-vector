use super::{
    carry_rules,
    community_records::{self, CommunityPublication, CommunityState},
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads,
    settlement_reads::{self as settled, SettlementState},
    sites::Sites,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{refinement::topology::distance, shared::Scalar, significance::measure},
    hpc::BitSet,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Community {
    Settlement,
    Ruin,
}
impl Community {
    fn kind(self) -> Kind {
        if self == Self::Settlement {
            Kind::Settlement
        } else {
            Kind::Ruin
        }
    }
    fn name(self) -> &'static str {
        if self == Self::Settlement {
            "Settlement"
        } else {
            "Ruin"
        }
    }
    fn found(self, state: &impl CommunityState) -> io::Result<Vec<Place>> {
        Ok(community_records::places(state, self.kind())?
            .as_ref()
            .clone())
    }
    fn magnitude(self, place: &Place) -> f64 {
        let people = if self == Self::Settlement {
            population(place)
        } else {
            place.feature.as_ref().map_or(0.0, |f| {
                settled::attribute(place, "peakPopulation", 0.0).max(settled::people_of(f))
            })
        };
        visibility::sized(
            people,
            if self == Self::Settlement {
                5000.0
            } else {
                3000.0
            },
        )
    }
    fn cultural(self, state: &impl State, place: &Place) -> io::Result<f64> {
        if self == Self::Settlement {
            return Ok(match role(place) {
                "capital" => 1.0,
                "regionalCapital" => 0.75,
                "marketTown" => 0.5,
                _ => 0.0,
            });
        }
        let former: f64 = match role(place) {
            "capital" => 0.8,
            "regionalCapital" => 0.55,
            "marketTown" => 0.3,
            _ => 0.0,
        };
        let marked = place.feature.as_ref().is_some_and(|f| {
            f.attributes.get("fortress").and_then(|v| v.as_bool()) == Some(true)
                || f.attributes.contains_key("ruinField")
        });
        Ok(
            visibility::attachment(state, place, state.field()?.scale.cells(8.0))?
                .max(former)
                .max(if marked { 0.5 } else { 0.0 }),
        )
    }
    fn local(self, state: &impl CommunityState, place: &Place) -> io::Result<f64> {
        if self == Self::Ruin {
            return Ok(1.0 - visibility::attachment(state, place, state.field()?.scale.cells(8.0))?);
        }
        let field = state.field()?;
        let reach = field.scale.cells(8.0);
        let towns = self.found(state)?;
        let index = Sites::new(
            state.spatial(),
            &field.mesh,
            towns.iter().map(|p| p.anchor).collect(),
        )?;
        let mut near = BitSet::new(field.mesh.len());
        for cell in index.around(&field.mesh, place.anchor, reach)? {
            if distance(&field.mesh, cell, place.anchor) <= reach {
                near.add(cell);
            }
        }
        let local: f64 = towns
            .iter()
            .filter(|p| near.has(p.anchor))
            .map(population)
            .sum();
        Ok(if local > 0.0 {
            population(place) / local
        } else {
            0.0
        })
    }
    fn suitable(self, state: &impl State, cell: usize) -> io::Result<f64> {
        let field = state.field()?;
        let flat = 1.0 - (field.shared.scalar(Scalar::Slope).get(cell)? / 0.12).min(1.0);
        if self == Self::Ruin {
            let scar = f64::from(reads::magic_rule(state, "fire", "scar", cell)?).max(
                share_around(state, cell, |next| {
                    reads::magic_rule(state, "fire", "scar", next)
                })?,
            );
            return Ok((flat + scar) / 2.0);
        }
        let water =
            f64::from(reads::has_channel(field, cell)?).max(share_around(state, cell, |next| {
                Ok(field.water().column.kind.get(next)? != 0)
            })?);
        let soil = (MapScale::metres(
            field
                .ground()
                .view(GroundField::SedimentThickness)
                .get(cell)?,
            LengthUnit::Native,
        ) / measure(&field.scale, 0.00000025, 1, 0.5)?)
        .min(1.0);
        Ok((flat + water + soil) / 3.0)
    }
}
fn role(place: &Place) -> &str {
    place
        .feature
        .as_ref()
        .and_then(|f| f.attributes.get("settlementRole"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
}
fn population(place: &Place) -> f64 {
    settled::attribute(place, "population", 0.0)
}
fn share_around(
    state: &impl State,
    cell: usize,
    test: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<f64> {
    let mut all = 0;
    let mut met = 0;
    for edge in 0..3 {
        if let Some(next) = state.field()?.mesh.neighbor(cell, edge) {
            all += 1;
            met += usize::from(test(next)?);
        }
    }
    Ok(if all == 0 {
        0.0
    } else {
        met as f64 / all as f64
    })
}
fn visible<S: CommunityState + 'static>(kind: Community) -> Visibility<S> {
    Visibility {
        statement: Must::Value("Population, surrounding communities, isolation and current or remembered rank determine visibility.".into()), magnitude: Slot::Value(Rc::new(move |_, place| Ok(kind.magnitude(place)))), local_conditions: Slot::Value(Rc::new(move |state, place| kind.local(state, place))),
        isolation: Slot::Value(Rc::new(move |state: &S, place| visibility::alone_among(state, place, &kind.found(state)?, state.field()?.scale.cells(16.0)))), cultural: Slot::Value(Rc::new(move |state, place| kind.cultural(state, place))),
        importance: Must::Value(Rc::new(move |state: &S, place| {
            if state.physical().is_none() || place.anchor == usize::MAX { return Ok(0.0); }
            let (m,l,i) = if kind == Community::Settlement { (0.6,0.1,0.3) } else { (0.5,0.25,0.25) };
            Ok((m * kind.magnitude(place) + l * kind.local(state, place)? + i * visibility::alone_among(state, place, &kind.found(state)?, state.field()?.scale.cells(16.0))?).max(kind.cultural(state, place)?))
        })),
    }
}
fn fields<S>(kind: Community) -> Fields<S> {
    Fields {
        statement: Must::Value(if kind == Community::Settlement { "People work across their hinterlands; the seat's refinement schedule grades its footprint." } else { "An empty community stops acting; ordinary succession restores its former land." }.into()),
        terrain: Slot::NotApplicable("The common seat schedule grades living and abandoned captured seats."), water: Slot::NotApplicable("Dams and irrigation own water works."), climate: Slot::NotApplicable("A seat's warmth is below climate resolution."), cover: Slot::NotApplicable("People's land layers and ecological succession own cover."), magic: Slot::NotApplicable("People's owners write tenure; Hallowed reads inhabited seats without a duplicate declaration."),
    }
}
fn across<S: CommunityState + 'static, Schedule>(
    schedule: Slot<Schedule>,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value("Captured seats retain identity, grade their footprints and follow their own settled evidence; ruins use the same seat schedule.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::NotApplicable("The settlement schedule restores every captured seat's graded ground."), counterpart: Slot::Value(Rc::new(|state: &S, carried| Ok(Some(state.seat_cell(&carried.feature.id).unwrap_or(carried.cell))))),
        unrealized: Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep))), settle: Slot::Value(Rc::new(|state: &S, carried| Ok(match state.seat_cell(&carried.feature.id) { Some(cell) if cell != carried.cell => Unrealized::Move(cell), _ => Unrealized::Keep }))), schedule,
    }
}
fn movement<S: State + 'static>(kind: Community) -> Movement<S> {
    let people: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 0.8, 0.0));
    Movement {
        statement: Must::Value("Living traffic wears routes and carries stock; ruins leave an easier old roadbed and cut stone.".into()), roads: Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, if kind == Community::Settlement { 0.6 } else { 0.85 }, measure(&state.field()?.scale, if kind == Community::Settlement { 0.0005 } else { 0.00025 }, 1, 1.0)?))),
        boats: Slot::NotApplicable("Harbours own the boat connection."), drainage: Slot::NotApplicable("The settlement schedule supplies river-seat corridor influence."), magic: if kind == Community::Settlement { Slot::Value([(Carrier::People, people)].into_iter().collect()) } else { Slot::NotApplicable("The former carriers have left.") }, links: Slot::NotApplicable("Roads and doors supply connections."), crosses: Slot::NotApplicable("The seat is a route endpoint, not a barrier crossing."),
    }
}
fn others<S: State + 'static>(kind: Community) -> Others<S> {
    let excludes = if kind == Community::Settlement {
        Relation {
            kind: Kind::Lake,
            holds: Rc::new(|_: &S, a: &Place, b: &Place| Ok(b.cells.contains(&a.anchor)))
                as RelationRule<S>,
        }
    } else {
        Relation {
            kind: Kind::Settlement,
            holds: Rc::new(|_: &S, a: &Place, b: &Place| Ok(a.anchor == b.anchor))
                as RelationRule<S>,
        }
    };
    let pairs = if kind == Community::Settlement {
        [Kind::Ford, Kind::Bridge, Kind::Mill, Kind::Harbour]
            .into_iter()
            .map(|k| cover_shared::near(k, 8.0))
            .collect()
    } else {
        vec![
            cover_shared::near(Kind::Battlefield, 8.0),
            cover_shared::near(Kind::DisasterSite, 8.0),
            cover_shared::near(Kind::KillingGround, 8.0),
            cover_shared::near(Kind::ThermalVein, 1.0),
        ]
    };
    Others {
        statement: Must::Value("Living seats host practices and pair with transport works; ruins pair with the events and material that outlasted their people.".into()), needs: Slot::NotApplicable("A living seat requires suitable ground; a ruin needs nothing still standing."), excludes: Slot::Value(vec![excludes]),
        contains: if kind == Community::Settlement { Slot::Value([Kind::Shrine, Kind::Forge, Kind::Archive].into_iter().map(|k| cover_shared::near(k, 1.0)).collect()) } else { Slot::NotApplicable("Surviving works are separate places.") }, pairs_with: Slot::Value(pairs),
    }
}
fn naming<S: State + 'static>(kind: Community) -> Naming<S> {
    let takes = if kind == Community::Settlement {
        [(Kind::Peak, 6.0), (Kind::Waterfall, 8.0)]
            .into_iter()
            .map(|(kind, spans)| NameRelation {
                relation: Relation {
                    kind,
                    holds: Rc::new(move |state: &S, town, landmark| {
                        Ok(!matches!(role(town), "capital" | "regionalCapital")
                            && places::within(
                                state,
                                town,
                                landmark,
                                state.field()?.scale.cells(spans),
                            )?)
                    }),
                },
                chance: Some(0.2),
            })
            .collect()
    } else {
        vec![NameRelation {
            relation: Relation {
                kind: Kind::Settlement,
                holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)),
            },
            chance: None,
        }]
    };
    Naming {
        statement: Must::Value("People name living towns; polity seats keep their names. Ruins retain the former community's name and naming culture.".into()),
        named_by: Slot::Value(if kind == Community::Settlement { Rc::new(places::naming_culture_near) } else { Rc::new(settled::culture) }), takes_name_from: Slot::Value(takes),
        lends_name_to: Slot::Value(if kind == Community::Settlement { vec![Relation { kind: Kind::Ruin, holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)) }] } else { vec![cover_shared::near(Kind::Settlement, 8.0)] }), term: Slot::Unwritten,
    }
}
fn people<S: SettlementState + 'static>(kind: Community) -> People<S> {
    People {
        statement: Must::Value("Living seats supply markets and defence; ruins supply cut stone and memory, sometimes with restless dead.".into()),
        offers: Slot::Value(Rc::new(move |state, place| { let size = kind.magnitude(place); Ok(if kind == Community::Settlement { [(Benefit::Trade, size), (Benefit::Defence, size.max(kind.cultural(state, place)?))] } else { [(Benefit::Materials, size), (Benefit::Sanctity, kind.cultural(state, place)? / 2.0)] }.into_iter().collect()) })),
        threatens: if kind == Community::Ruin { Slot::Value(Rc::new(settled::restless_dead)) } else { Slot::NotApplicable("Sieges and disasters are separate historical places.") },
    }
}
fn entry<S: SettlementState + 'static, Schedule>(
    kind: Community,
    record: CommunityPublication<S>,
    schedule: Slot<Schedule>,
) -> Entry<S, Schedule> {
    Entry {
        id: kind.kind(), group: Group::Settlements, name: kind.name().into(), recognition: Recognition { distinct: Must::Value("A community is a settlement while inhabited and a ruin when abandoned; both retain its identity across eras and captured maps.".into()), is_a: Must::Value(Rc::new(move |state, cell| places::holds_record(state, kind.kind(), cell, || kind.found(state)))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("People's retained communities and captured seats supply living towns and the remains of departed communities.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(move |state: &S, cell| Ok(state.field()?.water().column.kind.get(cell)? == 0 && (kind == Community::Ruin || (state.field()?.shared.scalar(Scalar::Slope).get(cell)? <= 0.12 && reads::celsius(state.field()?, cell)? >= -5.0))))), suitability: Slot::Value(Rc::new(move |state, cell| kind.suitable(state, cell))), places: Must::Value(Rc::new(move |state| kind.found(state))) },
        publication: Publication { statement: Must::Value("Publish community facts through the identity-preserving community writer, retaining captured seats and finer drawings.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(record)) }, across_maps: across(schedule), event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten, fields: fields(kind), movement: movement(kind), others: others(kind), people: people(kind),
            time: ThroughTime { statement: Must::Value("Abandoned settlements become ruins; a ruin lasts until its ground is lost.".into()), fate: Slot::Value(Rc::new(move |state: &S, place| {
                Ok(if kind == Community::Ruin { if state.field()?.water().column.kind.get(place.anchor)? == 0 { Fate::Persists } else { Fate::Ends { leaves: None } } } else if place.feature.as_ref().and_then(|f| f.attributes.get("status")).and_then(|v| v.as_str()) == Some("abandoned") { Fate::Becomes(Kind::Ruin) } else { Fate::Persists })
            })), }, visibility: visible(kind), naming: naming(kind),
        },
    }
}
pub fn settlement<S: SettlementState + 'static, Schedule>(
    record: CommunityPublication<S>,
    schedule: Schedule,
) -> Entry<S, Schedule> {
    entry(Community::Settlement, record, Slot::Value(schedule))
}
pub fn ruin<S: SettlementState + 'static, Schedule>(
    record: CommunityPublication<S>,
) -> Entry<S, Schedule> {
    entry(Community::Ruin, record, Slot::NotApplicable("The settlement schedule reads, grades and settles all captured seats, including ruins."))
}
