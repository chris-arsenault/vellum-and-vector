use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    map_records, places, reads, records, relief_shape as shape, sites,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{
        shared::{CellCode, Scalar},
        significance::measure,
    },
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
    storage::Band,
};
use std::{io, rc::Rc};

pub trait ReliefState: State {
    fn plain_slope_threshold(&self) -> f64;
    fn hill_elevation(&self) -> f64;
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Relief {
    Ridge,
    Valley,
    Plateau,
    Pass,
}
impl Relief {
    pub const ALL: [Self; 4] = [Self::Ridge, Self::Valley, Self::Plateau, Self::Pass];
    fn kind(self) -> Kind {
        match self {
            Self::Ridge => Kind::Ridge,
            Self::Valley => Kind::Valley,
            Self::Plateau => Kind::Plateau,
            Self::Pass => Kind::Pass,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Ridge => "Ridge",
            Self::Valley => "Valley",
            Self::Plateau => "Plateau",
            Self::Pass => "Pass",
        }
    }
    fn is_a(self, state: &impl ReliefState, cell: usize) -> io::Result<bool> {
        let field = state.field()?;
        if field.water().column.kind.get(cell)? != 0 {
            return Ok(false);
        }
        Ok(match self {
            Self::Ridge => {
                if reads::has_channel(field, cell)? {
                    return Ok(false);
                }
                let section = shape::section_at(state, cell)?;
                section.crest / field.scale.cells(2.0) > state.plain_slope_threshold()
                    && section.along < 0.5 * section.crest
            }
            Self::Valley => {
                matches!(field.shared.code(CellCode::LandformCodes).get(cell)?, 3 | 9)
                    && shape::section_at(state, cell)?.trough > 0.0
            }
            Self::Plateau => {
                field.shared.scalar(Scalar::Slope).get(cell)? <= state.plain_slope_threshold()
                    && reads::height(field, cell)? >= state.hill_elevation()
                    && shape::section_at(state, cell)?.trough <= 0.0
            }
            Self::Pass => cols(state)?.get(cell)? > 0.0,
        })
    }
    fn found(self, state: &impl ReliefState) -> io::Result<Vec<Place>> {
        let found = if self == Self::Pass {
            places::cell_places(state, self.kind(), |cell| self.is_a(state, cell))?
        } else {
            places::region_places(
                state,
                self.kind(),
                |cell| self.is_a(state, cell),
                |cell| {
                    if self == Self::Valley {
                        Ok(shape::section_at(state, cell)?.trough)
                    } else {
                        reads::height(state.field()?, cell)
                    }
                },
            )?
        };
        Ok(found.as_ref().clone())
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let scale = &state.field()?.scale;
        let size = |value, fraction, dimension, exponent| -> io::Result<f64> {
            Ok(visibility::sized(
                value,
                measure(scale, fraction, dimension, exponent)?,
            ))
        };
        if self == Self::Pass {
            return size(rise(state, place)?, 0.000075, 1, 0.5);
        }
        let evidence = shape::evidence(state, place)?;
        let (a, b) = match self {
            Self::Ridge => (
                size(evidence.span, 0.025, 1, 1.0)?,
                size(evidence.relief, 0.00015, 1, 0.5)?,
            ),
            Self::Valley => (
                size(
                    shape::section_at(state, place.anchor)?.trough,
                    0.000075,
                    1,
                    0.5,
                )?,
                size(evidence.span, 0.025, 1, 1.0)?,
            ),
            _ => (
                size(evidence.area, 0.0005, 2, 1.0)?,
                size(
                    reads::height(state.field()?, place.anchor)?,
                    0.000375,
                    1,
                    0.5,
                )?,
            ),
        };
        Ok((a + b) / 2.0)
    }
    fn local(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let radius = state.field()?.scale.cells(match self {
            Self::Pass => 3.0,
            Self::Plateau => 12.0,
            _ => 6.0,
        });
        let sign = if matches!(self, Self::Valley | Self::Pass) {
            -1.0
        } else {
            1.0
        };
        visibility::stands_out(state, place, radius, |cell| {
            Ok(sign * reads::height(state.field()?, cell)?)
        })
    }
    fn isolation(self, state: &impl ReliefState, place: &Place) -> io::Result<f64> {
        if self == Self::Pass {
            return shape::alone_within(state, place, state.field()?.scale.cells(6.0), |cell| {
                self.is_a(state, cell)
            });
        }
        visibility::alone_among(
            state,
            place,
            &self.found(state)?,
            state
                .field()?
                .scale
                .cells(if self == Self::Plateau { 16.0 } else { 12.0 }),
        )
    }
    fn cultural(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::attachment(
            state,
            place,
            state
                .field()?
                .scale
                .cells(if matches!(self, Self::Valley | Self::Plateau) {
                    10.0
                } else {
                    8.0
                }),
        )
    }
}
fn cols(state: &impl State) -> io::Result<Rc<Band<f64>>> {
    state
        .held()
        .get("relief:keyCols", || state.field()?.key_cols())
}
fn rise(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(MapScale::metres(
        cols(state)?.get(place.anchor)?,
        LengthUnit::Native,
    ))
}
fn counterpart<S: ReliefState + CatalogueState<Schedule>, Schedule>(
    relief: Relief,
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    if relief != Relief::Pass {
        return carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
            relief.is_a(state, cell)
        });
    }
    let field = state.field()?;
    let heights = field.ground().view(GroundField::Elevation);
    let mut best = None;
    for cell in sites::within(&field.mesh, carried.cell, state.parent_cell_span()) {
        if relief.is_a(state, cell)?
            && match best {
                None => true,
                Some(other) => heights.get(cell)? < heights.get(other)?,
            }
        {
            best = Some(cell);
        }
    }
    Ok(best)
}
fn fields<S: ReliefState + 'static>(relief: Relief) -> Fields<S> {
    let terrain: Slot<OnPlace<S, Vec<FieldChange>>> = match relief {
        Relief::Ridge => Slot::NotApplicable("Uplift and erosion leave the crest and its spurs."),
        Relief::Pass => Slot::Value(Rc::new(|state: &S, place: &Place| {
            let field = state.field()?;
            let mut changes = vec![FieldChange::Physical(PhysicalChange {
                cell: place.anchor,
                band: PhysicalBand::Ground(GroundField::Elevation),
                change: Change::AtMost(
                    field
                        .ground()
                        .view(GroundField::Elevation)
                        .get(place.anchor)?,
                ),
            })];
            changes.extend(
                sites::within(&field.mesh, place.anchor, field.scale.cells(1.0))
                    .into_iter()
                    .map(|cell| FieldChange::GradeGround {
                        cell,
                        gradient: 0.08,
                    }),
            );
            Ok(changes)
        })),
        _ => Slot::Value(Rc::new(|state, place| {
            shape::hold_gradient(state, &place.cells, f64::INFINITY)
        })),
    };
    Fields { statement: Must::Value("Corridors and tablelands hold their gradient; cols hold a low crossing and graded approaches.".into()), terrain, water: Slot::NotApplicable("The ordinary water owner reads this ground."), climate: Slot::NotApplicable("Air columns read height and the slopes along their wind."), cover: Slot::NotApplicable("Ecology reads the ground, soil and climate."), magic: Slot::NotApplicable("The landform changes carrier costs without sourcing stock.") }
}
fn across<S: ReliefState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    relief: Relief,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Captured names resolve onto the child's current landforms. Plateaus retain a level top; crests, valleys and cols do not restore parent heights.".into()), stands_on: Slot::Unwritten,
        carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), counterpart: Slot::Value(Rc::new(move |state, carried| counterpart(relief, state, carried))),
        realize: if relief == Relief::Plateau { Slot::Value(Rc::new(move |state: &S, carried| { match counterpart(relief, state, carried)? { Some(cell) => shape::hold_gradient(state, &sites::within(&state.field()?.mesh, cell, state.parent_cell_span()), state.plain_slope_threshold()), None => Ok(Vec::new()) } })) } else { Slot::NotApplicable("Captured ground develops locally without restoring parent heights.") },
        unrealized: Slot::Value(Rc::new(move |state, carried| { if relief == Relief::Plateau { Ok(Unrealized::Keep) } else { Ok(carry_rules::moves_to(counterpart(relief, state, carried)?)) } })),
        settle: if relief == Relief::Pass { Slot::Value(Rc::new(move |state, carried| Ok(carry_rules::moves_to(counterpart(relief, state, carried)?)))) } else { Slot::NotApplicable("The network re-derives relief rather than settling it with each round's water.") },
        schedule: Slot::NotApplicable("Ground and carrier costs require no additional step."),
    }
}
fn movement<S: ReliefState + 'static>(relief: Relief) -> Movement<S> {
    let carriers: &[Carrier] = match relief {
        Relief::Ridge => &[Carrier::Wind],
        Relief::Valley => &[Carrier::River, Carrier::People],
        Relief::Pass => &[Carrier::Wind, Carrier::People],
        Relief::Plateau => &[],
    };
    Movement { on_foot: None, statement: Must::Value("Crests divide drainage, valleys draw it along their floors, and cols ease roads and carriers over ridges.".into()),
        roads: if relief == Relief::Pass { Slot::Value(Rc::new(move |state: &S, place| carry_rules::cost_near(state, place, 1.0 - 0.5 * relief.magnitude(state, place)?, state.field()?.scale.cells(2.0)))) } else { Slot::NotApplicable("Ordinary road grade reads these slopes.") },
        boats: Slot::NotApplicable("Rivers supply any boat route through this ground."),
        drainage: Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, match relief { Relief::Ridge => 3.0, Relief::Valley => 0.5, Relief::Plateau => 1.3, Relief::Pass => 1.5 }, 0.0))),
        magic: if carriers.is_empty() { Slot::NotApplicable("Level high ground adds no carrier cost.") } else { Slot::Value(carriers.iter().map(|&carrier| { let cost: OnPlace<S, Vec<Cost>> = Rc::new(move |state, place| carry_rules::cost_near(state, place, if relief == Relief::Ridge { 1.5 } else { 0.8 }, 0.0)); (carrier, cost) }).collect()) },
        links: Slot::NotApplicable("Relief does not join a fixed pair of cells."), crosses: if relief == Relief::Pass { Slot::Value(Rc::new(|_, _| Ok(vec![Barrier::Ridge]))) } else { Slot::NotApplicable("This landform is not a crossing.") },
    }
}
fn inside<S>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
    }
}
fn same<S>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)),
    }
}
fn others<S: State + 'static>(relief: Relief) -> Others<S> {
    let (excludes, contains, pairs) = match relief {
        Relief::Ridge => (
            vec![inside(Kind::Lake)],
            cover_shared::holds(&[Kind::Peak, Kind::Pass]),
            vec![
                cover_shared::near(Kind::Valley, 4.0),
                cover_shared::holds(&[Kind::FrostPrism]).remove(0),
            ],
        ),
        Relief::Valley => (
            vec![same(Kind::Gorge)],
            cover_shared::holds(&[Kind::Settlement, Kind::Ford, Kind::Mill]),
            [Kind::Ridge, Kind::Gorge, Kind::Pass, Kind::Cirque]
                .into_iter()
                .map(|kind| cover_shared::near(kind, 4.0))
                .collect(),
        ),
        Relief::Plateau => (
            vec![inside(Kind::Lake), inside(Kind::Valley)],
            cover_shared::holds(&[Kind::Settlement, Kind::BasaltFlat, Kind::GlassFlat]),
            vec![
                cover_shared::near(Kind::Escarpment, 4.0),
                cover_shared::near(Kind::Gorge, 6.0),
            ],
        ),
        Relief::Pass => (
            vec![same(Kind::Peak), inside(Kind::Lake)],
            Vec::new(),
            vec![
                inside(Kind::Ridge),
                cover_shared::near(Kind::Peak, 4.0),
                cover_shared::near(Kind::Valley, 4.0),
                cover_shared::near(Kind::Settlement, 8.0),
            ],
        ),
    };
    Others { statement: Must::Value("Crests, corridors, tablelands and crossings relate to the landforms and communities on them.".into()), needs: Slot::NotApplicable("Recognition reads the necessary ground."), excludes: Slot::Value(excludes), contains: if relief == Relief::Pass { Slot::NotApplicable("A pass is a point on a crest.") } else { Slot::Value(contains) }, pairs_with: Slot::Value(pairs) }
}
fn offers(relief: Relief, state: &impl State, place: &Place) -> io::Result<Benefits> {
    let field = state.field()?;
    let m = relief.magnitude(state, place)?;
    Ok(match relief {
        Relief::Ridge => vec![
            (
                Benefit::Defence,
                visibility::sized(shape::section_at(state, place.anchor)?.crest, 150.0),
            ),
            (Benefit::Sanctity, m / 3.0),
        ],
        Relief::Valley => vec![
            (
                Benefit::Water,
                visibility::sized(
                    reads::discharge(field, place.anchor)?,
                    measure(&field.scale, 1.5625e-18, 3, 1.0)?,
                ),
            ),
            (
                Benefit::Food,
                if field
                    .shared
                    .code(CellCode::LandformCodes)
                    .get(place.anchor)?
                    == 9
                {
                    1.0
                } else {
                    field.shared.scalar(Scalar::Moisture).get(place.anchor)? / 1000.0
                },
            ),
            (Benefit::Trade, m),
        ],
        Relief::Plateau => vec![
            (
                Benefit::Food,
                field.shared.scalar(Scalar::GrassCover).get(place.anchor)?,
            ),
            (Benefit::Defence, m),
        ],
        Relief::Pass => vec![(Benefit::Trade, m), (Benefit::Defence, m)],
    }
    .into_iter()
    .collect())
}
fn threatens(relief: Relief, state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let field = state.field()?;
    if relief == Relief::Valley && reads::has_channel(field, place.anchor)? {
        return Ok(vec![Hazard {
            hazard: "flood".into(),
            reach: field.scale.cells(2.0),
            severity: visibility::sized(reads::discharge(field, place.anchor)?, 250.0),
        }]);
    }
    if relief == Relief::Pass && reads::celsius(field, place.anchor)? < 0.0 {
        return Ok(vec![Hazard {
            hazard: "snow closure".into(),
            reach: field.scale.cells(1.0),
            severity: 0.4,
        }]);
    }
    Ok(Vec::new())
}
fn visible<S: ReliefState + 'static>(relief: Relief) -> Visibility<S> {
    Visibility { statement: Must::Value("Extent and relief, contrast against surrounding ground, isolation and nearby communities determine visibility.".into()), magnitude: Slot::Value(Rc::new(move |state, place| relief.magnitude(state, place))), local_conditions: Slot::Value(Rc::new(move |state, place| relief.local(state, place))), isolation: Slot::Value(Rc::new(move |state, place| relief.isolation(state, place))), cultural: Slot::Value(Rc::new(move |state, place| relief.cultural(state, place))), importance: Must::Value(Rc::new(move |state, place| {
        let (m,l,i) = match relief { Relief::Ridge => (0.5,0.35,0.15), Relief::Valley => (0.6,0.25,0.15), Relief::Plateau => (0.5,0.4,0.1), Relief::Pass => (0.4,0.2,0.4) };
        Ok((m * relief.magnitude(state, place)? + l * relief.local(state, place)? + i * relief.isolation(state, place)?).max(relief.cultural(state, place)?))
    })) }
}
fn naming<S: State + 'static>(relief: Relief) -> Naming<S> {
    let takes = match relief {
        Relief::Valley => cover_shared::holds(&[Kind::Settlement]),
        Relief::Pass => vec![
            cover_shared::near(Kind::Peak, 4.0),
            cover_shared::near(Kind::Settlement, 8.0),
        ],
        _ => Vec::new(),
    };
    let lends = match relief {
        Relief::Ridge => vec![
            cover_shared::near(Kind::Settlement, 8.0),
            cover_shared::holds(&[Kind::Pass]).remove(0),
        ],
        Relief::Pass => vec![cover_shared::near(Kind::Settlement, 4.0)],
        _ => cover_shared::holds(&[Kind::Settlement]),
    };
    Naming { statement: Must::Value("Local people name the ground; towns and crossings borrow the names of the landforms they occupy.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: if takes.is_empty() { Slot::NotApplicable("People name this landform directly.") } else { Slot::Value(takes.into_iter().map(|relation| NameRelation { relation, chance: None }).collect()) }, lends_name_to: Slot::Value(lends), term: Slot::Unwritten }
}
pub fn entry<S: ReliefState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    relief: Relief,
) -> Entry<S, Schedule> {
    Entry { id: relief.kind(), group: Group::Relief, name: relief.name().into(),
        recognition: Recognition { distinct: Must::Value("Ridges fall on both sides but less along the crest; valleys have flanks; plateaus are level high ground without flanks; passes are the actual key cols of peaks.".into()), is_a: Must::Value(Rc::new(move |state, cell| relief.is_a(state, cell))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("The generated field determines the landform at every map scale.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Recognition reads the generated terrain."), suitability: Slot::NotApplicable("No siting process chooses this landform."), places: Must::Value(Rc::new(move |state| relief.found(state))) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Connected landforms publish outlines; key cols publish points with their peak's rise.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(move |state: &S, place: &Place| {
            let mut attributes = crate::features::records::Attributes::new();
            if relief == Relief::Pass { attributes.insert("rise".into(), rise(state, place)?.into()); return map_records::site(state, place, "pass", "geology", "Pass", attributes); }
            if relief == Relief::Valley { attributes.insert("depth".into(), shape::section_at(state, place.anchor)?.trough.into()); }
            records::area(state, place, records::Shape { kind: relief.kind().as_str(), name: relief.name(), layer: "geology", attributes }, None)
        })) }, across_maps: across(relief), event: None,
        roles: Roles { true_size: if relief == Relief::Pass { super::true_sizes::sited(&super::true_sizes::PASS) } else { super::true_sizes::extent() }, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(relief.kind()), fields: fields(relief), movement: movement(relief), others: others(relief),
            people: People { statement: Must::Value("Relief provides pasture, water, defence and trade routes; rivers flood valley floors and cold closes passes.".into()), offers: Slot::Value(Rc::new(move |state, place| offers(relief, state, place))), threatens: if matches!(relief, Relief::Ridge | Relief::Plateau) { Slot::NotApplicable("Other entries own the hazards of their slopes and edges.") } else { Slot::Value(Rc::new(move |state, place| threatens(relief, state, place))) } },
            time: ThroughTime { statement: Must::Value("Landforms persist while their ground retains its shape; a river through a col makes a valley.".into()), fate: Slot::Value(Rc::new(move |state, place| { if relief == Relief::Pass { Ok(if reads::has_channel(state.field()?, place.anchor)? { Fate::Becomes(Kind::Valley) } else { Fate::Persists }) } else { Ok(shape::lasts_while(relief.is_a(state, place.anchor)?, None)) } })) }, visibility: visible(relief), naming: naming(relief),
        },
    }
}
