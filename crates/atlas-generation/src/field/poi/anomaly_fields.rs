//! Aurora stores charge, fallen metal bends bearings, and Pressure crosses in patterned rays.
use super::{
    anomaly_reads as anomaly, carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads, records, sea_shared,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{
        shared::{CellCode, Scalar},
        significance::measure,
    },
    magic::channels::Channel,
};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Anomaly {
    AuroraField,
    LightWell,
    CompassDeviation,
    InterferenceLattice,
}
impl Anomaly {
    pub const ALL: [Self; 4] = [
        Self::AuroraField,
        Self::LightWell,
        Self::CompassDeviation,
        Self::InterferenceLattice,
    ];
    fn identity(self) -> (Kind, &'static str, &'static str, &'static str) {
        match self {
            Self::AuroraField => (Kind::AuroraField, "aurora", "field", "Aurora field"),
            Self::LightWell => (Kind::LightWell, "aurora", "well", "Light well"),
            Self::CompassDeviation => (
                Kind::CompassDeviation,
                "fire",
                "deviation",
                "Compass deviation",
            ),
            Self::InterferenceLattice => (
                Kind::InterferenceLattice,
                "pressure",
                "lattice",
                "Interference lattice",
            ),
        }
    }
    fn is_a(self, s: &impl State, c: usize) -> io::Result<bool> {
        let (_, system, rule, _) = self.identity();
        reads::magic_rule(s, system, rule, c)
    }
    fn found(self, s: &impl State) -> io::Result<Vec<Place>> {
        let (kind, system, rule, _) = self.identity();
        Ok(places::rule_places(s, kind, system, rule)?.as_ref().clone())
    }
    fn around(self, s: &impl State) -> io::Result<f64> {
        anomaly::country(
            s,
            match self {
                Self::LightWell => 0.00125,
                Self::InterferenceLattice => 0.01,
                _ => 0.0075,
            },
        )
    }
    fn read(self, s: &impl State, c: usize) -> io::Result<f64> {
        if self == Self::CompassDeviation {
            anomaly::stock_reading(s, "fire", "fallen/held", c)
        } else {
            anomaly::intensity(s, self.identity().1, c)
        }
    }
    fn magnitude(self, s: &impl State, p: &Place) -> io::Result<f64> {
        let scale = &s.field()?.scale;
        Ok(match self {
            Self::AuroraField => visibility::sized(
                anomaly::weighted_area(s, p, |c| Ok(self.read(s, c)? / 1000.0))?,
                measure(scale, 0.000625, 2, 1.0)?,
            ),
            Self::LightWell => {
                (visibility::sized(ice(s, p.anchor)?, measure(scale, 0.000125, 1, 0.5)?)
                    + cover_shared::scalar(s, Scalar::IceCharge, p.anchor)?)
                    / 2.0
            }
            Self::CompassDeviation => {
                visibility::sized(anomaly::peak(p, |c| self.read(s, c))?, 1000.0)
            }
            Self::InterferenceLattice => visibility::sized(
                anomaly::weighted_area(s, p, |_| Ok(1.0))?,
                measure(scale, 0.00125, 2, 1.0)?,
            ),
        })
    }
    fn local(self, s: &impl State, p: &Place) -> io::Result<f64> {
        let outstanding = visibility::stands_out(
            s,
            p,
            self.around(s)? * if self == Self::LightWell { 2.0 } else { 1.0 },
            |c| self.read(s, c),
        )?;
        Ok(
            if self == Self::CompassDeviation && s.field()?.water().column.kind.get(p.anchor)? == 1
            {
                outstanding.max(0.75)
            } else {
                outstanding
            },
        )
    }
    fn isolation(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::alone_among(
            s,
            p,
            &self.found(s)?,
            self.around(s)? * if self == Self::LightWell { 4.0 } else { 2.0 },
        )
    }
    fn cultural(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::attachment(
            s,
            p,
            self.around(s)?
                * if matches!(self, Self::LightWell | Self::InterferenceLattice) {
                    2.0
                } else {
                    1.0
                },
        )
    }
    fn weights(self) -> [f64; 3] {
        match self {
            Self::AuroraField => [0.55, 0.3, 0.15],
            Self::CompassDeviation => [0.4, 0.4, 0.2],
            _ => [0.5, 0.3, 0.2],
        }
    }
}
fn ice(s: &impl State, c: usize) -> io::Result<f64> {
    cover_shared::scalar(s, Scalar::IceThickness, c)
}
fn requires(kind: Anomaly, s: &impl State, c: usize) -> io::Result<bool> {
    match kind {
        Anomaly::AuroraField => Ok(ice(s, c)? > 0.0),
        Anomaly::LightWell => Ok(matches!(
            s.field()?.shared.code(CellCode::LandformCodes).get(c)?,
            3 | 4 | 10
        )),
        _ => Ok(kind.read(s, c)? > 0.0),
    }
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    kind: Anomaly,
    s: &S,
    c: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(
        s,
        c,
        s.parent_cell_span(),
        if kind == Anomaly::AuroraField {
            2.0
        } else {
            1.0
        },
        |cell| kind.is_a(s, cell),
    )
}
fn across<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: Anomaly,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Inherited charge, stock or copied rays grow the finer rule. Names follow its nearest cell; without a counterpart the carried place goes.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::NotApplicable("Owner feedback and inherited material supply the place; this entry invents no additional stock or relief."), counterpart: Slot::Value(Rc::new(move |s, c| counterpart(kind, s, c))), unrealized: Slot::Value(Rc::new(move |s, c| Ok(counterpart(kind, s, c)?.map_or(Unrealized::Drop, Unrealized::Move)))),
        settle: match kind { Anomaly::AuroraField | Anomaly::LightWell => Slot::Value(Rc::new(move |s, c| Ok(carry_rules::moves_to(counterpart(kind, s, c)?)))), Anomaly::InterferenceLattice => Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep))), Anomaly::CompassDeviation => Slot::NotApplicable("A regional water round moves no fallen stock.") }, schedule: Slot::NotApplicable("The owning fields supply refinement without a place step.") }
}
fn costs(kind: Anomaly, s: &impl State, p: &Place, boats: bool) -> io::Result<Vec<Cost>> {
    if kind == Anomaly::CompassDeviation {
        let mut costs = carry_rules::cost_near(
            s,
            p,
            1.0 + if boats { 2.0 } else { 0.25 } * kind.magnitude(s, p)?,
            measure(&s.field()?.scale, 0.0025, 1, 1.0)?,
        )?;
        if boats {
            let water = s.field()?.water().column.kind;
            let mut selected = Vec::new();
            for cost in costs {
                if water.get(cost.cell)? == 1 {
                    selected.push(cost);
                }
            }
            costs = selected;
        }
        return Ok(costs);
    }
    if kind == Anomaly::LightWell && !boats {
        return carry_rules::cost_near(s, p, 1.5, 0.0);
    }
    let mut costs = Vec::new();
    for &cell in &p.cells {
        if kind == Anomaly::LightWell && ice(s, cell)? <= 0.0 {
            continue;
        }
        let factor = match kind {
            Anomaly::AuroraField if !boats => 1.0 + 0.5 * anomaly::held_charge(s, cell)?,
            Anomaly::InterferenceLattice => 1.0 + 2.0 * kind.read(s, cell)? / 1000.0,
            _ => f64::INFINITY,
        };
        costs.push(Cost { cell, factor });
    }
    Ok(costs)
}
fn crossing(s: &impl State, p: &Place) -> io::Result<Vec<Barrier>> {
    let mut sea = false;
    let mut river = false;
    for &cell in &p.cells {
        if anomaly::held_charge(s, cell)? > 0.0 {
            sea |= s.field()?.water().column.kind.get(cell)? == 1;
            river |= reads::has_channel(s.field()?, cell)?;
        }
    }
    let mut barriers = Vec::new();
    if sea {
        barriers.push(Barrier::Strait);
    }
    if river {
        barriers.push(Barrier::River);
    }
    Ok(barriers)
}
fn movement<S: State + 'static>(kind: Anomaly) -> Movement<S> {
    let mut movement: Movement<S> = cover_shared::movement("Charged ice, false bearings and standing swell change passage through their distinct mechanisms.");
    movement.roads = if kind == Anomaly::InterferenceLattice {
        Slot::NotApplicable("Rays lie only in connected ocean.")
    } else {
        Slot::Value(Rc::new(move |s, p| costs(kind, s, p, false)))
    };
    movement.boats = Slot::Value(Rc::new(move |s, p| costs(kind, s, p, true)));
    movement.drainage = if matches!(kind, Anomaly::AuroraField | Anomaly::LightWell) {
        Slot::Value(Rc::new(move |s, p| {
            p.cells
                .iter()
                .map(|&cell| {
                    Ok(Cost {
                        cell,
                        factor: if kind == Anomaly::AuroraField {
                            1.0 + anomaly::held_charge(s, cell)?
                        } else {
                            1.0 - 0.3 * kind.read(s, cell)? / 1000.0
                        },
                    })
                })
                .collect()
        }))
    } else {
        Slot::NotApplicable("Buried metal and sea patterns do not redirect drainage.")
    };
    movement.magic = if kind == Anomaly::CompassDeviation {
        Slot::NotApplicable("The metal changes neither its crust nor river carrier's cost.")
    } else {
        let carrier = match kind {
            Anomaly::AuroraField => Carrier::Ice,
            Anomaly::LightWell => Carrier::Wind,
            _ => Carrier::Current,
        };
        let cost: OnPlace<S, Vec<Cost>> = Rc::new(move |s, p| match kind {
            Anomaly::AuroraField => carry_rules::cost_near(s, p, 0.7, 0.0),
            Anomaly::LightWell => carry_rules::cost_near(s, p, 0.5, kind.around(s)?),
            _ => carry_rules::cost_near(s, p, 1.25, 0.0),
        });
        Slot::Value([(carrier, cost)].into_iter().collect())
    };
    movement.crosses = if kind == Anomaly::AuroraField {
        Slot::Value(Rc::new(crossing))
    } else {
        Slot::NotApplicable("The place opens no barrier crossing.")
    };
    movement
}
fn near<S: State + 'static>(anomaly: Anomaly, kind: Kind, factor: f64) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |s, a, b| places::within(s, a, b, factor * anomaly.around(s)?)),
    }
}
fn inside<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
    }
}
fn others<S: State + 'static>(kind: Anomaly) -> Others<S> {
    let mut others: Others<S> = Others {
        statement: Must::Value(
            "Each anomaly relates to its own sources, held places and human readers.".into(),
        ),
        needs: Slot::NotApplicable(
            "Recognition reads its physical prerequisites or captured source.",
        ),
        excludes: Slot::NotApplicable("Pressure classes can overlap by their shares."),
        contains: Slot::NotApplicable("The gathered site or sea pattern holds no other place."),
        pairs_with: Slot::Unwritten,
    };
    others.pairs_with = Slot::Value(match kind {
        Anomaly::AuroraField => {
            others.excludes = Slot::Value(cover_shared::holds(&[Kind::Door]));
            others.contains =
                Slot::Value(cover_shared::holds(&[Kind::LightWell, Kind::FrostPrism]));
            vec![
                near(kind, Kind::MeltLine, 2.0),
                near(kind, Kind::Archive, 1.0),
            ]
        }
        Anomaly::LightWell => {
            others.excludes = Slot::Value(cover_shared::holds(&[Kind::Door]));
            vec![
                inside(Kind::AuroraField),
                inside(Kind::Cirque),
                near(kind, Kind::Archive, 2.0),
                near(kind, Kind::Shrine, 1.0),
            ]
        }
        Anomaly::CompassDeviation => {
            others.excludes = Slot::Value(vec![Relation {
                kind: Kind::Door,
                holds: Rc::new(|s, a, b| {
                    Ok(a.cells.contains(&b.anchor)
                        && reads::magic_value(s, "fire", Channel::Source, b.anchor)? > 0.0)
                }),
            }]);
            others.contains = Slot::Value(cover_shared::holds(&[Kind::Crater, Kind::Placer]));
            vec![
                near(kind, Kind::EjectaFan, 1.0),
                near(kind, Kind::Mine, 1.0),
            ]
        }
        Anomaly::InterferenceLattice => vec![
            Relation {
                kind: Kind::PressureLocus,
                holds: Rc::new(|s, a, b| {
                    places::within(
                        s,
                        a,
                        b,
                        sea_shared::pressure_length(
                            s,
                            sea_shared::PressureLength::RayDistance,
                            0.5,
                        )?,
                    )
                }),
            },
            near(kind, Kind::CrushZone, 1.0),
            near(kind, Kind::UpwellingFront, 1.0),
            near(kind, Kind::RogueWaveImpact, 1.0),
        ],
    });
    others
}
fn offers(kind: Anomaly, s: &impl State, p: &Place) -> io::Result<Benefits> {
    let strength = kind.magnitude(s, p)?;
    Ok(match kind {
        Anomaly::AuroraField => [
            (Benefit::Sanctity, strength),
            (Benefit::Materials, strength / 2.0),
            (Benefit::Water, strength / 4.0),
        ]
        .into_iter()
        .collect(),
        Anomaly::LightWell => [
            (Benefit::Sanctity, strength.max(0.5)),
            (Benefit::Materials, strength),
        ]
        .into_iter()
        .collect(),
        Anomaly::CompassDeviation => [
            (Benefit::Materials, strength),
            (Benefit::Defence, strength / 4.0),
        ]
        .into_iter()
        .collect(),
        Anomaly::InterferenceLattice => [
            (
                Benefit::Food,
                anomaly::peak(p, |c| {
                    Ok(cover_shared::scalar(s, Scalar::Upwelling, c)? / 1000.0)
                })?,
            ),
            (Benefit::Sanctity, strength / 4.0),
        ]
        .into_iter()
        .collect(),
    })
}
fn threatens(kind: Anomaly, s: &impl State, p: &Place) -> io::Result<Vec<Hazard>> {
    let (hazard, severity) = match kind {
        Anomaly::AuroraField => (
            "stilled growth and cold shadow",
            anomaly::held_charge(s, p.anchor)?,
        ),
        Anomaly::LightWell => (
            "cold pool and stilled air",
            anomaly::held_charge(s, p.anchor)?,
        ),
        Anomaly::CompassDeviation => ("false bearing", kind.magnitude(s, p)?),
        Anomaly::InterferenceLattice => (
            "confused sea",
            (2.0 * anomaly::peak(p, |c| kind.read(s, c))? / 1000.0).min(1.0),
        ),
    };
    Ok(vec![Hazard {
        hazard: hazard.into(),
        severity,
        reach: if kind == Anomaly::LightWell {
            kind.around(s)?
        } else {
            measure(&s.field()?.scale, 0.0025, 1, 1.0)?
        },
    }])
}
fn fate(kind: Anomaly, s: &impl State, p: &Place) -> io::Result<Fate> {
    let end = match kind {
        Anomaly::AuroraField => {
            let mut melting = 0;
            for &cell in &p.cells {
                if reads::magic_rule(s, "aurora", "melt", cell)? {
                    melting += 1;
                }
            }
            melting as f64 / p.cells.len() as f64 >= 0.5
        }
        Anomaly::LightWell => anomaly::held_charge(s, p.anchor)? <= 0.0,
        Anomaly::CompassDeviation => {
            let mut held = 0.0;
            let mut drawn = 0.0;
            if let Some(fire) = reads::magic_field(s, "fire") {
                let field = s.field()?;
                let ground = field.ground();
                for &cell in &p.cells {
                    held += fire.stock_amount(&ground, "fallen/held", cell)?;
                    drawn += fire.drawn().get(cell)?;
                }
            }
            return Ok(if drawn > 0.0 && drawn >= held {
                Fate::Ends {
                    leaves: Some(Kind::Mine),
                }
            } else {
                Fate::Persists
            });
        }
        Anomaly::InterferenceLattice => false,
    };
    Ok(if end {
        Fate::Ends {
            leaves: Some(Kind::MeltLine),
        }
    } else {
        Fate::Persists
    })
}
fn visible<S: State + 'static>(kind: Anomaly) -> Visibility<S> {
    Visibility { statement: Must::Value("Charged area, concentration, exposed stock or ray extent combines with contrast and isolation, and nearby people can carry a lesser mark.".into()), magnitude: Slot::Value(Rc::new(move |s, p| kind.magnitude(s, p))), local_conditions: Slot::Value(Rc::new(move |s, p| kind.local(s, p))), isolation: Slot::Value(Rc::new(move |s, p| kind.isolation(s, p))), cultural: Slot::Value(Rc::new(move |s, p| kind.cultural(s, p))), importance: Must::Value(Rc::new(move |s, p| { let [m, l, i] = kind.weights(); Ok(((m * kind.magnitude(s, p)? + l * kind.local(s, p)? + i * kind.isolation(s, p)?) / (m + l + i)).max(kind.cultural(s, p)?)) })) }
}
fn naming<S: State + 'static>(kind: Anomaly) -> Naming<S> {
    let takes = match kind {
        Anomaly::AuroraField => cover_shared::holds(&[Kind::Peak]),
        Anomaly::LightWell => vec![inside(Kind::Cirque)],
        Anomaly::CompassDeviation => cover_shared::holds(&[Kind::Crater]),
        Anomaly::InterferenceLattice => vec![near(kind, Kind::Headland, 1.0)],
    };
    Naming { statement: Must::Value("Nearby readers, miners or pilots use the containing peak, cirque, crater or coast name; dependent works can inherit it.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(takes.into_iter().map(|relation| NameRelation { relation, chance: None }).collect()), lends_name_to: match kind {
        Anomaly::AuroraField => Slot::Value(vec![near(kind, Kind::Archive, 1.0)]), Anomaly::LightWell => Slot::Value(vec![near(kind, Kind::Archive, 2.0), near(kind, Kind::Shrine, 1.0)]), Anomaly::CompassDeviation => Slot::Value(vec![near(kind, Kind::Mine, 1.0)]), Anomaly::InterferenceLattice => Slot::NotApplicable("Nothing built stands on a swell pattern."),
    }, term: Slot::Unwritten }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: Anomaly,
) -> Entry<S, Schedule> {
    let (id, system, rule, name) = kind.identity();
    Entry { id, group: Group::Anomalies, name: name.into(), recognition: Recognition { distinct: Must::Value(format!("The {system}:{rule} rule identifies the specific charge store, exposed metal deposit or crossing-ray pattern.")), is_a: Must::Value(Rc::new(move |s, c| kind.is_a(s, c))), landform: Slot::Unwritten },
        existence: Existence { statement: Must::Value("The owning system establishes the place through cold drainage, fallen material or ray propagation.".into()), origins: Slot::Unwritten, way: Must::Value(ExistenceWay::Emerges), requires: Slot::Value(Rc::new(move |s, c| requires(kind, s, c))), suitability: Slot::NotApplicable("The field and its medium determine the place."), places: Must::Value(Rc::new(move |s| kind.found(s))) },
        publication: Publication { statement: Must::Value("Publish the owning class through its coverage or strongest site.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(move |s: &S, p: &Place| records::rule(s, p, system, rule))) }, across_maps: across(kind), event: None,
        roles: Roles { true_size: match kind { Anomaly::CompassDeviation => Slot::NotApplicable("A needle's swing over country has no body to measure; its coverage is drawn."), Anomaly::InterferenceLattice => Slot::NotApplicable("Crossing rays in the sea have no body to measure; their coverage is drawn."), _ => super::true_sizes::extent() }, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: super::true_sizes::account(id), fields: cover_shared::fields("The owning system's rock, thermal, living and ocean feedback act by intensity or held material, without a duplicate place write."), movement: movement(kind), others: others(kind), people: People { statement: Must::Value("The place supplies its own charge, crystals, prospecting signal or shoal fish, alongside its distinct cold, navigation or swell hazard.".into()), offers: Slot::Value(Rc::new(move |s, p| offers(kind, s, p))), threatens: Slot::Value(Rc::new(move |s, p| threatens(kind, s, p))) }, time: ThroughTime { statement: Must::Value("Ice can melt, stored charge can cease acting, metal can be dug out and crossing rays renew with their basin.".into()), fate: Slot::Value(Rc::new(move |s, p| fate(kind, s, p))) }, visibility: visible(kind), naming: naming(kind) },
    }
}
