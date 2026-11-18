use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared, event_relief,
    kinds::{Group, Kind},
    places, reads, records,
    relief_events::{self as events, Shape},
    relief_landmarks as landmarks, relief_shape as shape,
    state::State,
    values::*,
    visibility,
};
use crate::{
    features::{records::Attributes, Feature},
    field::{
        events::{Event, EventKind},
        landmarks::catalogue::Kind as LandmarkKind,
        shared::Scalar,
        significance::measure,
        volcanism::CALDERA_SHARE,
    },
    magic::channels::Channel,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};

pub trait EventState: State {
    fn mantle_plume_radius(&self) -> f64;
    fn impact_visible_relief(&self) -> f64;
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EventRelief {
    Volcano,
    Caldera,
    Crater,
    EjectaFan,
}
impl EventRelief {
    pub const ALL: [Self; 4] = [Self::Volcano, Self::Caldera, Self::Crater, Self::EjectaFan];
    fn kind(self) -> Kind {
        match self {
            Self::Volcano => Kind::Volcano,
            Self::Caldera => Kind::Caldera,
            Self::Crater => Kind::Crater,
            Self::EjectaFan => Kind::EjectaFan,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Volcano => "Volcano",
            Self::Caldera => "Caldera",
            Self::Crater => "Crater",
            Self::EjectaFan => "Ejecta fan",
        }
    }
    fn landmark(self) -> Option<LandmarkKind> {
        match self {
            Self::Volcano => Some(LandmarkKind::VolcanicMountain),
            Self::Crater => Some(LandmarkKind::ImpactRing),
            _ => None,
        }
    }
    fn stands(self, state: &impl EventState, event: &Event) -> io::Result<bool> {
        Ok(match self {
            Self::Volcano => {
                event.kind == EventKind::Volcano
                    && event_relief::volcanic(state.field()?, event)? > 0.0
            }
            Self::Caldera => {
                event.kind == EventKind::Volcano
                    && event.caldera == Some(true)
                    && event_relief::volcanic(state.field()?, event)? > 0.0
            }
            Self::Crater => {
                event.kind == EventKind::Impact
                    && event_relief::crater(state.field()?, event)? >= state.impact_visible_relief()
            }
            Self::EjectaFan => false,
        })
    }
    fn event_places(self, state: &impl EventState) -> io::Result<Vec<Place>> {
        Ok(events::places(
            state,
            self.kind(),
            |event| self.stands(state, event),
            |event| {
                event.radius
                    * if self == Self::Caldera {
                        CALDERA_SHARE
                    } else {
                        1.0
                    }
            },
            if self == Self::Caldera {
                ":caldera"
            } else {
                ""
            },
        )?
        .as_ref()
        .clone())
    }
    fn found(self, state: &impl EventState) -> io::Result<Vec<Place>> {
        if self == Self::EjectaFan {
            return Ok(places::rule_places(state, self.kind(), "fire", "fan")?
                .as_ref()
                .clone());
        }
        let mut places = self.event_places(state)?;
        if self == Self::Crater {
            places.extend(
                places::rule_places(state, self.kind(), "fire", "crater")?
                    .iter()
                    .cloned(),
            );
        }
        Ok(places)
    }
    fn is_a(self, state: &impl EventState, cell: usize) -> io::Result<bool> {
        if self == Self::EjectaFan {
            return reads::magic_rule(state, "fire", "fan", cell);
        }
        Ok(
            events::on_places(state, self.kind(), cell, || self.event_places(state))?
                || (self == Self::Crater && reads::magic_rule(state, "fire", "crater", cell)?),
        )
    }
    fn read(self, state: &impl State, cell: usize) -> io::Result<f64> {
        let field = state.field()?;
        match self {
            Self::Volcano => reads::height(field, cell),
            Self::Caldera => Ok(-field.ground().view(GroundField::Elevation).get(cell)?),
            _ => Ok(MapScale::metres(
                field
                    .shared
                    .scalar(if self == Self::Crater {
                        Scalar::ImpactExcavation
                    } else {
                        Scalar::ImpactEjectaThickness
                    })
                    .get(cell)?,
                LengthUnit::Native,
            )),
        }
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let scale = &state.field()?.scale;
        let evidence = shape::evidence(state, place)?;
        Ok(match self {
            Self::Volcano => visibility::sized(evidence.relief, measure(scale, 0.00025, 1, 0.5)?),
            Self::Caldera => visibility::sized(evidence.area, measure(scale, 0.000001, 2, 1.0)?),
            Self::Crater => {
                (visibility::sized(evidence.relief, measure(scale, 0.0000375, 1, 0.5)?)
                    + visibility::sized(evidence.area, measure(scale, 0.00004375, 2, 1.0)?))
                    / 2.0
            }
            Self::EjectaFan => {
                (thickness_size(state, place)?
                    + visibility::sized(evidence.area, measure(scale, 0.000125, 2, 1.0)?))
                    / 2.0
            }
        })
    }
    fn local(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::stands_out(
            state,
            place,
            state.field()?.scale.cells(match self {
                Self::Caldera => 4.0,
                Self::Crater => 6.0,
                _ => 8.0,
            }),
            |cell| self.read(state, cell),
        )
    }
    fn isolation(self, state: &impl EventState, place: &Place) -> io::Result<f64> {
        visibility::alone_among(
            state,
            place,
            &self.found(state)?,
            state
                .field()?
                .scale
                .cells(if matches!(self, Self::Volcano | Self::Caldera) {
                    10.0
                } else {
                    12.0
                }),
        )
    }
    fn cultural(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let tie = visibility::attachment(
            state,
            place,
            state.field()?.scale.cells(match self {
                Self::Volcano => 10.0,
                Self::EjectaFan => 6.0,
                _ => 8.0,
            }),
        )?;
        Ok(if self == Self::Volcano {
            tie.max(activity(state, place)? / 2.0)
        } else {
            tie
        })
    }
}
fn activity(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(state
        .field()?
        .shared
        .scalar(Scalar::VolcanicActivity)
        .get(place.anchor)?
        / 1000.0)
}
fn fallen_source(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(reads::magic_value(state, "fire", Channel::Source, place.anchor)? / 1000.0)
}
fn thickness_size(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        EventRelief::EjectaFan.read(state, place.anchor)?,
        measure(&state.field()?.scale, 0.0000025, 1, 0.5)?,
    ))
}
fn counterpart<S: EventState + CatalogueState<Schedule>, Schedule>(
    kind: EventRelief,
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    if kind == EventRelief::EjectaFan {
        return carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
            kind.is_a(state, cell)
        });
    }
    Ok(Some(shape::nearest_or_extreme(
        state,
        carried.cell,
        state.parent_cell_span(),
        if kind == EventRelief::Volcano {
            1.0
        } else {
            -1.0
        },
        |cell| kind.is_a(state, cell),
    )?))
}
fn across<S: EventState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: EventRelief,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Captured construction develops locally. Cones and pits retain their records near the child's top or floor; quiet ejecta leaves the catalogue when its rule ends.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), counterpart: Slot::Value(Rc::new(move |state, carried| counterpart(kind, state, carried))), realize: Slot::NotApplicable("Refinement develops captured material without repeating an impact or collapse or restoring parent heights."), unrealized: Slot::Value(Rc::new(move |state, carried| {
        if kind == EventRelief::EjectaFan { Ok(counterpart(kind, state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)) } else { Ok(Unrealized::Keep) }
    })), settle: Slot::NotApplicable("A round's water does not relocate the cone, pit or blanket."), schedule: Slot::NotApplicable("Existing cones and landmark causes own their steps.") }
}
fn fields<S: State + 'static>(kind: EventRelief) -> Fields<S> {
    Fields { statement: Must::Value("Construction, collapse and impact write their own ground and feedback. Only living volcanic flows strip soil here.".into()), terrain: Slot::NotApplicable("The source event and its existing processes construct the ground."), water: Slot::NotApplicable("Drainage and lake filling read the current shape."), climate: Slot::NotApplicable("Climate reads height; no ash or impact-winter band exists."), cover: if kind == EventRelief::Volcano { Slot::Value(Rc::new(|state: &S, place| {
        let field = state.field()?; let mut changes = Vec::new();
        for &cell in &place.cells { if field.water().column.kind.get(cell)? == 0 && field.shared.scalar(Scalar::VolcanicActivity).get(cell)? > 0.0 { changes.push(FieldChange::Physical(PhysicalChange { band: PhysicalBand::Ground(GroundField::SoilDepth), cell, change: Change::AtMost(0.0) })); } }
        Ok(changes)
    })) } else { Slot::NotApplicable("Ecology and Fire's barren-fan process own cover.") }, magic: Slot::NotApplicable("The existing event processes write fractures, heat and material stock.") }
}
fn movement<S: State + 'static>(kind: EventRelief) -> Movement<S> {
    Movement { on_foot: None, statement: Must::Value("Cones repel drainage through refinement; calderas draw water inward, crater rims turn it, and loose ejecta is reworked first.".into()), roads: if kind == EventRelief::EjectaFan { Slot::Value(Rc::new(|state, place| carry_rules::cost_near(state, place, 1.2, 0.0))) } else { Slot::NotApplicable("Road grade already reads the flanks and rims.") }, boats: Slot::NotApplicable("The feature supplies no connected boat route."), drainage: if kind == EventRelief::Volcano { Slot::NotApplicable("Refinement repels the network from captured cones.") } else { Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, match kind { EventRelief::Caldera => 0.5, EventRelief::Crater => 4.0, _ => 0.9 }, 0.0))) }, magic: Slot::NotApplicable("Carriers already read fracture conductance and their owned stock."), links: Slot::NotApplicable("The landform joins no fixed pair of cells."), crosses: Slot::NotApplicable("The feature supplies no crossing.") }
}
fn same<S>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)),
    }
}
fn inside<S>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
    }
}
fn others<S: State + 'static>(kind: EventRelief) -> Others<S> {
    let (excludes, contains, pairs) = match kind {
        EventRelief::Volcano => (
            vec![same(Kind::Dome), same(Kind::Crater)],
            cover_shared::holds(&[Kind::Caldera]),
            vec![
                cover_shared::near(Kind::BasaltFlat, 8.0),
                cover_shared::near(Kind::ThermalVein, 8.0),
                cover_shared::near(Kind::Spring, 6.0),
                cover_shared::near(Kind::Vent, 6.0),
            ],
        ),
        EventRelief::Caldera => (
            vec![same(Kind::Crater)],
            cover_shared::holds(&[Kind::Lake, Kind::Vent, Kind::Spring]),
            vec![cover_shared::near(Kind::ThermalVein, 4.0)],
        ),
        EventRelief::Crater => (
            vec![same(Kind::Caldera), same(Kind::Dome)],
            cover_shared::holds(&[Kind::Lake, Kind::CompassDeviation]),
            vec![
                cover_shared::near(Kind::EjectaFan, 8.0),
                cover_shared::near(Kind::Placer, 10.0),
                cover_shared::near(Kind::KillingGround, 4.0),
            ],
        ),
        EventRelief::EjectaFan => (
            vec![inside(Kind::Crater)],
            cover_shared::holds(&[Kind::CompassDeviation]),
            vec![
                cover_shared::near(Kind::Crater, 10.0),
                cover_shared::near(Kind::Placer, 6.0),
                cover_shared::holds(&[Kind::KillingGround]).remove(0),
            ],
        ),
    };
    Others { statement: Must::Value("Construction, collapse and impact have distinct centres and relate to their lakes, deposits, springs and material features.".into()), needs: if kind == EventRelief::Caldera { Slot::Value(vec![inside(Kind::Volcano)]) } else { Slot::NotApplicable("The event or material rule establishes the feature.") }, excludes: Slot::Value(excludes), contains: Slot::Value(contains), pairs_with: Slot::Value(pairs) }
}
fn offers(kind: EventRelief, state: &impl State, place: &Place) -> io::Result<Benefits> {
    let great = kind.magnitude(state, place)?;
    Ok(match kind {
        EventRelief::Volcano => vec![
            (Benefit::Food, great / 2.0),
            (Benefit::Materials, great / 2.0),
            (Benefit::Sanctity, great.max(activity(state, place)?)),
        ],
        EventRelief::Caldera => vec![
            (
                Benefit::Water,
                if state.field()?.water().column.kind.get(place.anchor)? == 2 {
                    1.0
                } else {
                    0.0
                },
            ),
            (
                Benefit::Materials,
                state
                    .field()?
                    .shared
                    .scalar(Scalar::Geothermal)
                    .get(place.anchor)?
                    / 1000.0,
            ),
            (Benefit::Sanctity, great),
        ],
        EventRelief::Crater => vec![
            (Benefit::Materials, fallen_source(state, place)?),
            (Benefit::Sanctity, great / 2.0),
        ],
        EventRelief::EjectaFan => vec![(Benefit::Materials, thickness_size(state, place)?)],
    }
    .into_iter()
    .collect())
}
fn threatens(kind: EventRelief, state: &impl EventState, place: &Place) -> io::Result<Vec<Hazard>> {
    let field = state.field()?;
    let (hazard, reach, severity) = match kind {
        EventRelief::Volcano => (
            "eruption",
            state.mantle_plume_radius(),
            activity(state, place)?,
        ),
        EventRelief::Caldera => (
            "renewed collapse",
            field.scale.cells(4.0),
            activity(state, place)?,
        ),
        EventRelief::Crater => (
            "burning ground",
            field.scale.cells(2.0),
            field.shared.scalar(Scalar::ImpactHeat).get(place.anchor)? / 1000.0,
        ),
        EventRelief::EjectaFan => (
            "burning ground",
            field.scale.cells(1.0),
            fallen_source(state, place)?,
        ),
    };
    Ok(if severity > 0.0 {
        vec![Hazard {
            hazard: hazard.into(),
            reach,
            severity,
        }]
    } else {
        Vec::new()
    })
}
fn fate(kind: EventRelief, state: &impl EventState, place: &Place) -> io::Result<Fate> {
    if kind == EventRelief::Volcano {
        return Ok(shape::lasts_while(
            activity(state, place)? > 0.0 || shape::section_at(state, place.anchor)?.crest > 0.0,
            Some(Kind::BasaltFlat),
        ));
    }
    if kind.is_a(state, place.anchor)? {
        return Ok(Fate::Persists);
    }
    Ok(match kind {
        EventRelief::Caldera if state.field()?.water().column.kind.get(place.anchor)? == 2 => {
            Fate::Becomes(Kind::Lake)
        }
        EventRelief::Crater => Fate::Ends {
            leaves: Some(Kind::EjectaFan),
        },
        EventRelief::EjectaFan => Fate::Ends {
            leaves: Some(Kind::Placer),
        },
        _ => Fate::Ends { leaves: None },
    })
}
fn visible<S: EventState + 'static>(kind: EventRelief) -> Visibility<S> {
    Visibility { statement: Must::Value("Surviving relief or material, extent, contrast, isolation and nearby people determine visibility; active volcanoes also carry their own feared reputation.".into()), magnitude: Slot::Value(Rc::new(move |state, place| kind.magnitude(state, place))), local_conditions: Slot::Value(Rc::new(move |state, place| kind.local(state, place))), isolation: Slot::Value(Rc::new(move |state, place| kind.isolation(state, place))), cultural: Slot::Value(Rc::new(move |state, place| kind.cultural(state, place))), importance: Must::Value(Rc::new(move |state, place| {
        let (m,l,i) = match kind { EventRelief::Volcano => (0.5,0.35,0.15), EventRelief::EjectaFan => (0.55,0.35,0.1), _ => (0.6,0.3,0.1) };
        Ok((m * kind.magnitude(state, place)? + l * kind.local(state, place)? + i * kind.isolation(state, place)?).max(kind.cultural(state, place)?))
    })) }
}
fn naming<S: State + 'static>(kind: EventRelief) -> Naming<S> {
    let takes = match kind {
        EventRelief::Caldera => vec![inside(Kind::Volcano)],
        EventRelief::EjectaFan => vec![cover_shared::near(Kind::Crater, 8.0)],
        _ => Vec::new(),
    };
    let lends = match kind {
        EventRelief::Volcano => vec![
            cover_shared::holds(&[Kind::Caldera]).remove(0),
            cover_shared::near(Kind::Settlement, 8.0),
        ],
        EventRelief::Caldera => cover_shared::holds(&[Kind::Lake]),
        EventRelief::Crater => vec![
            cover_shared::holds(&[Kind::Lake]).remove(0),
            cover_shared::near(Kind::EjectaFan, 8.0),
        ],
        EventRelief::EjectaFan => cover_shared::holds(&[Kind::Mine]),
    };
    Naming { statement: Must::Value("People name the original event's ground; calderas and ejecta borrow its name, and lakes and settlements can follow.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: if takes.is_empty() { Slot::NotApplicable("People name this feature itself.") } else { Slot::Value(takes.into_iter().map(|relation| NameRelation { relation, chance: None }).collect()) }, lends_name_to: Slot::Value(lends), term: Slot::Unwritten }
}
fn record<S: EventState + CatalogueState<Schedule>, Schedule>(
    kind: EventRelief,
    state: &S,
    place: &Place,
) -> io::Result<Option<Feature>> {
    if kind == EventRelief::EjectaFan {
        return records::rule(state, place, "fire", "fan");
    }
    let Some(event) = events::event_of(state, place)? else {
        return if kind == EventRelief::Crater {
            records::rule(state, place, "fire", "crater")
        } else {
            Ok(None)
        };
    };
    let suffix = event.id.rsplit(':').next().unwrap_or("");
    let name = match kind {
        EventRelief::Volcano => format!("Volcano {suffix}"),
        EventRelief::Crater => format!("Impact crater {suffix}"),
        _ => "Caldera".into(),
    };
    let mut attributes = Attributes::new();
    if kind == EventRelief::Crater {
        attributes.insert(
            "relief".into(),
            event_relief::crater(state.field()?, event)?.into(),
        );
    }
    events::record(
        state,
        place,
        Shape {
            kind: kind.kind().as_str(),
            name,
            share: if kind == EventRelief::Caldera {
                CALDERA_SHARE
            } else {
                1.0
            },
            located: kind == EventRelief::Volcano,
            attributes,
        },
    )
}
pub fn entry<S: EventState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: EventRelief,
) -> Entry<S, Schedule> {
    Entry { id: kind.kind(), group: Group::Relief, name: kind.name().into(), recognition: Recognition { distinct: Must::Value("Recorded construction distinguishes cones, collapses and impact pits. Ejecta and crater lakes read Fire's exact rule rather than reconstructing an event.".into()), is_a: Must::Value(Rc::new(move |state, cell| kind.is_a(state, cell))), landform: Slot::Unwritten }, existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Events leave these forms; volcanic mountains and impact rings can also be landmark-sited.".into()), way: Must::Value(if kind.landmark().is_some() { ExistenceWay::Both } else { ExistenceWay::Emerges }), requires: match kind.landmark() { Some(landmark) => Slot::Value(Rc::new(move |state, cell| landmarks::admits(state, landmark, cell))), None => Slot::NotApplicable("The event or stock rule establishes its requirements.") }, suitability: match kind.landmark() { Some(landmark) => Slot::Value(Rc::new(move |state, cell| landmarks::suits(state, landmark, cell))), None => Slot::NotApplicable("The event determines the site.") }, places: Must::Value(Rc::new(move |state| kind.found(state))) }, publication: Publication { delivery: match kind { EventRelief::Volcano | EventRelief::Caldera => Delivery::Volcanism, EventRelief::Crater | EventRelief::EjectaFan => Delivery::Landforms }, statement: Must::Value("Recorded events publish their clipped disks and surviving attributes; magic rule features publish through their owning class.".into()), moment: Must::Value(if matches!(kind, EventRelief::Crater | EventRelief::EjectaFan) { Moment::Magic } else { Moment::Geography }), record: Must::Value(Rc::new(move |state: &S, place: &Place| record(kind, state, place))) }, across_maps: across(kind), event: None,
        roles: Roles { true_size: super::true_sizes::extent(), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(kind.kind()), fields: fields(kind), movement: movement(kind), others: others(kind), people: People { statement: Must::Value("The form offers its material, water and sanctity while active heat threatens its ground.".into()), offers: Slot::Value(Rc::new(move |state, place| offers(kind, state, place))), threatens: Slot::Value(Rc::new(move |state, place| threatens(kind, state, place))) }, time: ThroughTime { statement: Must::Value("Erosion, retained relief and active stock determine persistence and the forms left behind.".into()), fate: Slot::Value(Rc::new(move |state, place| fate(kind, state, place))) }, visibility: visible(kind), naming: naming(kind) },
    }
}
