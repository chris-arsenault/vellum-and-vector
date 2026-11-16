use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads, records,
    relief_landmarks::{self as landmarks, LandmarkState},
    relief_shape as shape,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{
        landmarks::catalogue::Kind as LandmarkKind,
        shared::{CellCode, Scalar},
        significance::measure,
    },
    magic::channels::Channel,
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Raised {
    Escarpment,
    Dome,
}
struct Step {
    drop: f64,
    gradient: f64,
}
fn step_at(state: &impl State, cell: usize) -> io::Result<Step> {
    let span = state.field()?.scale.cells(1.0);
    let inner = shape::ring_heights(state, cell, span)?;
    let outer = shape::ring_heights(state, cell, 2.0 * span)?;
    let metres = |v| MapScale::metres(v, LengthUnit::Native);
    let mut best = Step {
        drop: 0.0,
        gradient: 0.0,
    };
    for direction in 0..16 {
        let opposite = (direction + 8) % 16;
        let (top, foot) = (inner[opposite], inner[direction]);
        let drop = metres(top - foot);
        let gradient = drop / (2.0 * span);
        let above = metres(outer[opposite] - top) / span;
        let below = metres(foot - outer[direction]) / span;
        if gradient >= 0.02
            && above >= 0.0
            && below >= 0.0
            && gradient >= 3.0 * above.max(below)
            && gradient > best.gradient
        {
            best = Step { drop, gradient };
        }
    }
    Ok(best)
}
fn salt_lifted(state: &impl State, cell: usize) -> io::Result<f64> {
    reads::magic_value(state, "salt", Channel::Domed, cell)
}
impl Raised {
    pub const ALL: [Self; 2] = [Self::Escarpment, Self::Dome];
    fn kind(self) -> Kind {
        if self == Self::Dome {
            Kind::Dome
        } else {
            Kind::Escarpment
        }
    }
    fn landmark(self) -> LandmarkKind {
        if self == Self::Dome {
            LandmarkKind::DomeRing
        } else {
            LandmarkKind::Escarpment
        }
    }
    fn name(self) -> &'static str {
        if self == Self::Dome {
            "Dome"
        } else {
            "Escarpment"
        }
    }
    fn recorded(self, state: &impl LandmarkState, cell: usize) -> io::Result<bool> {
        let scale = state.field()?.scale;
        Ok(landmarks::ground(state, self.landmark(), |placed| {
            let p = &placed.landmark.parameters;
            if self == Self::Dome {
                MapScale::metres(p["diameter"], LengthUnit::Kilometre) / 2.0
            } else {
                scale.supported(
                    MapScale::metres(p["scarpWidth"], LengthUnit::Kilometre),
                    1.2,
                )
            }
        })?
        .get(cell)?
            >= 0)
    }
    fn is_a(self, state: &impl LandmarkState, cell: usize) -> io::Result<bool> {
        let field = state.field()?;
        if field.water().column.kind.get(cell)? != 0 {
            return Ok(false);
        }
        if self.recorded(state, cell)? {
            return Ok(true);
        }
        if self == Self::Dome {
            return Ok(salt_lifted(state, cell)? > 0.0);
        }
        Ok(!matches!(
            field.shared.code(CellCode::LandformCodes).get(cell)?,
            16 | 17
        ) && step_at(state, cell)?.gradient > 0.0)
    }
    fn read(self, state: &impl State, cell: usize) -> io::Result<f64> {
        if self == Self::Dome {
            reads::height(state.field()?, cell)
        } else {
            Ok(step_at(state, cell)?.drop)
        }
    }
    fn found(self, state: &impl LandmarkState) -> io::Result<Vec<Place>> {
        Ok(places::region_places(
            state,
            self.kind(),
            |cell| self.is_a(state, cell),
            |cell| self.read(state, cell),
        )?
        .as_ref()
        .clone())
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let scale = &state.field()?.scale;
        let evidence = shape::evidence(state, place)?;
        let (a, b) = if self == Self::Dome {
            (
                visibility::sized(evidence.area, measure(scale, 0.0001, 2, 1.0)?),
                visibility::sized(evidence.relief, measure(scale, 0.0000375, 1, 0.5)?),
            )
        } else {
            (
                throw_size(state, place)?,
                visibility::sized(evidence.span, measure(scale, 0.025, 1, 1.0)?),
            )
        };
        Ok((a + b) / 2.0)
    }
    fn local(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::stands_out(
            state,
            place,
            state
                .field()?
                .scale
                .cells(if self == Self::Dome { 8.0 } else { 6.0 }),
            |cell| {
                if self == Self::Dome {
                    reads::height(state.field()?, cell)
                } else {
                    state.field()?.shared.scalar(Scalar::Slope).get(cell)
                }
            },
        )
    }
    fn isolation(self, state: &impl LandmarkState, place: &Place) -> io::Result<f64> {
        visibility::alone_among(
            state,
            place,
            &self.found(state)?,
            state.field()?.scale.cells(12.0),
        )
    }
}
fn cultural(state: &impl State, place: &Place) -> io::Result<f64> {
    visibility::attachment(state, place, state.field()?.scale.cells(8.0))
}
fn throw_size(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        step_at(state, place.anchor)?.drop,
        measure(&state.field()?.scale, 0.000075, 1, 0.5)?,
    ))
}
fn counterpart<S: LandmarkState + CatalogueState<Schedule>, Schedule>(
    kind: Raised,
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    if kind == Raised::Dome {
        return Ok(Some(shape::nearest_or_extreme(
            state,
            carried.cell,
            state.parent_cell_span(),
            1.0,
            |cell| kind.is_a(state, cell),
        )?));
    }
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        kind.is_a(state, cell)
    })
}
fn across<S: LandmarkState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: Raised,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Landmark causes develop their own faults and rings; emergent names follow the child's face or local top.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), counterpart: Slot::Value(Rc::new(move |state, carried| counterpart(kind, state, carried))), realize: Slot::NotApplicable("Landmark causes and ordinary development supply ground without restoring parent heights."), unrealized: Slot::Value(Rc::new(move |state, carried| if kind == Raised::Dome { Ok(Unrealized::Keep) } else { Ok(carry_rules::moves_to(counterpart(kind, state, carried)?)) })), settle: Slot::NotApplicable("The named place adds no lift or throw after water runs."), schedule: Slot::NotApplicable("Landmark records own their executable steps.") }
}
fn fields<S>() -> Fields<S> {
    Fields { statement: Must::Value("Landmarks, tectonics and Salt own the throw, rings, lift and fractures. The catalogue does not apply them twice.".into()), terrain: Slot::NotApplicable("The owner maintains its ground."), water: Slot::NotApplicable("Ordinary rivers read the ground; brine belongs to Salt."), climate: Slot::NotApplicable("Air columns already read the ground's height."), cover: Slot::NotApplicable("Ecology reads slope, soil and salting."), magic: Slot::NotApplicable("The owning processes open faults or seep brine.") }
}
fn movement<S: State + 'static>(kind: Raised) -> Movement<S> {
    let crust: OnPlace<S, Vec<Cost>> =
        Rc::new(|state, place| carry_rules::cost_near(state, place, 0.8, 0.0));
    Movement { statement: Must::Value("Dome rims turn drainage around them; water falls over escarpments and faults conduct through their open fractures.".into()), roads: Slot::NotApplicable("Road grade already reads faces and rings."), boats: Slot::NotApplicable("These landforms provide no independent boat route."), drainage: Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, if kind == Raised::Dome { 4.0 } else { 0.8 }, 0.0))), magic: if kind == Raised::Dome { Slot::Value([(Carrier::Crust, crust)].into_iter().collect()) } else { Slot::NotApplicable("Crust transport reads fault conductance.") }, links: Slot::NotApplicable("The ground joins no fixed pair of cells."), crosses: Slot::NotApplicable("These forms turn routes rather than provide crossings.") }
}
fn others<S: State + 'static>(kind: Raised) -> Others<S> {
    let excludes = if kind == Raised::Dome {
        [Kind::Volcano, Kind::Crater]
            .into_iter()
            .map(|kind| Relation {
                kind,
                holds: Rc::new(|_: &S, a: &Place, b: &Place| Ok(a.anchor == b.anchor))
                    as RelationRule<S>,
            })
            .collect()
    } else {
        vec![Relation {
            kind: Kind::Lake,
            holds: Rc::new(|_: &S, a: &Place, b: &Place| Ok(b.cells.contains(&a.anchor)))
                as RelationRule<S>,
        }]
    };
    let pairs = if kind == Raised::Dome {
        vec![
            cover_shared::near(Kind::SaltPan, 6.0),
            cover_shared::near(Kind::GlassFlat, 6.0),
        ]
    } else {
        vec![
            cover_shared::near(Kind::Plateau, 4.0),
            cover_shared::near(Kind::Waterfall, 4.0),
            cover_shared::near(Kind::Gorge, 6.0),
            cover_shared::near(Kind::Spring, 4.0),
        ]
    };
    Others { statement: Must::Value("Scarps bound plateaus and meet falls, springs and gorges; domes expose springs and mines beside their material's other forms.".into()), needs: Slot::NotApplicable("A record or the physical ground establishes the place."), excludes: Slot::Value(excludes), contains: if kind == Raised::Dome { Slot::Value(cover_shared::holds(&[Kind::Spring, Kind::Mine])) } else { Slot::NotApplicable("Falls and springs on a face are recognized through their own water.") }, pairs_with: Slot::Value(pairs) }
}
fn offers(kind: Raised, state: &impl State, place: &Place) -> io::Result<Benefits> {
    if kind == Raised::Escarpment {
        let size = throw_size(state, place)?;
        return Ok([(Benefit::Defence, size), (Benefit::Materials, size)]
            .into_iter()
            .collect());
    }
    let great = kind.magnitude(state, place)?;
    Ok([
        (
            Benefit::Materials,
            if salt_lifted(state, place.anchor)? > 0.0 {
                great.max(0.5)
            } else {
                great / 2.0
            },
        ),
        (Benefit::Sanctity, great),
        (Benefit::Defence, great / 3.0),
    ]
    .into_iter()
    .collect())
}
fn visible<S: LandmarkState + 'static>(kind: Raised) -> Visibility<S> {
    Visibility {
        statement: Must::Value(
            "Throw or relief and extent, contrast, isolation and communities determine the mark."
                .into(),
        ),
        magnitude: Slot::Value(Rc::new(move |state, place| kind.magnitude(state, place))),
        local_conditions: Slot::Value(Rc::new(move |state, place| kind.local(state, place))),
        isolation: Slot::Value(Rc::new(move |state, place| kind.isolation(state, place))),
        cultural: Slot::Value(Rc::new(cultural)),
        importance: Must::Value(Rc::new(move |state, place| {
            let (m, l, i) = if kind == Raised::Dome {
                (0.45, 0.45, 0.1)
            } else {
                (0.5, 0.35, 0.15)
            };
            Ok((m * kind.magnitude(state, place)?
                + l * kind.local(state, place)?
                + i * kind.isolation(state, place)?)
            .max(cultural(state, place)?))
        })),
    }
}
pub fn entry<S: LandmarkState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: Raised,
) -> Entry<S, Schedule> {
    Entry { id: kind.kind(), group: Group::Relief, name: kind.name().into(), recognition: Recognition { distinct: Must::Value("An escarpment follows a recorded fault or a sharply bounded one-sided step; a dome follows a dome-ring record or Salt's retained lift.".into()), is_a: Must::Value(Rc::new(move |state, cell| kind.is_a(state, cell))), landform: Slot::Unwritten }, existence: Existence { origins: Slot::Unwritten, statement: Must::Value("The form emerges from processes and can also be sited through its existing landmark rule.".into()), way: Must::Value(ExistenceWay::Both), requires: Slot::Value(Rc::new(move |state, cell| landmarks::admits(state, kind.landmark(), cell))), suitability: Slot::Value(Rc::new(move |state, cell| landmarks::suits(state, kind.landmark(), cell))), places: Must::Value(Rc::new(move |state| kind.found(state))) },
        publication: Publication { statement: Must::Value("Emergent forms publish outlines; landmark-owned forms publish once through their original record.".into()), moment: Must::Value(if kind == Raised::Dome { Moment::Magic } else { Moment::Geography }), record: Must::Value(Rc::new(move |state: &S, place: &Place| {
            if kind.recorded(state, place.anchor)? { return Ok(None); }
            let mut attributes = crate::features::records::Attributes::new();
            if kind == Raised::Escarpment { attributes.insert("throw".into(), step_at(state, place.anchor)?.drop.into()); }
            records::area(state, place, records::Shape { kind: kind.kind().as_str(), name: kind.name(), layer: "geology", attributes }, None)
        })) }, across_maps: across(kind), event: None,
        roles: Roles { true_size: super::true_sizes::extent(), variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(kind.kind()), fields: fields(), movement: movement(kind), others: others(kind), people: People { statement: Must::Value("Exposed stone and salt provide material; scarps defend ground but shed rock, while domes offer a low defensible rise.".into()), offers: Slot::Value(Rc::new(move |state, place| offers(kind, state, place))), threatens: if kind == Raised::Dome { Slot::NotApplicable("A dome rises slowly and gently.") } else { Slot::Value(Rc::new(|state: &S, place| Ok(vec![Hazard { hazard: "rockfall".into(), reach: state.field()?.scale.cells(1.0), severity: throw_size(state, place)? / 2.0 }]))) } }, time: ThroughTime { statement: Must::Value("Material and erosion develop the form while its current ground remains recognizable.".into()), fate: Slot::Value(Rc::new(move |state, place| Ok(shape::lasts_while(kind.is_a(state, place.anchor)?, None)))) }, visibility: visible(kind), naming: Naming { statement: Must::Value("Local people name the form; nearby settlements can borrow that name.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::NotApplicable("People name the landform itself."), lends_name_to: Slot::Value(vec![cover_shared::near(Kind::Settlement, 6.0)]), term: Slot::Unwritten } },
    }
}
