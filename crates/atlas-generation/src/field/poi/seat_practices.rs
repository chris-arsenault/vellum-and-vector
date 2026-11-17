use super::{
    carry_rules,
    community_records::CommunityState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads, settlement_reads as settled,
    state::State,
    values::*,
    visibility,
    work_records::{self, SitedWork},
};
use crate::{
    field::{shared::Scalar, significance::measure},
    magic::channels::Channel,
    scale::RelativeMeasure,
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Practice {
    Forge,
    Archive,
}
impl Practice {
    pub const ALL: [Self; 2] = [Self::Forge, Self::Archive];
    fn kind(self) -> Kind {
        if self == Self::Forge {
            Kind::Forge
        } else {
            Kind::Archive
        }
    }
    fn name(self) -> &'static str {
        if self == Self::Forge {
            "Forge"
        } else {
            "Archive"
        }
    }
    fn intensity(self, state: &impl State, cell: usize) -> io::Result<f64> {
        Ok((reads::magic_value(
            state,
            if self == Self::Forge {
                "fire"
            } else {
                "aurora"
            },
            Channel::Intensity,
            cell,
        )? / 1000.0)
            .min(1.0))
    }
    fn requires(self, state: &impl CommunityState, cell: usize) -> io::Result<bool> {
        Ok(state.field()?.water.borrow().kind_at(cell)? == 0
            && (self == Self::Forge || held(state, cell)?)
            && settled::near_town(
                state,
                cell,
                measure(&state.field()?.scale, 0.00125, 1, 1.0)?,
                0.0,
            )?)
    }
    fn suitable(self, state: &impl State, cell: usize) -> io::Result<f64> {
        if self == Self::Archive {
            return Ok((self.intensity(state, cell)? * retention(state, cell)?).sqrt());
        }
        let mut cores = carries_cores(state, cell)?;
        for edge in 0..3 {
            if let Some(next) = state.field()?.mesh.neighbor(cell, edge) {
                cores |= carries_cores(state, next)?;
            }
        }
        Ok((self.intensity(state, cell)? + f64::from(cores)) / 2.0)
    }
    fn found<S: CommunityState + 'static>(self, state: &S) -> io::Result<Vec<Place>> {
        let shape = SitedWork {
            record: if self == Self::Forge {
                "fire-forge"
            } else {
                "aurora-archive"
            },
            layer: "magicPractices",
            label: self.name(),
            radius: RelativeMeasure::length(if self == Self::Forge { 0.0005 } else { 0.00005 })
                .map_err(io::Error::other)?,
            spacing: RelativeMeasure::length(0.025).map_err(io::Error::other)?,
            requires: Rc::new(move |state, cell| self.requires(state, cell)),
            suitability: Rc::new(move |state, cell| self.suitable(state, cell)),
        };
        Ok(
            work_records::work_places(state, self.kind(), &shape, || Ok(Vec::new()))?
                .as_ref()
                .clone(),
        )
    }
    fn fate(self, state: &impl State, place: &Place) -> io::Result<Fate> {
        if self == Self::Archive {
            return Ok(if held(state, place.anchor)? {
                Fate::Persists
            } else {
                Fate::Ends { leaves: None }
            });
        }
        Ok(if settled::kept(place) {
            Fate::Persists
        } else {
            Fate::Ends {
                leaves: Some(if reads::magic_rule(state, "fire", "halo", place.anchor)? {
                    Kind::ThawedHalo
                } else {
                    Kind::Ruin
                }),
            }
        })
    }
}
fn carries_cores(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(reads::magic_rule(state, "fire", "vein", cell)?
        || reads::magic_rule(state, "fire", "core", cell)?
        || reads::magic_rule(state, "fire", "placer", cell)?)
}
fn ice(state: &impl State, cell: usize) -> io::Result<f64> {
    state.field()?.shared.scalar(Scalar::IceThickness).get(cell)
}
fn held(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(ice(state, cell)? > 0.0 && Practice::Archive.intensity(state, cell)? > 0.0)
}
fn retention(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(
        (ice(state, cell)? / measure(&state.field()?.scale, 0.0000025, 1, 1.0)?).min(1.0)
            * (-reads::celsius(state.field()?, cell)? / 10.0).clamp(0.0, 1.0),
    )
}
fn seat(state: &impl State) -> io::Result<f64> {
    settled::touching(state, measure(&state.field()?.scale, 0.00125, 1, 1.0)?)
}
fn seat_relation<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|state, a, b| places::within(state, a, b, seat(state)?)),
    }
}
fn magnitude(state: &impl CommunityState, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        settled::seat_people(state, place)?,
        5000.0,
    ))
}
fn local(kind: Practice, state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::stands_out(state, place, state.field()?.scale.cells(6.0), |cell| {
        kind.intensity(state, cell)
    })
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(6.0))
}
fn visible<S: CommunityState + 'static>(kind: Practice) -> Visibility<S> {
    Visibility {
        statement: Must::Value("The served community, surrounding system intensity, isolation and cultural attachment determine visibility.".into()),
        magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(move |state, place| local(kind, state, place))),
        isolation: Slot::Value(Rc::new(move |state: &S, place| visibility::alone_among(state, place, &kind.found(state)?, state.field()?.scale.cells(12.0)))), cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(move |state: &S, place| {
            if state.physical().is_none() || place.anchor == usize::MAX { return Ok(0.0); }
            let (m,l) = if kind == Practice::Forge { (0.3,0.4) } else { (0.5,0.2) };
            Ok((m * magnitude(state, place)? + l * local(kind, state, place)? + 0.3 * visibility::alone_among(state, place, &kind.found(state)?, state.field()?.scale.cells(12.0))?).max(cultural(state, place)?))
        })),
    }
}
fn warmed(
    state: &impl State,
    place: &Place,
    band: Scalar,
    factor: f64,
) -> io::Result<Vec<FieldChange>> {
    Ok(settled::work_reach(state, place)?
        .into_iter()
        .map(|sample| {
            FieldChange::Physical(PhysicalChange {
                cell: sample.cell,
                band: PhysicalBand::Scalar(band),
                change: Change::Add(8.0 * settled::strength(place) * sample.share * factor),
            })
        })
        .collect())
}
fn fields<S: State + 'static>(kind: Practice) -> Fields<S> {
    Fields {
        statement: Must::Value("Forges warm their seat and thaw ice with contact heat; archives read cold retained memory without changing the fields.".into()),
        terrain: Slot::NotApplicable("The practice occupies chambers and hearths below field resolution."),
        water: if kind == Practice::Forge { Slot::Value(Rc::new(|state, place| warmed(state, place, Scalar::IceThickness, -0.02 * 100.0))) } else { Slot::NotApplicable("Reading retains the ice it needs.") },
        climate: if kind == Practice::Forge { Slot::Value(Rc::new(|state, place| warmed(state, place, Scalar::Temperature, 10.0))) } else { Slot::NotApplicable("The archive requires cold without adding any.") },
        cover: Slot::NotApplicable("Ecology reads the warmth; core heat consumes no timber and archives stand on ice."),
        magic: Slot::NotApplicable("Core cracking and crystal reading use their owned reservoirs and community ledgers, not repeated field-band changes."),
    }
}
fn across<S: State + 'static, Schedule>(kind: Practice) -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value("Captured practices stay at their seat; an archive requires ice and Aurora on that finer ground.".into()),
        stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::NotApplicable("The practice asks for no ground shape."),
        counterpart: Slot::Value(Rc::new(move |state, carried| Ok((kind == Practice::Forge || held(state, carried.cell)?).then_some(carried.cell)))),
        unrealized: Slot::Value(Rc::new(move |_, _| Ok(if kind == Practice::Forge { Unrealized::Keep } else { Unrealized::Drop }))),
        settle: Slot::NotApplicable("Only the settlement's relocation moves a practice."), schedule: Slot::NotApplicable("The practice adds no refinement step."),
    }
}
fn movement<S: State + 'static>(kind: Practice) -> Movement<S> {
    let carrier: OnPlace<S, Vec<Cost>> = Rc::new(move |state, place| {
        carry_rules::cost_near(
            state,
            place,
            if kind == Practice::Forge { 0.7 } else { 3.0 },
            measure(&state.field()?.scale, 0.0005, 1, 1.0)?,
        )
    });
    Movement {
        statement: Must::Value("Core traffic and readers wear roads; forges draw carried cores while archive crystals dissipate carried Pressure.".into()),
        roads: Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, if kind == Practice::Forge { 0.8 } else { 0.9 }, measure(&state.field()?.scale, 0.0005, 1, 1.0)?))),
        boats: Slot::NotApplicable("The practice stands at its land seat."), drainage: Slot::NotApplicable("The practice adds no drainage cost."),
        magic: Slot::Value([(Carrier::People, carrier)].into_iter().collect()), links: Slot::NotApplicable("A practice joins no cells."), crosses: Slot::NotApplicable("A practice opens no barrier route."),
    }
}
fn others<S: State + 'static>(kind: Practice) -> Others<S> {
    let paired = if kind == Practice::Forge {
        [Kind::Mine, Kind::ThermalVein, Kind::Placer]
    } else {
        [Kind::LightWell, Kind::FrostPrism, Kind::AuroraField]
    };
    Others {
        statement: Must::Value("Each practice needs a community and pairs with its system's sources; a forge and archive cannot coexist where the seat's ice is gone.".into()),
        needs: Slot::Value(vec![seat_relation(Kind::Settlement)]), excludes: Slot::Value(vec![Relation { kind: if kind == Practice::Forge { Kind::Archive } else { Kind::Forge }, holds: Rc::new(|state, a, b| Ok(a.anchor == b.anchor && ice(state, a.anchor)? <= 0.0)) }]),
        contains: Slot::NotApplicable("A practice occupies one seat."), pairs_with: Slot::Value(paired.into_iter().map(|k| cover_shared::near(k, 6.0)).collect()),
    }
}
fn people<S: CommunityState + 'static>(kind: Practice) -> People<S> {
    People {
        statement: Must::Value("Forges supply power and worked metal at a risk to core crackers; archives draw scholars and trade while reading strains minds.".into()),
        offers: Slot::Value(Rc::new(move |state, place| {
            let size = magnitude(state, place)?;
            Ok(if kind == Practice::Forge { [(Benefit::Power, size), (Benefit::Materials, size)] } else { let memory = retention(state, place.anchor)? * settled::strength(place); [(Benefit::Sanctity, memory), (Benefit::Trade, memory * size)] }.into_iter().collect())
        })),
        threatens: Slot::Value(Rc::new(move |state, place| Ok(vec![if kind == Practice::Forge { Hazard { hazard: "core cracking".into(), reach: settled::attribute(place, "radius", 0.0).max(seat(state)?), severity: 0.3 * settled::strength(place) } } else { Hazard { hazard: "cognitive strain".into(), reach: seat(state)?, severity: 0.2 } }]))),
    }
}
fn naming<S: State + 'static>(kind: Practice) -> Naming<S> {
    let mut takes = vec![NameRelation {
        relation: seat_relation(Kind::Settlement),
        chance: None,
    }];
    if kind == Practice::Forge {
        takes.push(NameRelation {
            relation: cover_shared::near(Kind::ThermalVein, 6.0),
            chance: None,
        });
    }
    Naming {
        statement: Must::Value("The community names its practice, usually for the settlement or a forge's supplying vein.".into()),
        named_by: Slot::Value(Rc::new(settled::culture)), takes_name_from: Slot::Value(takes), lends_name_to: Slot::NotApplicable("The practice lends no name to surrounding places."), term: Slot::Unwritten,
    }
}
pub fn entry<S: CommunityState + 'static, Schedule>(kind: Practice) -> Entry<S, Schedule> {
    Entry {
        id: kind.kind(), group: Group::Settlements, name: kind.name().into(),
        recognition: Recognition { distinct: Must::Value("A community's forge cracks Fire cores for heat; its archive reads Aurora memories in cold crystals. Natural system features are separate places.".into()), is_a: Must::Value(Rc::new(move |state, cell| places::holds_record(state, kind.kind(), cell, || kind.found(state)))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Practices are sited near settlements with their system's necessary ground and material.".into()), way: Must::Value(ExistenceWay::Sited), requires: Slot::Value(Rc::new(move |state, cell| kind.requires(state, cell))), suitability: Slot::Value(Rc::new(move |state, cell| kind.suitable(state, cell))), places: Must::Value(Rc::new(move |state| kind.found(state))) },
        publication: Publication { statement: Must::Value("Publish the generated located practice while retaining existing captured records.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(work_records::work_record)) }, across_maps: across(kind), event: None,
        roles: Roles { true_size: super::true_sizes::sited(match kind { Practice::Forge => &super::true_sizes::FORGE, Practice::Archive => &super::true_sizes::ARCHIVE }), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(kind.kind()), fields: fields(kind), movement: movement(kind), others: others(kind), people: people(kind), time: ThroughTime { statement: Must::Value("A kept forge persists, otherwise leaving a thawed halo or ruin. An archive ends when its ice or Aurora fails.".into()), fate: Slot::Value(Rc::new(move |state, place| kind.fate(state, place))) }, visibility: visible(kind), naming: naming(kind) },
    }
}
