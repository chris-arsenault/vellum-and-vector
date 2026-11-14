//! Pressure's places retain distinct rules and effects; ray generation stays with its owner.
use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads, records, sea_shared as sea, sites,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{
        refinement::topology::distance,
        shared::{CellCode, Scalar},
        significance::measure,
    },
    magic::sources::ocean::deep_site_score,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SeaPlace {
    UpwellingFront,
    CrushZone,
    AncientWake,
    RogueWaveImpact,
    PressureLocus,
}
impl SeaPlace {
    pub const ALL: [Self; 5] = [
        Self::UpwellingFront,
        Self::CrushZone,
        Self::AncientWake,
        Self::RogueWaveImpact,
        Self::PressureLocus,
    ];
    fn identity(self) -> (Kind, &'static str, &'static str) {
        match self {
            Self::UpwellingFront => (Kind::UpwellingFront, "front", "Upwelling front"),
            Self::CrushZone => (Kind::CrushZone, "crush", "Crush zone"),
            Self::AncientWake => (Kind::AncientWake, "wake", "Ancient wake"),
            Self::RogueWaveImpact => (Kind::RogueWaveImpact, "rogue", "Rogue wave impact"),
            Self::PressureLocus => (Kind::PressureLocus, "locus", "Pressure locus"),
        }
    }
    fn is_a(self, state: &impl State, cell: usize) -> io::Result<bool> {
        reads::magic_rule(state, "pressure", self.identity().1, cell)
    }
    fn found(self, state: &impl State) -> io::Result<Vec<Place>> {
        Ok(
            places::rule_places(state, self.identity().0, "pressure", self.identity().1)?
                .as_ref()
                .clone(),
        )
    }
    fn around(self, state: &impl State) -> io::Result<f64> {
        match self {
            Self::RogueWaveImpact => shore_distance(state),
            Self::PressureLocus => Ok(rays(state)? / 2.0),
            _ => sea::near(state, 0.025),
        }
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let scale = &state.field()?.scale;
        Ok(match self {
            Self::UpwellingFront => {
                (visibility::sized(sea::area(state, place)?, measure(scale, 0.000125, 2, 1.0)?)
                    + upwelling(state, place.anchor)?)
                    / 2.0
            }
            Self::CrushZone => {
                visibility::sized(sea::area(state, place)?, measure(scale, 0.000625, 2, 1.0)?)
            }
            Self::AncientWake => {
                visibility::sized(sea::extent(state, place)?, measure(scale, 0.0875, 1, 1.0)?)
            }
            Self::RogueWaveImpact => {
                visibility::sized(cut(state, place)?, measure(scale, 0.0001, 1, 0.5)?)
            }
            Self::PressureLocus => visibility::sized(
                sea::depth(state, place.anchor)?,
                measure(scale, 0.001, 1, 0.5)?,
            ),
        })
    }
    fn local(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::stands_out(state, place, self.around(state)?, |cell| match self {
            Self::UpwellingFront => upwelling(state, cell),
            Self::AncientWake => scalar(state, Scalar::SeaSurfaceAnomaly, cell),
            _ => sea::pressure(state, cell),
        })
    }
    fn isolation(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::alone_among(state, place, &self.found(state)?, self.around(state)?)
    }
    fn cultural(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let reach = match self {
            Self::UpwellingFront => 2.0 * self.around(state)?,
            Self::CrushZone => 3.0 * self.around(state)?,
            Self::AncientWake => wake_reach(state)?,
            Self::RogueWaveImpact => shore_distance(state)?,
            Self::PressureLocus => rays(state)?,
        };
        visibility::attachment(state, place, reach)
    }
    fn weights(self) -> [f64; 3] {
        match self {
            Self::UpwellingFront => [0.5, 0.3, 0.2],
            Self::CrushZone => [0.5, 0.35, 0.15],
            Self::AncientWake => [0.6, 0.1, 0.3],
            Self::RogueWaveImpact => [0.4, 0.3, 0.3],
            Self::PressureLocus => [0.2, 0.3, 0.5],
        }
    }
}
fn scalar(state: &impl State, name: Scalar, cell: usize) -> io::Result<f64> {
    state.field()?.shared.scalar(name).get(cell)
}
fn upwelling(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(scalar(state, Scalar::Upwelling, cell)? / 1000.0)
}
fn is_sea(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(state.field()?.water().column.kind.get(cell)? == 1)
}
fn deep(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(state
        .field()?
        .shared
        .code(CellCode::BathymetricZoneCodes)
        .get(cell)?
        == 4)
}
fn rays(state: &impl State) -> io::Result<f64> {
    sea::pressure_length(state, sea::PressureLength::RayDistance, 0.5)
}
fn shore_distance(state: &impl State) -> io::Result<f64> {
    sea::pressure_length(state, sea::PressureLength::CoastalSourceDistance, 0.025)
}
fn spokes(state: &impl State) -> io::Result<f64> {
    sea::pressure_length(state, sea::PressureLength::CoastalRayDistance, 0.075)
}
fn wake_reach(state: &impl State) -> io::Result<f64> {
    sea::pressure_length(state, sea::PressureLength::WakeDistance, 0.0875)
}
fn struck(state: &impl State, anchor: usize) -> io::Result<Rc<Vec<usize>>> {
    state.held().get(&format!("rogue:struck:{anchor}"), || {
        let field = state.field()?;
        let mut land = Vec::new();
        for cell in sites::within(&field.mesh, anchor, shore_distance(state)?) {
            if field.water().column.kind.get(cell)? == 0 {
                land.push(cell);
            }
        }
        sea::sea_facing(state, &land)
    })
}
fn cut(state: &impl State, place: &Place) -> io::Result<f64> {
    let mut most = 0.0f64;
    for &cell in struck(state, place.anchor)?.iter() {
        most = most.max(scalar(state, Scalar::ExternalCoastalForcingHistory, cell)?);
    }
    Ok(most)
}
fn deep_and_steep(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let score = MapScale::metres(
        deep_site_score(&field.mesh, &field.scale, &field.water(), cell)?,
        LengthUnit::Native,
    );
    Ok(score / (score + measure(&field.scale, 0.001, 1, 0.5)?))
}
fn requires<S: State + 'static>(kind: SeaPlace) -> Slot<OnCell<S, bool>> {
    match kind {
        SeaPlace::UpwellingFront | SeaPlace::CrushZone => {
            Slot::NotApplicable("The rule reads its intensity and water directly.")
        }
        SeaPlace::AncientWake => Slot::Value(Rc::new(is_sea)),
        SeaPlace::PressureLocus => Slot::Value(Rc::new(|state, cell| {
            Ok(is_sea(state, cell)? && deep(state, cell)?)
        })),
        SeaPlace::RogueWaveImpact => Slot::Value(Rc::new(|state, cell| {
            Ok(is_sea(state, cell)?
                && sites::nearest_where(
                    &state.field()?.mesh,
                    state.spatial(),
                    cell,
                    shore_distance(state)?,
                    |other| Ok(!is_sea(state, other)?),
                )?
                .is_some())
        })),
    }
}
fn fields<S: State + 'static>(kind: SeaPlace) -> Fields<S> {
    let mut fields: Fields<S> = cover_shared::fields("Pressure owns rays, intensity, water-mass feedback and coastal forcing; places add only their declared local effects.");
    if kind == SeaPlace::CrushZone {
        fields.terrain = Slot::Value(Rc::new(|state, place| {
            let bed = measure(&state.field()?.scale, 0.00005, 1, 0.5)?;
            let mut changes = Vec::new();
            for &cell in &place.cells {
                if is_sea(state, cell)? {
                    changes.push(FieldChange::Physical(PhysicalChange {
                        cell,
                        band: PhysicalBand::Ground(GroundField::SedimentThickness),
                        change: Change::AtMost(MapScale::native(
                            bed * (1.0 - sea::pressure(state, cell)?),
                        )),
                    }));
                }
            }
            Ok(changes)
        }));
    } else if kind == SeaPlace::AncientWake {
        fields.water = Slot::Value(Rc::new(|_, place| {
            Ok(place
                .cells
                .iter()
                .map(|&cell| {
                    FieldChange::Physical(PhysicalChange {
                        cell,
                        band: PhysicalBand::Scalar(Scalar::WaveExposure),
                        change: Change::AtMost(500.0),
                    })
                })
                .collect())
        }));
    } else if kind == SeaPlace::RogueWaveImpact {
        fields.cover = Slot::Value(Rc::new(|state, place| {
            Ok(struck(state, place.anchor)?
                .iter()
                .map(|&cell| {
                    FieldChange::Physical(PhysicalChange {
                        cell,
                        band: PhysicalBand::Scalar(Scalar::TreeCover),
                        change: Change::AtMost(0.5),
                    })
                })
                .collect())
        }));
    }
    fields
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    kind: SeaPlace,
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 2.0, |cell| {
        kind.is_a(state, cell)
    })
}
fn across<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: SeaPlace,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps {
        statement: Must::Value("Captured channels and intensity stand without retracing rays. Fronts, crush zones and wakes follow a nearby rule cell or go; historical impacts and loci retain their captured identity.".into()),
        stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)),
        realize: Slot::NotApplicable("Captured fields supply the place; current Pressure owns new forcing."),
        counterpart: Slot::Value(Rc::new(move |state, carried| counterpart(kind, state, carried))),
        unrealized: Slot::Value(Rc::new(move |state, carried| {
            if matches!(kind, SeaPlace::PressureLocus | SeaPlace::RogueWaveImpact) { Ok(Unrealized::Keep) }
            else { Ok(counterpart(kind, state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)) }
        })),
        settle: if kind == SeaPlace::PressureLocus { Slot::Value(Rc::new(move |state, carried| {
            if is_sea(state, carried.cell)? { Ok(Unrealized::Keep) } else { Ok(carry_rules::moves_to(counterpart(kind, state, carried)?)) }
        })) } else { Slot::NotApplicable("A round's water does not move captured sea tracks or add historical force.") },
        schedule: Slot::NotApplicable("Refinement does not fire captured origins."),
    }
}
fn boat_costs(kind: SeaPlace, state: &impl State, place: &Place) -> io::Result<Vec<Cost>> {
    if kind == SeaPlace::AncientWake {
        return carry_rules::cost_near(state, place, 0.85, 0.0);
    }
    if matches!(kind, SeaPlace::UpwellingFront | SeaPlace::CrushZone) {
        return place
            .cells
            .iter()
            .map(|&cell| {
                Ok(Cost {
                    cell,
                    factor: 1.0
                        + if kind == SeaPlace::UpwellingFront {
                            0.5 * upwelling(state, cell)?
                        } else {
                            6.0 * sea::pressure(state, cell)?
                        },
                })
            })
            .collect();
    }
    let (fraction, drag) = if kind == SeaPlace::RogueWaveImpact {
        (0.0125, 2.0)
    } else {
        (0.0075, 3.0)
    };
    let reach = sea::near(state, fraction)?;
    let mesh = &state.field()?.mesh;
    let mut costs = Vec::new();
    for cell in sites::within(mesh, place.anchor, reach) {
        if is_sea(state, cell)? {
            costs.push(Cost {
                cell,
                factor: 1.0 + drag * (1.0 - distance(mesh, place.anchor, cell) / reach).max(0.0),
            });
        }
    }
    Ok(costs)
}
fn movement<S: State + 'static>(kind: SeaPlace) -> Movement<S> {
    let mut movement = cover_shared::movement(
        "Sea places change boat passage; rays themselves read geometry rather than carrier costs.",
    );
    movement.roads = if kind == SeaPlace::RogueWaveImpact {
        Slot::Value(Rc::new(|state, place| {
            Ok(struck(state, place.anchor)?
                .iter()
                .map(|&cell| Cost { cell, factor: 1.2 })
                .collect())
        }))
    } else {
        Slot::NotApplicable("The place lies at sea, beyond roads.")
    };
    movement.boats = Slot::Value(Rc::new(move |state, place| boat_costs(kind, state, place)));
    movement.drainage = Slot::NotApplicable(
        "The sea lies beyond the drainage network; coast changes enter through ground.",
    );
    movement.magic = if matches!(kind, SeaPlace::UpwellingFront | SeaPlace::AncientWake) {
        let cost: OnPlace<S, Vec<Cost>> = Rc::new(move |state, place| {
            carry_rules::cost_near(
                state,
                place,
                if kind == SeaPlace::UpwellingFront {
                    1.3
                } else {
                    1.5
                },
                0.0,
            )
        });
        Slot::Value([(Carrier::Current, cost)].into_iter().collect())
    } else {
        Slot::NotApplicable(
            "Rays read geometry and other systems meet Pressure through confluences.",
        )
    };
    movement
}
fn nearby<S: State + 'static>(
    kind: Kind,
    reach: impl Fn(&S) -> io::Result<f64> + 'static,
) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |state, a, b| places::within(state, a, b, reach(state)?)),
    }
}
fn overlaps<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
    }
}
fn others<S: State + 'static>(kind: SeaPlace) -> Others<S> {
    let mut others: Others<S> = Others { statement: Must::Value("Pressure's origins, shoaling fronts and intensified regions relate through their actual ray reach and shore communities.".into()), needs: Slot::NotApplicable("The rule or siting requirement supplies its needs."), excludes: Slot::NotApplicable("Other places do not prevent this sea event."), contains: Slot::NotApplicable("This sea track or point holds no standing place."), pairs_with: Slot::Unwritten };
    others.pairs_with = Slot::Value(match kind {
        SeaPlace::UpwellingFront => {
            others.excludes = Slot::Value(vec![overlaps(Kind::AncientWake)]);
            others.contains = Slot::Value(cover_shared::holds(&[Kind::RogueWaveImpact]));
            vec![
                nearby(Kind::Harbour, |s| sea::near(s, 0.025)),
                nearby(Kind::Settlement, |s| sea::near(s, 0.025)),
                nearby(Kind::CrushZone, |s| sea::near(s, 0.025)),
                nearby(Kind::PressureLocus, |s| {
                    sea::pressure_length(s, sea::PressureLength::RayDistance, 0.0)
                }),
            ]
        }
        SeaPlace::CrushZone => {
            others.excludes = Slot::Value(cover_shared::holds(&[Kind::Harbour]));
            others.contains = Slot::Value(cover_shared::holds(&[
                Kind::PressureLocus,
                Kind::RogueWaveImpact,
            ]));
            vec![
                nearby(Kind::UpwellingFront, |s| sea::near(s, 0.025)),
                nearby(Kind::PressureLocus, |s| {
                    sea::pressure_length(s, sea::PressureLength::RayDistance, 0.0)
                }),
                nearby(Kind::RogueWaveImpact, |s| {
                    sea::pressure_length(s, sea::PressureLength::CoastalRayDistance, 0.0)
                }),
            ]
        }
        SeaPlace::AncientWake => {
            others.excludes = Slot::Value(vec![overlaps(Kind::UpwellingFront)]);
            vec![nearby(Kind::Harbour, |s| sea::near(s, 0.025))]
        }
        SeaPlace::RogueWaveImpact => vec![
            nearby(Kind::Headland, shore_distance),
            nearby(Kind::CrushZone, spokes),
            nearby(Kind::Harbour, shore_distance),
            nearby(Kind::DisasterSite, shore_distance),
        ],
        SeaPlace::PressureLocus => {
            others.excludes = Slot::Value(vec![Relation {
                kind: Kind::PressureLocus,
                holds: Rc::new(|state, a, b| {
                    Ok(!std::ptr::eq(a, b)
                        && distance(&state.field()?.mesh, a.anchor, b.anchor) < rays(state)? / 2.0)
                }),
            }]);
            vec![
                nearby(Kind::CrushZone, rays),
                nearby(Kind::UpwellingFront, rays),
            ]
        }
    });
    others
}
fn offers(kind: SeaPlace, state: &impl State, place: &Place) -> io::Result<Benefits> {
    Ok(match kind {
        SeaPlace::UpwellingFront => [
            (
                Benefit::Food,
                upwelling(state, place.anchor)?.max(sea::fauna(state, place.anchor)?),
            ),
            (Benefit::Water, 0.3 * upwelling(state, place.anchor)?),
        ]
        .into_iter()
        .collect(),
        SeaPlace::CrushZone => [(Benefit::Power, sea::pressure(state, place.anchor)?)]
            .into_iter()
            .collect(),
        SeaPlace::AncientWake => [
            (
                Benefit::Trade,
                1.0 - 0.85 + kind.magnitude(state, place)? / 2.0,
            ),
            (Benefit::Sanctity, kind.magnitude(state, place)? / 2.0),
        ]
        .into_iter()
        .collect(),
        SeaPlace::PressureLocus => [
            (Benefit::Power, sea::pressure(state, place.anchor)?),
            (Benefit::Sanctity, kind.magnitude(state, place)?),
        ]
        .into_iter()
        .collect(),
        SeaPlace::RogueWaveImpact => Benefits::new(),
    })
}
fn threatens(kind: SeaPlace, state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let around = kind.around(state)?;
    let mut hazards = Vec::new();
    match kind {
        SeaPlace::UpwellingFront => {
            hazards.push(Hazard {
                hazard: "fog on the shoals".into(),
                reach: around,
                severity: upwelling(state, place.anchor)? / 2.0,
            });
            let storm = sea::storm(state, place.anchor)?;
            if storm > 0.0 {
                hazards.push(Hazard {
                    hazard: "storm".into(),
                    reach: 2.0 * around,
                    severity: storm,
                });
            }
        }
        SeaPlace::CrushZone => hazards.push(Hazard {
            hazard: "crushing sea".into(),
            reach: around.max(sea::extent(state, place)?),
            severity: sea::pressure(state, place.anchor)?,
        }),
        SeaPlace::AncientWake => {
            let storm = sea::storm(state, place.anchor)?;
            if storm > 0.0 {
                hazards.push(Hazard {
                    hazard: "wake storm".into(),
                    reach: around,
                    severity: storm,
                });
            }
        }
        SeaPlace::RogueWaveImpact => hazards.push(Hazard {
            hazard: "rogue wave".into(),
            reach: shore_distance(state)?,
            severity: sea::pressure(state, place.anchor)?.max(sea::exposure(state, place.anchor)?),
        }),
        SeaPlace::PressureLocus => hazards.push(Hazard {
            hazard: "broken water".into(),
            reach: sea::near(state, 0.0075)?,
            severity: sea::pressure(state, place.anchor)?,
        }),
    }
    Ok(hazards)
}
fn fate(kind: SeaPlace, state: &impl State, place: &Place) -> io::Result<Fate> {
    if kind == SeaPlace::RogueWaveImpact {
        return Ok(Fate::Ends {
            leaves: places::settlement_within(state, place.anchor, shore_distance(state)?)?
                .then_some(Kind::DisasterSite),
        });
    }
    let persists = match kind {
        SeaPlace::AncientWake => sea::pressure(state, place.anchor)? > 0.0,
        SeaPlace::PressureLocus => deep(state, place.anchor)?,
        _ => kind.is_a(state, place.anchor)?,
    };
    Ok(if persists {
        Fate::Persists
    } else {
        Fate::Ends { leaves: None }
    })
}
fn visible<S: State + 'static>(kind: SeaPlace) -> Visibility<S> {
    Visibility { statement: Must::Value("Extent, lift, coastal damage or depth combines with local contrast and isolation; people can carry a lesser place onto the map.".into()), magnitude: Slot::Value(Rc::new(move |s, p| kind.magnitude(s, p))), local_conditions: Slot::Value(Rc::new(move |s, p| kind.local(s, p))), isolation: Slot::Value(Rc::new(move |s, p| kind.isolation(s, p))), cultural: Slot::Value(Rc::new(move |s, p| kind.cultural(s, p))), importance: Must::Value(Rc::new(move |s, p| {
        let [m, l, i] = kind.weights();
        Ok(((m * kind.magnitude(s, p)? + l * kind.local(s, p)? + i * kind.isolation(s, p)?) / (m + l + i)).max(kind.cultural(s, p)?))
    })) }
}
fn naming<S: State + 'static>(kind: SeaPlace) -> Naming<S> {
    Naming { statement: Must::Value("Fishing people and survivors name fronts and impacts; remote zones, wakes and loci are named only where shore people can reach them.".into()), named_by: Slot::Value(Rc::new(move |s, p| match kind {
        SeaPlace::UpwellingFront | SeaPlace::RogueWaveImpact => places::naming_culture_near(s, p),
        SeaPlace::CrushZone => sea::named_from_shore(s, p, 2.0 * kind.around(s)?),
        SeaPlace::AncientWake => sea::named_from_shore(s, p, wake_reach(s)?),
        SeaPlace::PressureLocus => sea::named_from_shore(s, p, rays(s)? / 2.0),
    })), takes_name_from: if kind == SeaPlace::RogueWaveImpact { Slot::Value(vec![NameRelation { relation: nearby(Kind::Settlement, shore_distance), chance: None }]) } else { Slot::NotApplicable("Its own character supplies its name.") }, lends_name_to: match kind {
        SeaPlace::UpwellingFront => Slot::Value(vec![nearby(Kind::Harbour, |s| sea::near(s, 0.025))]),
        SeaPlace::RogueWaveImpact => Slot::Value(vec![nearby(Kind::DisasterSite, shore_distance)]),
        SeaPlace::PressureLocus => Slot::Value(vec![nearby(Kind::CrushZone, rays)]),
        _ => Slot::NotApplicable("Nothing built takes a name from this dangerous zone or empty-ocean track."),
    }, term: Slot::Unwritten }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: SeaPlace,
) -> Entry<S, Schedule> {
    let (id, rule, name) = kind.identity();
    Entry { id, group: Group::Sea, name: name.into(),
        recognition: Recognition { distinct: Must::Value(format!("Pressure's {rule} rule identifies this place through its own channel or intensity and moved-water conditions.")), is_a: Must::Value(Rc::new(move |s, c| kind.is_a(s, c))), landform: Slot::Unwritten },
        existence: Existence { statement: Must::Value("Pressure's sources and rays establish this place using the system's current siting and propagation.".into()), way: Must::Value(if matches!(kind, SeaPlace::CrushZone | SeaPlace::UpwellingFront) { ExistenceWay::Emerges } else { ExistenceWay::Sited }), origins: Slot::Unwritten, requires: requires(kind), suitability: if kind == SeaPlace::PressureLocus { Slot::Value(Rc::new(deep_and_steep)) } else { Slot::NotApplicable("The system's seeded origins or ray field choose this place.") }, places: Must::Value(Rc::new(move |s| kind.found(s))) },
        publication: Publication { statement: Must::Value("Publish the owning rule's coverage, track or origin site.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(move |s: &S, p: &Place| records::rule(s, p, "pressure", rule))) },
        across_maps: across(kind), event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten, fields: fields(kind), movement: movement(kind), others: others(kind),
            people: People { statement: Must::Value("Each sea place supplies its own fishery, charge, calm passage or danger.".into()), offers: if kind == SeaPlace::RogueWaveImpact { Slot::NotApplicable("An impact supplies nothing people can plan on.") } else { Slot::Value(Rc::new(move |s, p| offers(kind, s, p))) }, threatens: Slot::Value(Rc::new(move |s, p| threatens(kind, s, p))) },
            time: ThroughTime { statement: Must::Value("Rules and deep water sustain standing sea places; an impact ends and can leave a disaster site.".into()), fate: Slot::Value(Rc::new(move |s, p| fate(kind, s, p))) }, visibility: visible(kind), naming: naming(kind),
        },
    }
}
