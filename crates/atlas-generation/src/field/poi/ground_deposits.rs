//! Deposits keep their natural and magic forms under one catalogue identity.
use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    ground_reads::{self as ground, GroundState},
    kinds::{AreaKind, Group, Kind},
    map_records, places, reads, records, sites,
    state::State,
    values::*,
    visibility,
};
use crate::{
    features::{records::Attributes, Feature, FeatureSelection},
    field::{refinement::topology::distance, shared::Scalar, significance::measure},
    magic::channels::Channel,
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Deposit {
    ThermalVein,
    Placer,
    SaltPan,
    SaltDust,
    KillingGround,
}
impl Deposit {
    pub const ALL: [Self; 5] = [
        Self::ThermalVein,
        Self::Placer,
        Self::SaltPan,
        Self::SaltDust,
        Self::KillingGround,
    ];
    fn identity(self) -> (Kind, &'static str, &'static str, &'static str) {
        match self {
            Self::ThermalVein => (Kind::ThermalVein, "fire", "vein", "Thermal vein"),
            Self::Placer => (Kind::Placer, "fire", "placer", "Placer band"),
            Self::SaltPan => (Kind::SaltPan, "salt", "pan", "Salt pan"),
            Self::SaltDust => (Kind::SaltDust, "salt", "dust", "Salt dust"),
            Self::KillingGround => (Kind::KillingGround, "salt", "ground", "Killing ground"),
        }
    }
    fn is_a(self, state: &impl GroundState, cell: usize) -> io::Result<bool> {
        match self {
            Self::Placer => ground::placer(state, cell),
            Self::SaltPan => ground::pan(state, cell),
            Self::KillingGround => ground::killing(state, cell),
            _ => {
                let (_, system, rule, _) = self.identity();
                reads::magic_rule(state, system, rule, cell)
            }
        }
    }
    fn found(self, state: &impl GroundState) -> io::Result<Vec<Place>> {
        let (kind, system, rule, _) = self.identity();
        match self {
            Self::Placer => ground::grown_and_natural(
                state,
                kind,
                system,
                rule,
                |c| ground::natural_bar(state, c),
                |c| {
                    let sediment = ground::sediment(state, c)?;
                    Ok(metal(state, c)? + sediment / (sediment + 1.0))
                },
            ),
            Self::SaltPan => ground::grown_and_natural(
                state,
                kind,
                system,
                rule,
                |c| ground::natural_pan(state, c),
                |c| Ok(ground::spill_depth(state, c)? + ground::salting(state, c)?),
            ),
            Self::KillingGround => ground::grown_and_natural(
                state,
                kind,
                system,
                rule,
                |c| ground::natural_killing(state, c),
                |c| dead(state, c),
            ),
            _ => Ok(places::rule_places(state, kind, system, rule)?
                .as_ref()
                .clone()),
        }
    }
    fn magnitude(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let scale = &state.field()?.scale;
        Ok(match self {
            Self::ThermalVein => {
                (visibility::sized(
                    ground::length(state, place)?,
                    measure(scale, 0.025, 1, 1.0)?,
                ) + strength(state, place)?)
                    / 2.0
            }
            Self::Placer => {
                (visibility::sized(ground::length(state, place)?, measure(scale, 0.01, 1, 1.0)?)
                    + flow_size(state, place)?
                    + richness(state, place)?)
                    / 3.0
            }
            Self::SaltPan | Self::SaltDust => visibility::sized(
                ground::area(state, place)?,
                measure(scale, 0.000125, 2, 1.0)?,
            ),
            Self::KillingGround => {
                visibility::sized(dead(state, place.anchor)?, ground::full_salt(state))
            }
        })
    }
    fn local(self, state: &impl State, place: &Place) -> io::Result<f64> {
        visibility::stands_out(
            state,
            place,
            ground::around(state)? * if self == Self::SaltPan { 2.0 } else { 1.0 },
            |cell| match self {
                Self::ThermalVein => reads::magic_value(state, "fire", Channel::Intensity, cell),
                Self::Placer => ground::sediment(state, cell),
                Self::SaltPan => Ok(1.0
                    - (cover_shared::scalar(state, Scalar::TreeCover, cell)?
                        + cover_shared::scalar(state, Scalar::GrassCover, cell)?)
                    .min(1.0)),
                Self::SaltDust => ground::salting(state, cell),
                Self::KillingGround => dead(state, cell),
            },
        )
    }
    fn isolation(self, state: &impl GroundState, place: &Place) -> io::Result<f64> {
        visibility::alone_among(
            state,
            place,
            &self.found(state)?,
            2.0 * ground::around(state)?,
        )
    }
    fn cultural(self, state: &impl State, place: &Place) -> io::Result<f64> {
        let reach = match self {
            Self::ThermalVein => vein_reach(state)?,
            Self::SaltPan => 2.0 * ground::around(state)?,
            _ => ground::around(state)?,
        };
        let living = visibility::attachment(state, place, reach)?;
        if self == Self::KillingGround {
            let field = state.field()?;
            for event in state.features().values(FeatureSelection {
                kind: Some("societyEvent"),
                ..Default::default()
            })? {
                if let Some(cell) = reads::feature_cell(field, &event?) {
                    if distance(&field.mesh, cell, place.anchor) <= reach {
                        return Ok(living.max(0.6));
                    }
                }
            }
        }
        Ok(living)
    }
    fn weights(self) -> [f64; 3] {
        match self {
            Self::ThermalVein => [0.5, 0.3, 0.2],
            Self::Placer | Self::KillingGround => [0.5, 0.2, 0.3],
            Self::SaltPan => [0.5, 0.35, 0.15],
            Self::SaltDust => [0.6, 0.3, 0.1],
        }
    }
}
fn strength(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok((reads::magic_value(state, "fire", Channel::Intensity, place.anchor)? / 1000.0).min(1.0))
}
fn vein_reach(state: &impl State) -> io::Result<f64> {
    Ok(ground::around(state)?.max(measure(&state.field()?.scale, 0.00625, 1, 1.0)?))
}
fn metal(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(
        (ground::stock_per_area(state, "fire", "fallen/held", cell)? / 1000.0
            + ground::stock_per_area(state, "fire", "vein/spent", cell)? / 1000.0)
            .min(1.0),
    )
}
fn richness(state: &impl State, place: &Place) -> io::Result<f64> {
    let mut most = 0.0f64;
    for &cell in &place.cells {
        most = most.max(metal(state, cell)?);
    }
    Ok(most)
}
fn flow_size(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        reads::discharge(state.field()?, place.anchor)?,
        measure(&state.field()?.scale, 3.90625e-18, 3, 1.0)?,
    ))
}
fn dead(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(ground::stock_per_area(state, "salt", "death/brine", cell)?
        + ground::recorded_brine(state, cell)?)
}
fn slack(state: &impl State, cell: usize) -> io::Result<Vec<FieldChange>> {
    let gradient = ground::flow_gradient(state, cell)?;
    Ok(if gradient > 0.0 {
        vec![FieldChange::GradeGround { cell, gradient }]
    } else {
        Vec::new()
    })
}
fn record(
    kind: Deposit,
    state: &impl map_records::MapState,
    place: &Place,
) -> io::Result<Option<Feature>> {
    let (id, system, rule, name) = kind.identity();
    if reads::magic_rule(state, system, rule, place.anchor)? {
        return records::rule(state, place, system, rule);
    }
    let mut attributes = Attributes::new();
    match kind {
        Deposit::Placer => {
            attributes.insert(
                "sediment".into(),
                ground::sediment(state, place.anchor)?.into(),
            );
        }
        Deposit::KillingGround => {
            attributes.insert(
                "recordedBrine".into(),
                ground::recorded_brine(state, place.anchor)?.into(),
            );
        }
        Deposit::SaltPan => {
            return records::area(
                state,
                place,
                records::Shape {
                    kind: id.as_str(),
                    layer: "geology",
                    name,
                    attributes,
                },
                None,
            )
        }
        _ => return records::rule(state, place, system, rule),
    }
    map_records::site(state, place, id.as_str(), "geology", name, attributes)
}
fn fields<S: GroundState + 'static>(kind: Deposit) -> Fields<S> {
    let mut fields: Fields<S> = cover_shared::fields("The owning system moves material and writes its feedback wherever its stock stands; deposits do not duplicate those writes.");
    match kind {
        Deposit::Placer => {
            fields.terrain = Slot::Value(Rc::new(|s, p| {
                let mut changes = Vec::new();
                for &cell in &p.cells {
                    changes.extend(slack(s, cell)?);
                }
                Ok(changes)
            }))
        }
        Deposit::SaltPan => {
            fields.terrain = Slot::Value(Rc::new(|_, p| {
                Ok(p.cells
                    .iter()
                    .map(|&cell| FieldChange::GradeGround {
                        cell,
                        gradient: 0.001,
                    })
                    .collect())
            }));
            fields.magic = Slot::Value(Rc::new(|s, p| {
                let mut changes = Vec::new();
                for &cell in &p.cells {
                    if ground::natural_pan(s, cell)? {
                        changes.push(FieldChange::Physical(PhysicalChange {
                            cell,
                            band: PhysicalBand::Scalar(Scalar::Salting),
                            change: Change::AtLeast(0.3),
                        }));
                    }
                }
                Ok(changes)
            }));
        }
        _ => {}
    }
    fields
}
fn counterpart<S: GroundState + CatalogueState<Schedule>, Schedule>(
    kind: Deposit,
    s: &S,
    c: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(s, c, s.parent_cell_span(), 1.0, |cell| kind.is_a(s, cell))
}
fn moved<S: GroundState + CatalogueState<Schedule>, Schedule>(
    kind: Deposit,
    s: &S,
    c: &Carried,
) -> io::Result<Unrealized> {
    Ok(counterpart(kind, s, c)?.map_or(Unrealized::Drop, Unrealized::Move))
}
fn across<S: GroundState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: Deposit,
) -> AcrossMaps<S, Schedule> {
    let realize = match kind {
        Deposit::Placer => Slot::Value(Rc::new(move |s: &S, c: &Carried| match counterpart(kind, s, c)? { Some(cell) => slack(s, cell), None => Ok(Vec::new()) }) as OnCarried<S, Vec<FieldChange>>),
        Deposit::SaltPan => Slot::Value(Rc::new(|s: &S, c: &Carried| {
            let Some(bowl) = s.basin_bowl() else { return Ok(Vec::new()); };
            Ok(sites::within(&s.field()?.mesh, c.cell, s.parent_cell_span()).into_iter().filter(|&cell| bowl[cell] > 0).map(|cell| FieldChange::GradeGround { cell, gradient: 0.001 }).collect())
        }) as OnCarried<S, Vec<FieldChange>>),
        _ => Slot::NotApplicable("Inherited material and the owning system develop this place without shaping its ground."),
    };
    let settle = match kind {
        Deposit::ThermalVein | Deposit::KillingGround => Slot::NotApplicable(
            "Rock and brine move through their owners, not a water-round place effect.",
        ),
        _ => Slot::Value(Rc::new(move |s: &S, c: &Carried| {
            let keep = match kind {
                Deposit::Placer => ground::placer(s, c.cell)?,
                Deposit::SaltPan => s.field()?.water().column.kind.get(c.cell)? != 2,
                _ => false,
            };
            if keep {
                Ok(Unrealized::Keep)
            } else {
                moved(kind, s, c)
            }
        }) as OnCarried<S, Unrealized>),
    };
    AcrossMaps { statement: Must::Value("Captured material develops on the child. Bars preserve a slack river reach, pans level their inherited bowl, and dead ground retains its identity even when finer cells read below the rule floor.".into()), stands_on: if kind == Deposit::Placer { Slot::Value(AreaKind::River) } else { Slot::Unwritten }, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize,
        counterpart: Slot::Value(Rc::new(move |s, c| counterpart(kind, s, c))), unrealized: Slot::Value(Rc::new(move |s, c| if kind == Deposit::KillingGround { Ok(Unrealized::Keep) } else { moved(kind, s, c) })), settle, schedule: Slot::NotApplicable("The place adds no refinement step.") }
}
fn movement<S: State + 'static>(kind: Deposit) -> Movement<S> {
    let mut movement: Movement<S> = cover_shared::movement(
        "People, boats and carriers respond to the deposit's own ground or material.",
    );
    movement.roads = match kind {
        Deposit::ThermalVein => Slot::Value(Rc::new(|s, p| {
            let mut costs = Vec::new();
            for &cell in &p.cells {
                if reads::celsius(s.field()?, cell)? <= 0.0
                    && cover_shared::scalar(s, Scalar::IceThickness, cell)? <= 0.0
                {
                    costs.push(Cost { cell, factor: 0.85 });
                }
            }
            Ok(costs)
        })),
        Deposit::Placer => Slot::NotApplicable(
            "Road costs read the river; gravel crossings are declared separately.",
        ),
        _ => Slot::Value(Rc::new(move |s, p| {
            carry_rules::cost_near(
                s,
                p,
                match kind {
                    Deposit::SaltPan => 0.8,
                    Deposit::SaltDust => 1.15,
                    _ => 1.5,
                },
                0.0,
            )
        })),
    };
    movement.boats = if kind == Deposit::Placer {
        Slot::Value(Rc::new(|s, p| carry_rules::cost_near(s, p, 2.0, 0.0)))
    } else {
        Slot::NotApplicable("This ground place adds no boat route cost.")
    };
    movement.drainage = if matches!(
        kind,
        Deposit::ThermalVein | Deposit::Placer | Deposit::SaltPan
    ) {
        Slot::Value(Rc::new(move |s, p| {
            carry_rules::cost_near(
                s,
                p,
                match kind {
                    Deposit::ThermalVein => 0.8,
                    Deposit::Placer => 1.25,
                    _ => 0.5,
                },
                0.0,
            )
        }))
    } else {
        Slot::NotApplicable("Thin salt changes no drainage slope.")
    };
    movement.magic = if matches!(
        kind,
        Deposit::Placer | Deposit::SaltDust | Deposit::KillingGround
    ) {
        let (carrier, factor) = match kind {
            Deposit::Placer => (Carrier::River, 1.5),
            Deposit::SaltDust => (Carrier::Wind, 0.8),
            _ => (Carrier::People, 1.5),
        };
        let cost: OnPlace<S, Vec<Cost>> =
            Rc::new(move |s, p| carry_rules::cost_near(s, p, factor, 0.0));
        Slot::Value([(carrier, cost)].into_iter().collect())
    } else {
        Slot::NotApplicable("The owner's material propagation already reads the physical medium.")
    };
    movement.crosses = match kind {
        Deposit::Placer => Slot::Value(Rc::new(|s, p| {
            Ok(
                if reads::discharge(s.field()?, p.anchor)?
                    <= measure(&s.field()?.scale, 7.8125e-19, 3, 1.0)?
                {
                    vec![Barrier::River]
                } else {
                    Vec::new()
                },
            )
        })),
        Deposit::ThermalVein => Slot::Value(Rc::new(|s, p| {
            let field = s.field()?;
            for &cell in &p.cells {
                if cover_shared::scalar(s, Scalar::IceThickness, cell)? <= 0.0 {
                    for edge in 0..3 {
                        if let Some(next) = field.mesh.neighbor(cell, edge) {
                            if cover_shared::scalar(s, Scalar::IceThickness, next)? > 0.0 {
                                return Ok(vec![Barrier::Ice]);
                            }
                        }
                    }
                }
            }
            Ok(Vec::new())
        })),
        _ => Slot::NotApplicable("The deposit opens no barrier crossing."),
    };
    movement
}
pub(super) fn near<S: State + 'static>(kind: Kind, factor: f64) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |s, a, b| places::within(s, a, b, factor * ground::around(s)?)),
    }
}
pub(super) fn stands_on<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
    }
}
fn others<S: State + 'static>(kind: Deposit) -> Others<S> {
    let (excludes, contains, pairs) = match kind {
        Deposit::ThermalVein => (
            vec![stands_on(Kind::Vent)],
            Slot::Value(cover_shared::holds(&[Kind::Mine])),
            vec![
                near(Kind::Spring, 1.0),
                Relation {
                    kind: Kind::Forge,
                    holds: Rc::new(|s, a, b| places::within(s, a, b, vein_reach(s)?)),
                },
                near(Kind::ThawedHalo, 1.0),
            ],
        ),
        Deposit::Placer => {
            let mut excludes = cover_shared::holds(&[Kind::Waterfall]);
            excludes.push(stands_on(Kind::Lake));
            (
                excludes,
                Slot::Value(cover_shared::holds(&[Kind::Mine])),
                vec![
                    near(Kind::EjectaFan, 4.0),
                    near(Kind::Crater, 4.0),
                    near(Kind::ThermalVein, 4.0),
                    near(Kind::Waterfall, 1.0),
                    near(Kind::Settlement, 1.0),
                ],
            )
        }
        Deposit::SaltPan => (
            vec![stands_on(Kind::Lake), stands_on(Kind::GlassFlat)],
            Slot::Value(cover_shared::holds(&[Kind::Mine, Kind::KillingGround])),
            vec![
                near(Kind::SaltDust, 3.0),
                near(Kind::Lake, 1.0),
                near(Kind::Oasis, 2.0),
                near(Kind::GlassFlat, 1.0),
            ],
        ),
        Deposit::SaltDust => (
            vec![stands_on(Kind::Lake)],
            Slot::NotApplicable("Nothing is sited in a plume for being one."),
            vec![
                near(Kind::SaltPan, 3.0),
                near(Kind::GlassFlat, 3.0),
                near(Kind::KillingGround, 3.0),
            ],
        ),
        Deposit::KillingGround => (
            vec![stands_on(Kind::Lake)],
            Slot::Value(cover_shared::holds(&[
                Kind::Battlefield,
                Kind::DisasterSite,
            ])),
            vec![
                near(Kind::Shrine, 1.0),
                near(Kind::Ruin, 1.0),
                near(Kind::SaltPan, 1.0),
                near(Kind::SaltDust, 3.0),
            ],
        ),
    };
    Others { statement: Must::Value("Deposits relate to the sources that fed them, their consumers and the ground they can share.".into()), needs: Slot::NotApplicable("Recognition already supplies the material or natural preconditions."), excludes: Slot::Value(excludes), contains, pairs_with: Slot::Value(pairs) }
}
fn offers(kind: Deposit, s: &impl State, p: &Place) -> io::Result<Benefits> {
    Ok(match kind {
        Deposit::ThermalVein => {
            let value = strength(s, p)?;
            [(Benefit::Materials, value), (Benefit::Power, value / 2.0)]
                .into_iter()
                .collect()
        }
        Deposit::Placer => {
            let rich = richness(s, p)?;
            [
                (Benefit::Materials, 0.25 + 0.75 * rich),
                (Benefit::Trade, rich / 2.0),
            ]
            .into_iter()
            .collect()
        }
        Deposit::SaltPan => {
            let great = kind.magnitude(s, p)?;
            [
                (Benefit::Materials, 0.4 + 0.6 * great),
                (Benefit::Trade, great),
            ]
            .into_iter()
            .collect()
        }
        Deposit::KillingGround => {
            let great = kind.magnitude(s, p)?;
            [
                (Benefit::Sanctity, great),
                (Benefit::Materials, great / 3.0),
            ]
            .into_iter()
            .collect()
        }
        Deposit::SaltDust => Benefits::new(),
    })
}
fn threatens(kind: Deposit, s: &impl State, p: &Place) -> io::Result<Vec<Hazard>> {
    let (name, reach, severity) = match kind {
        Deposit::ThermalVein => (
            "steam and gas burst",
            measure(&s.field()?.scale, 0.0005, 1, 1.0)?,
            strength(s, p)?,
        ),
        Deposit::Placer => (
            "flash flood in the working channel",
            ground::length(s, p)? / 2.0,
            flow_size(s, p)?,
        ),
        _ => {
            let (name, fraction) = match kind {
                Deposit::SaltPan => ("salt storm and thirst", 0.0075),
                Deposit::SaltDust => ("salt blight on fields and wells", 0.005),
                _ => ("foul water and failed crops", 0.00125),
            };
            (
                name,
                measure(&s.field()?.scale, fraction, 1, 1.0)?,
                (ground::salting(s, p.anchor)? + kind.magnitude(s, p)? / 2.0).min(1.0),
            )
        }
    };
    Ok(vec![Hazard {
        hazard: name.into(),
        reach,
        severity,
    }])
}
fn pan_fate(s: &impl State, cell: usize) -> io::Result<Fate> {
    let fused = ground::reservoir_per_area(s, "salt", "bed", cell)?;
    let glass = reads::magic_field(s, "salt")
        .map_or(f64::INFINITY, |f| f.definition().parameters.glass_bed);
    Ok(if fused >= glass {
        Fate::Becomes(Kind::GlassFlat)
    } else if ground::moisture(s, cell)? <= 0.5 {
        Fate::Persists
    } else if ground::spill_depth(s, cell)? > 0.0 {
        Fate::Becomes(Kind::Lake)
    } else {
        Fate::Ends { leaves: None }
    })
}
fn fate(kind: Deposit, s: &impl State, p: &Place) -> io::Result<Fate> {
    let cell = p.anchor;
    Ok(match kind {
        Deposit::ThermalVein => {
            if ground::sealed(s, "fire", cell)? {
                Fate::Ends {
                    leaves: Some(Kind::BasaltFlat),
                }
            } else {
                Fate::Persists
            }
        }
        Deposit::Placer => {
            let burial = match reads::magic_field(s, "fire") {
                Some(f) => f.definition().parameters.bury_depth,
                None => measure(&s.field()?.scale, 0.000005, 1, 0.5)?,
            };
            if ground::sediment(s, cell)? >= burial || !reads::has_channel(s.field()?, cell)? {
                Fate::Ends { leaves: None }
            } else {
                Fate::Persists
            }
        }
        Deposit::SaltPan => pan_fate(s, cell)?,
        Deposit::SaltDust => {
            let dust = ground::reservoir_per_area(s, "salt", "dust", cell)?;
            let settling = reads::magic_field(s, "salt")
                .map_or(0.5, |f| f.definition().parameters.dust_settle);
            let floor = ground::rule_floor(s, "salt", "dust", "stock:death/dust").unwrap_or(10.0);
            if dust * (1.0 - settling) >= floor {
                Fate::Persists
            } else {
                Fate::Ends {
                    leaves: (ground::reservoir_per_area(s, "salt", "bed", cell)? >= floor)
                        .then_some(Kind::SaltPan),
                }
            }
        }
        Deposit::KillingGround => {
            let floor = ground::killing_floor(s);
            if dead(s, cell)? >= floor && ground::moisture(s, cell)? <= 0.6 {
                Fate::Persists
            } else if ground::reservoir_per_area(s, "salt", "bed", cell)? >= floor {
                Fate::Becomes(Kind::SaltPan)
            } else {
                Fate::Ends { leaves: None }
            }
        }
    })
}
fn visibility<S: GroundState + 'static>(kind: Deposit) -> Visibility<S> {
    Visibility { statement: Must::Value("Material, extent and local contrast combine with isolation and the people attached to the deposit.".into()), magnitude: Slot::Value(Rc::new(move |s, p| kind.magnitude(s, p))), local_conditions: Slot::Value(Rc::new(move |s, p| kind.local(s, p))), isolation: Slot::Value(Rc::new(move |s, p| kind.isolation(s, p))), cultural: Slot::Value(Rc::new(move |s, p| kind.cultural(s, p))), importance: Must::Value(Rc::new(move |s, p| {
        let [m, l, i] = kind.weights(); Ok(((m * kind.magnitude(s, p)? + l * kind.local(s, p)? + i * kind.isolation(s, p)?) / (m + l + i)).max(kind.cultural(s, p)?))
    })) }
}
fn naming<S: State + 'static>(kind: Deposit) -> Naming<S> {
    let takes = match kind {
        Deposit::SaltPan => Slot::Value(vec![NameRelation {
            relation: near(Kind::Lake, 1.0),
            chance: None,
        }]),
        Deposit::SaltDust => Slot::Value(vec![NameRelation {
            relation: near(Kind::SaltPan, 3.0),
            chance: None,
        }]),
        Deposit::KillingGround => {
            let mut relations = cover_shared::holds(&[Kind::Battlefield, Kind::DisasterSite]);
            relations.push(near(Kind::Settlement, 1.0));
            Slot::Value(
                relations
                    .into_iter()
                    .map(|relation| NameRelation {
                        relation,
                        chance: None,
                    })
                    .collect(),
            )
        }
        _ => Slot::NotApplicable("The deposit is named for itself."),
    };
    let lends = match kind {
        Deposit::ThermalVein => Slot::Value(vec![
            Relation {
                kind: Kind::Mine,
                holds: Rc::new(|s: &S, a: &Place, b: &Place| {
                    places::within(s, a, b, s.field()?.scale.cells(1.0))
                }) as RelationRule<S>,
            },
            Relation {
                kind: Kind::Settlement,
                holds: Rc::new(|s, a, b| places::within(s, a, b, vein_reach(s)?)),
            },
        ]),
        Deposit::Placer => Slot::Value(vec![near(Kind::Settlement, 1.0), near(Kind::Mine, 1.0)]),
        Deposit::SaltPan => {
            let mut relations = cover_shared::holds(&[Kind::Mine]);
            relations.push(near(Kind::Settlement, 1.0));
            Slot::Value(relations)
        }
        Deposit::KillingGround => Slot::Value(vec![near(Kind::Shrine, 1.0)]),
        Deposit::SaltDust => Slot::NotApplicable("A passing plume does not lend names."),
    };
    Naming { statement: Must::Value("Nearby workers and people name deposits, using the lake, event or source they remember where applicable.".into()), named_by: Slot::Value(Rc::new(move |s, p| {
        if kind == Deposit::SaltDust && !places::settlement_within(s, p.anchor, 3.0 * ground::around(s)?)? { Ok(None) } else { places::naming_culture_near(s, p) }
    })), takes_name_from: takes, lends_name_to: lends, term: Slot::Unwritten }
}
pub fn entry<S: GroundState + CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: Deposit,
) -> Entry<S, Schedule> {
    let (id, system, rule, name) = kind.identity();
    Entry { id, group: Group::Ground, name: name.into(), recognition: Recognition { distinct: Must::Value(format!("The {system}:{rule} rule defines the material place; bars, pans and killing grounds also have natural forms read from river slackening, closed arid basins and recorded deaths respectively.")), is_a: Must::Value(Rc::new(move |s, c| kind.is_a(s, c))), landform: Slot::Unwritten },
        existence: Existence { statement: Must::Value("Rivers, closed basins, conduit propagation and material stocks establish the deposit without a siting process.".into()), origins: Slot::Unwritten, way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Recognition reads the material and physical prerequisites."), suitability: Slot::NotApplicable("No process chooses a deposit's site."), places: Must::Value(Rc::new(move |s| kind.found(s))) },
        publication: Publication { delivery: Delivery::Landforms, statement: Must::Value("Magic forms publish through their owning class; natural pans publish outlines and natural bars or dead ground publish sites.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(move |s: &S, p: &Place| record(kind, s, p))) }, across_maps: across(kind), event: None,
        roles: Roles { true_size: if kind == Deposit::Placer { super::true_sizes::sited(&super::true_sizes::PLACER) } else { super::true_sizes::extent() }, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(id), fields: fields(kind), movement: movement(kind), others: others(kind), people: People { statement: Must::Value("Deposits provide their particular material, power or memory and expose people to their own hazards.".into()), offers: if kind == Deposit::SaltDust { Slot::NotApplicable("Thin dust cannot be gathered; people work its source bed.") } else { Slot::Value(Rc::new(move |s, p| offers(kind, s, p))) }, threatens: Slot::Value(Rc::new(move |s, p| threatens(kind, s, p))) }, time: ThroughTime { statement: Must::Value("Conduits seal, rivers move or bury bars, and salt moves among brine, bed and dust through its owner's material processes.".into()), fate: Slot::Value(Rc::new(move |s, p| fate(kind, s, p))) }, visibility: visibility(kind), naming: naming(kind) },
    }
}
