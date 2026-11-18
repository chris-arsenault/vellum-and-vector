//! Historical places retain their records; an event's physical command runs once.
use super::{
    carry_rules, community_records,
    contract::*,
    disaster,
    kinds::{Group, Kind},
    places, reads,
    settlement_reads::{self as settled, SettlementState},
    sites,
    state::State,
    values::*,
    visibility, work_events,
    work_records::WorkState,
};
use crate::{
    field::{refinement::topology::distance, shared::Scalar, significance::measure},
    human::HumanField,
};
use std::{io, rc::Rc};

pub trait HistoricalState: SettlementState + WorkState {
    fn confluence_strain(&self, cell: usize) -> io::Result<f64>;
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Historical {
    Battlefield,
    Disaster,
}
impl Historical {
    pub const ALL: [Self; 2] = [Self::Battlefield, Self::Disaster];
    fn kind(self) -> Kind {
        match self {
            Self::Battlefield => Kind::Battlefield,
            Self::Disaster => Kind::DisasterSite,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Battlefield => "Battlefield",
            Self::Disaster => "Disaster site",
        }
    }
    fn found(self, state: &impl WorkState) -> io::Result<Vec<Place>> {
        if self == Self::Disaster {
            return Ok(work_events::places(state, self.kind(), |kind| {
                !["siege", "battle", "collapse"].contains(&kind)
            })?
            .as_ref()
            .clone());
        }
        Ok(state
            .held()
            .get("places:battlefield:all", || {
                if !community_records::developed(state) {
                    return Ok(Vec::new());
                }
                let mut found = work_events::places(state, self.kind(), |kind| {
                    ["siege", "battle"].contains(&kind)
                })?
                .as_ref()
                .clone();
                found.extend(work_events::frontiers(
                    state,
                    self.kind(),
                    measure(&state.field()?.scale, 0.025, 1, 1.0)?,
                )?);
                Ok(found)
            })?
            .as_ref()
            .clone())
    }
    fn magnitude(self, place: &Place) -> f64 {
        let dead = settled::attribute(place, "casualties", 0.0);
        visibility::sized(
            if self == Self::Disaster {
                dead + settled::attribute(place, "displaced", 0.0)
            } else {
                dead
            },
            if self == Self::Disaster {
                3000.0
            } else {
                2000.0
            },
        )
    }
    fn requires(self, state: &impl HistoricalState, cell: usize) -> io::Result<bool> {
        if self == Self::Battlefield {
            Ok(state.field()?.water().column.kind.get(cell)? == 0
                && settled::near_town(
                    state,
                    cell,
                    measure(&state.field()?.scale, 0.0005, 1, 1.0)?,
                    100.0,
                )?)
        } else {
            Ok(exposure(state, cell)? > 0.0 || state.confluence_strain(cell)? > 0.0)
        }
    }
}
fn exposure(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let read = |band| field.shared.scalar(band).get(cell);
    let avalanche = read(Scalar::Slope)? > 0.15
        && read(Scalar::IceThickness)? > measure(&field.scale, 0.00000025, 1, 0.5)?;
    let coastal = reads::height(field, cell)? < measure(&field.scale, 0.000005, 1, 0.5)?
        && read(Scalar::OceanDistance)? < measure(&field.scale, 0.0025, 1, 1.0)?;
    Ok(if avalanche { 0.002 } else { 0.0 }
        + read(Scalar::FloodFrequency)? * 0.02
        + if coastal {
            read(Scalar::TectonicStrain)? / 1000.0 * 0.00001
        } else {
            0.0
        })
}
fn reach(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(settled::event_reach(state, place)?.max(state.field()?.scale.cells(6.0)))
}
fn at_place(state: &impl State, a: &Place, b: &Place) -> io::Result<bool> {
    Ok(distance(&state.field()?.mesh, a.anchor, b.anchor) <= reach(state, a)?)
}
fn relation<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(at_place),
    }
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, reach(state, place)?)
}
fn local(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, reach(state, place)?, |cell| {
        state
            .field()?
            .people()
            .view(HumanField::MassDeath)
            .get(cell)
    })
}
fn visible<S: HistoricalState + 'static>(kind: Historical) -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "The toll, surrounding deaths, isolation and cultural attachment determine prominence."
                .into(),
        ),
        magnitude: Slot::Value(Rc::new(move |_, place| Ok(kind.magnitude(place)))),
        local_conditions: Slot::Value(Rc::new(local)),
        isolation: Slot::Value(Rc::new(move |state, place| {
            visibility::alone_among(state, place, &kind.found(state)?, reach(state, place)?)
        })),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(move |state, place| {
            if state.physical().is_none() || place.anchor == usize::MAX {
                return Ok(0.0);
            }
            let (m, i) = if kind == Historical::Battlefield {
                (0.55, 0.3)
            } else {
                (0.6, 0.25)
            };
            Ok((m * kind.magnitude(place)
                + 0.15 * local(state, place)?
                + i * visibility::alone_among(
                    state,
                    place,
                    &kind.found(state)?,
                    reach(state, place)?,
                )?)
            .max(cultural(state, place)?))
        })),
    }
}
fn roads(state: &impl State, place: &Place) -> io::Result<Vec<Cost>> {
    let field = state.field()?;
    let reach = settled::touching(state, measure(&field.scale, 0.00075, 1, 1.0)?)?;
    let mut factors = field.coverage.borrow_mut().allocate(1.0f64);
    let mut present = crate::hpc::BitSet::new(field.mesh.len());
    let mut cells = Vec::new();
    for cost in settled::avoided_ground(state, place)? {
        factors.set(cost.cell, cost.factor)?;
        if !present.has(cost.cell) {
            present.add(cost.cell);
            cells.push(cost.cell);
        }
    }
    for cell in sites::within(&field.mesh, place.anchor, reach) {
        let wreck = 1.0
            + settled::event_magnitude(place)
                * (1.0 - distance(&field.mesh, place.anchor, cell) / reach);
        factors.set(cell, wreck.max(factors.get(cell)?))?;
        if !present.has(cell) {
            present.add(cell);
            cells.push(cell);
        }
    }
    cells
        .into_iter()
        .map(|cell| {
            Ok(Cost {
                cell,
                factor: factors.get(cell)?,
            })
        })
        .collect()
}
fn movement<S: State + 'static>(kind: Historical) -> Movement<S> {
    Movement { on_foot: None,
        statement: Must::Value("Salted ground repels roads; disasters also leave wreck, avalanche blockage and broken ice.".into()),
        roads: Slot::Value(if kind == Historical::Battlefield { Rc::new(settled::avoided_ground) } else { Rc::new(roads) }),
        boats: Slot::NotApplicable("The event record adds no boat route."),
        drainage: if kind == Historical::Disaster { Slot::Value(Rc::new(|_, place| Ok(if settled::event_kind(place) == "avalanche" { vec![Cost { cell: place.anchor, factor: 2.0 }] } else { Vec::new() }))) } else { Slot::NotApplicable("Fighting leaves drainage unchanged.") },
        magic: Slot::NotApplicable("Salt propagation owns the brine carried from the dead."),
        links: Slot::NotApplicable("An event joins no pair of cells."),
        crosses: if kind == Historical::Disaster { Slot::Value(Rc::new(|state, place| Ok(if settled::event_kind(place) == "pressure-ice-breach" && state.field()?.shared.scalar(Scalar::IceThickness).get(place.anchor)? == 0.0 { vec![Barrier::Ice] } else { Vec::new() }))) } else { Slot::NotApplicable("A siege opens no barrier.") },
    }
}
fn fields<S>(kind: Historical) -> Fields<S> {
    Fields {
        statement: Must::Value(
            "Events write material once. Battlefield camps also strip cover around their town."
                .into(),
        ),
        terrain: Slot::NotApplicable(
            "The event command leaves debris and fractures in retained ground.",
        ),
        water: Slot::NotApplicable("A completed event does not repeatedly break new ice."),
        climate: Slot::NotApplicable("A brief event adds no climate forcing."),
        cover: if kind == Historical::Battlefield {
            Slot::Value(Rc::new(|_, place| Ok(settled::damaged_ground(place, 0.6))))
        } else {
            Slot::NotApplicable("Ecology is free to recover after the event command.")
        },
        magic: Slot::NotApplicable(settled::DEAD_ARE_RECORDED),
    }
}
fn across<S: State + 'static, Schedule>() -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value("The captured event retains its location while surviving material develops independently.".into()),
        stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::NotApplicable("Captured material already carries the surviving event mark."),
        counterpart: Slot::Value(Rc::new(|_, carried| Ok(Some(carried.cell)))),
        unrealized: Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep))),
        settle: Slot::NotApplicable("History does not move with a water round."),
        schedule: Slot::NotApplicable("A recorded event adds no refinement step."),
    }
}
fn others<S: State + 'static>() -> Others<S> {
    Others {
        statement: Must::Value("An event strikes a town, may leave ruins and salted ground, and may be marked by a shrine.".into()),
        needs: Slot::Value(vec![relation(Kind::Settlement)]),
        excludes: Slot::NotApplicable("An event can fall on any exposed place."),
        contains: Slot::NotApplicable("An event has a location and reach, not contained places."),
        pairs_with: Slot::Value([Kind::Ruin, Kind::KillingGround, Kind::Shrine].into_iter().map(relation).collect()),
    }
}
fn naming<S: State + 'static>(kind: Historical) -> Naming<S> {
    Naming {
        statement: Must::Value(
            "Survivors remember the town and era; a siege lends its name to the killing ground."
                .into(),
        ),
        named_by: Slot::Value(Rc::new(places::naming_culture_near)),
        takes_name_from: Slot::Value(vec![NameRelation {
            relation: relation(Kind::Settlement),
            chance: None,
        }]),
        lends_name_to: if kind == Historical::Battlefield {
            Slot::Value(vec![Relation {
                kind: Kind::KillingGround,
                holds: Rc::new(|state, a, b| {
                    Ok(settled::event_kind(a) == "siege" && at_place(state, a, b)?)
                }),
            }])
        } else {
            Slot::NotApplicable("Nearby places retain their own names.")
        },
        term: Slot::Unwritten,
    }
}
fn people<S: HistoricalState + 'static>(kind: Historical) -> People<S> {
    People {
        statement: Must::Value("Memory supplies sanctity, floods leave silt, and survivors face repeated hazards and restless salted dead.".into()),
        offers: Slot::Value(Rc::new(move |_, place| {
            let mut offered = Benefits::new();
            offered.insert(Benefit::Sanctity, kind.magnitude(place) / 2.0);
            if kind == Historical::Disaster && settled::event_kind(place) == "flood" { offered.insert(Benefit::Food, settled::event_magnitude(place) / 2.0); }
            Ok(offered)
        })),
        threatens: Slot::Value(Rc::new(move |state, place| {
            let mut hazards = Vec::new();
            if kind == Historical::Disaster { hazards.push(Hazard { hazard: settled::event_kind(place).into(), reach: settled::event_reach(state, place)?, severity: settled::event_magnitude(place) }); }
            hazards.extend(settled::salted_hazard(state, place)?);
            hazards.extend(settled::restless_dead(state, place)?);
            Ok(hazards)
        })),
    }
}
pub fn entry<S: HistoricalState + 'static, Schedule>(kind: Historical) -> Entry<S, Schedule> {
    Entry {
        id: kind.kind(), group: Group::Settlements, name: kind.name().into(),
        recognition: Recognition { distinct: Must::Value("A recorded siege or battle is a battlefield; other events except collapse are disaster sites. Salted ground is a separate material place.".into()), is_a: Must::Value(Rc::new(move |state, cell| places::holds_record(state, kind.kind(), cell, || kind.found(state)))), landform: Slot::Unwritten },
        existence: Existence {
            origins: Slot::Unwritten, statement: Must::Value("Society records political and environmental events; regional maps retain captured events.".into()), way: Must::Value(ExistenceWay::Sited),
            requires: Slot::Value(Rc::new(move |state, cell| kind.requires(state, cell))),
            suitability: if kind == Historical::Disaster { Slot::Value(Rc::new(|state: &S, cell| Ok((1.0 - (-exposure(state, cell)? * 1000.0).exp()).max(if state.confluence_strain(cell)? > 0.0 { 0.5 } else { 0.0 })))) } else { Slot::NotApplicable("Sieges fall on lost towns and frontier fields on ways crossing held borders.") },
            places: Must::Value(Rc::new(move |state| kind.found(state))),
        },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Publish the historical record once and retain captured records.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(community_records::once_written)) },
        across_maps: across(),
        event: (kind == Historical::Disaster).then(|| EventCommand { accepts: Rc::new(disaster::accepts), changes: Rc::new(|state: &S, event| disaster::changes(event, &state.field()?.scale)) }),
        roles: Roles { true_size: super::true_sizes::sited(if kind == Historical::Battlefield { &super::true_sizes::BATTLEFIELD } else { &super::true_sizes::DISASTER }), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(kind.kind()), fields: fields(kind), movement: movement(kind), others: others(), people: people(kind), time: ThroughTime { statement: Must::Value("History persists; salted dead ground carries on as a killing ground.".into()), fate: Slot::Value(Rc::new(settled::event_fate)) }, visibility: visible(kind), naming: naming(kind) },
    }
}
