use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads, records,
    relief_contours::ReliefState,
    relief_shape as shape,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{shared::Scalar, significance::measure},
    magic::channels::Channel,
    rock::ground::queries::SurfaceResponse,
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MagicRelief {
    BasaltFlat,
    BasaltScar,
    FrostPrism,
    GlassFlat,
    SinkholeField,
}
impl MagicRelief {
    pub const ALL: [Self; 5] = [
        Self::BasaltFlat,
        Self::BasaltScar,
        Self::FrostPrism,
        Self::GlassFlat,
        Self::SinkholeField,
    ];
    fn identity(self) -> (Kind, &'static str, &'static str, &'static str) {
        match self {
            Self::BasaltFlat => (Kind::BasaltFlat, "fire", "basalt", "Basalt flat"),
            Self::BasaltScar => (Kind::BasaltScar, "fire", "scar", "Basalt scar"),
            Self::FrostPrism => (Kind::FrostPrism, "aurora", "prism", "Frost prism"),
            Self::GlassFlat => (Kind::GlassFlat, "salt", "flat", "Glass flat"),
            Self::SinkholeField => (
                Kind::SinkholeField,
                "greenwood",
                "sinkhole",
                "Sinkhole field",
            ),
        }
    }
    fn is_a(self, state: &impl State, cell: usize) -> io::Result<bool> {
        let (_, system, rule, _) = self.identity();
        reads::magic_rule(state, system, rule, cell)
    }
    fn found(self, state: &impl State) -> io::Result<Vec<Place>> {
        let (kind, system, rule, _) = self.identity();
        Ok(places::rule_places(state, kind, system, rule)?
            .as_ref()
            .clone())
    }
    fn strength(self, state: &impl State, cell: usize) -> io::Result<f64> {
        Ok(reads::magic_value(state, self.identity().1, Channel::Intensity, cell)? / 1000.0)
    }
    fn read(self, state: &impl State, cell: usize) -> io::Result<f64> {
        match self {
            Self::BasaltScar => reads::rock(state.field()?, cell, SurfaceResponse::HardestShare),
            Self::SinkholeField => reads::magic_value(state, "greenwood", Channel::Subsided, cell),
            _ => reads::magic_value(state, self.identity().1, Channel::Intensity, cell),
        }
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let scale = &state.field()?.scale;
        let fraction = match self {
            Self::BasaltScar => 0.00003125,
            Self::FrostPrism | Self::SinkholeField => 0.000025,
            _ => 0.000125,
        };
        let area = visibility::sized(
            shape::evidence(state, place)?.area,
            measure(scale, fraction, 2, 1.0)?,
        );
        if self == Self::BasaltScar {
            return Ok(area);
        }
        let other = if self == Self::SinkholeField {
            visibility::sized(
                self.read(state, place.anchor)?,
                measure(scale, 0.00000125, 1, 0.5)?,
            )
        } else {
            self.strength(state, place.anchor)?
        };
        Ok((area + other) / 2.0)
    }
    fn local(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::stands_out(
            state,
            place,
            state.field()?.scale.cells(match self {
                Self::FrostPrism => 6.0,
                Self::SinkholeField => 4.0,
                _ => 8.0,
            }),
            |cell| self.read(state, cell),
        )
    }
    fn isolation(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::alone_among(
            state,
            place,
            &self.found(state)?,
            state
                .field()?
                .scale
                .cells(if matches!(self, Self::FrostPrism | Self::SinkholeField) {
                    8.0
                } else {
                    12.0
                }),
        )
    }
    fn cultural(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::attachment(
            state,
            place,
            state.field()?.scale.cells(if self == Self::SinkholeField {
                6.0
            } else {
                8.0
            }),
        )
    }
    fn sheet(self) -> bool {
        matches!(self, Self::BasaltFlat | Self::BasaltScar | Self::GlassFlat)
    }
    fn basalt(self) -> bool {
        matches!(self, Self::BasaltFlat | Self::BasaltScar)
    }
}
fn fields<S: State + 'static>(kind: MagicRelief) -> Fields<S> {
    Fields { statement: Must::Value("Magic owners write their stock, rock and climate feedback. Sheets hold their gradient and cover; collapsed springs stop water passage without repeating subsidence.".into()),
        terrain: if kind.sheet() { Slot::Value(Rc::new(|state, place| shape::hold_gradient(state, &place.cells, f64::INFINITY))) } else { Slot::NotApplicable("The magic owner already changes the rock.") },
        water: if kind == MagicRelief::SinkholeField { Slot::Value(Rc::new(|_, place| Ok(place.cells.iter().map(|&cell| FieldChange::WaterPassage { cell, withdrawal: 0.0, transmission: 0.0 }).collect()))) } else { Slot::NotApplicable("Ordinary drainage and the magic owner's water feedback apply.") },
        climate: Slot::NotApplicable("Height and magic feedback own the air and temperature."),
        cover: if kind.basalt() { Slot::Value(Rc::new(|state, place| shape::thin_soil(state, &place.cells))) } else if kind == MagicRelief::GlassFlat { Slot::Value(Rc::new(|_, place| Ok(shape::bare(&place.cells)))) } else { Slot::NotApplicable("Ecology and magic feedback read the field directly.") },
        magic: Slot::NotApplicable("The owning system writes conductance, charge, salting or verdure."),
    }
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    kind: MagicRelief,
    state: &S,
    carried: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(state, carried, state.parent_cell_span(), 1.0, |cell| {
        kind.is_a(state, cell)
    })
}
fn across<S: ReliefState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: MagicRelief,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Names resolve onto the captured system's current class. Basalt records remain when unresolved; other records leave when their class no longer occurs locally.".into()), stands_on: Slot::Unwritten,
        carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), counterpart: Slot::Value(Rc::new(move |state, carried| counterpart(kind, state, carried))),
        realize: if kind.sheet() { Slot::Value(Rc::new(move |state: &S, carried| {
            let cell = counterpart(kind, state, carried)?.or_else(|| kind.basalt().then_some(carried.cell));
            match cell { Some(cell) => shape::hold_gradient(state, &[cell], state.plain_slope_threshold()), None => Ok(Vec::new()) }
        })) } else { Slot::NotApplicable("The child's own ground and magic supply the form without replaying parent heights or subsidence.") },
        unrealized: Slot::Value(Rc::new(move |state, carried| { if kind.basalt() { Ok(Unrealized::Keep) } else { Ok(counterpart(kind, state, carried)?.map_or(Unrealized::Drop, Unrealized::Move)) } })),
        settle: Slot::NotApplicable("Stock and seals develop over epochs rather than moving with each round's water."), schedule: Slot::NotApplicable("The system's existing steps develop this feature."),
    }
}
fn movement<S: State + 'static>(kind: MagicRelief) -> Movement<S> {
    let carriers: &[Carrier] = match kind {
        MagicRelief::FrostPrism => &[Carrier::Ice],
        MagicRelief::GlassFlat => &[Carrier::Wind, Carrier::People],
        MagicRelief::SinkholeField => &[Carrier::Crust],
        _ => &[],
    };
    Movement { statement: Must::Value("Heat, ice, glass and broken ground change roads and drainage. Carriers read the associated cost without duplicate stock effects.".into()),
        roads: Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, match kind { MagicRelief::BasaltFlat => 1.4, MagicRelief::FrostPrism => 2.5, MagicRelief::SinkholeField => 1.8, _ => 0.8 }, 0.0))),
        boats: Slot::NotApplicable("This ground carries no navigable water."),
        drainage: if kind == MagicRelief::FrostPrism { Slot::NotApplicable("Drainage begins below the ice where it melts.") } else { Slot::Value(Rc::new(move |state, place| carry_rules::cost_near(state, place, match kind { MagicRelief::GlassFlat => 2.0, MagicRelief::SinkholeField => 0.6, _ => 1.3 }, 0.0))) },
        magic: if carriers.is_empty() { Slot::NotApplicable("Crust-borne Fire reads the conduit owner's conductance.") } else { Slot::Value(carriers.iter().map(|&carrier| { let cost: OnPlace<S, Vec<Cost>> = Rc::new(move |state, place| carry_rules::cost_near(state, place, if kind == MagicRelief::SinkholeField { 3.0 } else { 0.7 }, 0.0)); (carrier, cost) }).collect()) },
        links: Slot::NotApplicable("This ground joins no pair of cells."), crosses: Slot::NotApplicable("The landform supplies no barrier crossing."),
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
fn others<S: State + 'static>(kind: MagicRelief) -> Others<S> {
    let (excludes, contains, pairs) = match kind {
        MagicRelief::BasaltFlat => (
            vec![inside(Kind::Lake), inside(Kind::Forest)],
            cover_shared::holds(&[Kind::ThermalVein]),
            vec![
                cover_shared::near(Kind::Volcano, 8.0),
                inside(Kind::Plateau),
                cover_shared::near(Kind::BasaltScar, 4.0),
            ],
        ),
        MagicRelief::BasaltScar => (
            vec![inside(Kind::Lake), inside(Kind::Forest)],
            cover_shared::holds(&[Kind::Ruin]),
            vec![
                cover_shared::near(Kind::BasaltFlat, 4.0),
                cover_shared::near(Kind::ThermalVein, 6.0),
            ],
        ),
        MagicRelief::FrostPrism => (
            vec![inside(Kind::Lake)],
            Vec::new(),
            vec![
                inside(Kind::Ridge),
                cover_shared::near(Kind::Peak, 4.0),
                cover_shared::near(Kind::LightWell, 6.0),
                inside(Kind::AuroraField),
            ],
        ),
        MagicRelief::GlassFlat => (
            vec![
                inside(Kind::Forest),
                inside(Kind::Wetland),
                inside(Kind::Lake),
            ],
            Vec::new(),
            vec![
                cover_shared::near(Kind::SaltPan, 4.0),
                cover_shared::near(Kind::SaltDust, 6.0),
                cover_shared::near(Kind::KillingGround, 6.0),
            ],
        ),
        MagicRelief::SinkholeField => (
            vec![same(Kind::Oasis), same(Kind::Spring)],
            cover_shared::holds(&[Kind::Lake]),
            vec![
                cover_shared::near(Kind::Settlement, 8.0),
                cover_shared::near(Kind::Ruin, 6.0),
            ],
        ),
    };
    Others { statement: Must::Value("The feature relates to the stock, landforms and communities that surround its current ground.".into()), needs: Slot::NotApplicable("The system's rule already reads its required material and ground."), excludes: Slot::Value(excludes), contains: if contains.is_empty() { Slot::NotApplicable("Related places lie around this ground rather than inside it.") } else { Slot::Value(contains) }, pairs_with: Slot::Value(pairs) }
}
fn rimmed(state: &impl State, place: &Place) -> io::Result<f64> {
    let mesh = &state.field()?.mesh;
    let (mut all, mut met) = (0, 0);
    for edge in 0..3 {
        if let Some(cell) = mesh.neighbor(place.anchor, edge) {
            all += 1;
            if MagicRelief::GlassFlat.is_a(state, cell)? {
                met += 1;
            }
        }
    }
    Ok(if all > 0 {
        f64::from(met) / f64::from(all)
    } else {
        0.0
    })
}
fn offers(kind: MagicRelief, state: &impl State, place: &Place) -> io::Result<Benefits> {
    Ok(match kind {
        MagicRelief::BasaltFlat => vec![
            (
                Benefit::Materials,
                reads::rock(state.field()?, place.anchor, SurfaceResponse::HardestShare)?,
            ),
            (Benefit::Trade, kind.magnitude(state, place)? / 2.0),
        ],
        MagicRelief::BasaltScar => vec![
            (
                Benefit::Materials,
                reads::rock(state.field()?, place.anchor, SurfaceResponse::HardestShare)?,
            ),
            (Benefit::Sanctity, 0.4),
        ],
        MagicRelief::FrostPrism => vec![
            (Benefit::Sanctity, kind.magnitude(state, place)?),
            (
                Benefit::Materials,
                kind.strength(state, place.anchor)? / 2.0,
            ),
        ],
        MagicRelief::GlassFlat => vec![
            (Benefit::Materials, kind.strength(state, place.anchor)?),
            (Benefit::Trade, rimmed(state, place)? / 2.0),
            (Benefit::Sanctity, kind.magnitude(state, place)?),
        ],
        MagicRelief::SinkholeField => vec![(
            Benefit::Water,
            state
                .field()?
                .shared
                .scalar(Scalar::Moisture)
                .get(place.anchor)?
                / 2000.0,
        )],
    }
    .into_iter()
    .collect())
}
fn threatens(kind: MagicRelief, state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let strength = kind.strength(state, place.anchor)?;
    let (hazard, severity, spans) = match kind {
        MagicRelief::BasaltFlat if strength > 0.0 => ("burning ground", strength, 1.0),
        MagicRelief::FrostPrism => ("stillness", strength, 1.0),
        MagicRelief::GlassFlat => ("desiccation", strength, 2.0),
        MagicRelief::SinkholeField => (
            "ground collapse",
            kind.magnitude(state, place)?.max(0.3),
            1.0,
        ),
        _ => return Ok(Vec::new()),
    };
    Ok(vec![Hazard {
        hazard: hazard.into(),
        severity,
        reach: state.field()?.scale.cells(spans),
    }])
}
fn fate(kind: MagicRelief, state: &impl State, place: &Place) -> io::Result<Fate> {
    if kind == MagicRelief::SinkholeField {
        return Ok(
            if state.field()?.water().column.kind.get(place.anchor)? == 2 {
                Fate::Becomes(Kind::Lake)
            } else {
                Fate::Persists
            },
        );
    }
    if kind == MagicRelief::BasaltFlat && reads::magic_rule(state, "fire", "scar", place.anchor)? {
        return Ok(Fate::Becomes(Kind::BasaltScar));
    }
    Ok(shape::lasts_while(
        kind.is_a(state, place.anchor)?,
        match kind {
            MagicRelief::BasaltScar => Some(Kind::ThermalVein),
            MagicRelief::GlassFlat => Some(Kind::SaltPan),
            _ => None,
        },
    ))
}
fn visible<S: State + 'static>(kind: MagicRelief) -> Visibility<S> {
    Visibility { statement: Must::Value("Area and the system's material expression, local contrast, isolation and nearby communities determine the mark.".into()), magnitude: Slot::Value(Rc::new(move |state, place| kind.magnitude(state, place))), local_conditions: Slot::Value(Rc::new(move |state, place| kind.local(state, place))), isolation: Slot::Value(Rc::new(move |state, place| kind.isolation(state, place))), cultural: Slot::Value(Rc::new(move |state, place| kind.cultural(state, place))), importance: Must::Value(Rc::new(move |state, place| {
        let (l,i) = match kind { MagicRelief::BasaltFlat => (0.35,0.15), MagicRelief::GlassFlat => (0.4,0.1), MagicRelief::SinkholeField => (0.2,0.3), _ => (0.3,0.2) };
        Ok((0.5 * kind.magnitude(state, place)? + l * kind.local(state, place)? + i * kind.isolation(state, place)?).max(kind.cultural(state, place)?))
    })) }
}
fn naming<S: State + 'static>(kind: MagicRelief) -> Naming<S> {
    let takes = match kind {
        MagicRelief::BasaltFlat => vec![cover_shared::near(Kind::Volcano, 8.0)],
        MagicRelief::BasaltScar => vec![cover_shared::near(Kind::BasaltFlat, 4.0)],
        MagicRelief::FrostPrism => vec![cover_shared::near(Kind::Peak, 4.0), inside(Kind::Ridge)],
        MagicRelief::SinkholeField => vec![cover_shared::near(Kind::Settlement, 8.0)],
        MagicRelief::GlassFlat => Vec::new(),
    };
    let lends = match kind {
        MagicRelief::BasaltFlat => vec![cover_shared::near(Kind::BasaltScar, 4.0)],
        MagicRelief::BasaltScar => cover_shared::holds(&[Kind::Ruin]),
        MagicRelief::FrostPrism => vec![cover_shared::near(Kind::Shrine, 6.0)],
        MagicRelief::GlassFlat => vec![
            cover_shared::near(Kind::SaltPan, 4.0),
            cover_shared::near(Kind::Settlement, 6.0),
        ],
        MagicRelief::SinkholeField => Vec::new(),
    };
    Naming { statement: Must::Value("Local people name the material's ground and remember its height, source, fire or lost spring.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: if takes.is_empty() { Slot::NotApplicable("The dead lake is gone before its replacement is named.") } else { Slot::Value(takes.into_iter().map(|relation| NameRelation { relation, chance: None }).collect()) }, lends_name_to: if lends.is_empty() { Slot::NotApplicable("The failed spring gives no name others want.") } else { Slot::Value(lends) }, term: Slot::Unwritten }
}
pub fn entry<S: ReliefState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: MagicRelief,
) -> Entry<S, Schedule> {
    let (id, system, rule, name) = kind.identity();
    Entry { id, group: Group::Relief, name: name.into(), recognition: Recognition { distinct: Must::Value("The owning system's exact geographic rule identifies the feature from its current stock, source, seal and terrain.".into()), is_a: Must::Value(Rc::new(move |state, cell| kind.is_a(state, cell))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("The system's processes leave these forms where their material meets the ground.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Recognition reads the complete owning rule."), suitability: Slot::NotApplicable("These are process outcomes, not chosen sites."), places: Must::Value(Rc::new(move |state| kind.found(state))) },
        publication: Publication { statement: Must::Value("Connected rule cells publish through their owning magic class.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(move |state: &S, place: &Place| records::rule(state, place, system, rule))) },
        across_maps: across(kind), event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten, fields: fields(kind), movement: movement(kind), others: others(kind),
            people: People { statement: Must::Value("Material, trade, water or sanctity accompany the feature's specific heat, stillness, dryness or collapse hazard.".into()), offers: Slot::Value(Rc::new(move |state, place| offers(kind, state, place))), threatens: if kind == MagicRelief::BasaltScar { Slot::NotApplicable("Sealed rock is cold; its danger went with its Fire.") } else { Slot::Value(Rc::new(move |state, place| threatens(kind, state, place))) } },
            time: ThroughTime { statement: Must::Value("Current seals, charge and bed determine persistence; drowned sinkholes become lakes.".into()), fate: Slot::Value(Rc::new(move |state, place| fate(kind, state, place))) }, visibility: visible(kind), naming: naming(kind),
        },
    }
}
