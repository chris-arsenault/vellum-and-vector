use super::{
    anomaly_reads as anomaly, carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    places, reads, records,
    state::State,
    values::*,
    visibility,
};
use crate::{
    field::{shared::Scalar, significance::measure},
    magic::channels::Channel,
};
use std::{io, rc::Rc};
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SourcePlace {
    FireCore,
    Tear,
}
impl SourcePlace {
    pub const ALL: [Self; 2] = [Self::FireCore, Self::Tear];
    fn identity(self) -> (Kind, &'static str, &'static str, &'static str) {
        match self {
            Self::FireCore => (Kind::FireCore, "fire", "core", "Fire core"),
            Self::Tear => (Kind::Tear, "veil", "tear", "Tear"),
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
            if self == Self::FireCore {
                0.0075
            } else {
                0.001
            },
        )
    }
    fn read(self, s: &impl State, c: usize) -> io::Result<f64> {
        if self == Self::FireCore {
            anomaly::intensity(s, "fire", c)
        } else {
            cover_shared::scalar(s, Scalar::Tearing, c)
        }
    }
    fn magnitude(self, s: &impl State, p: &Place) -> io::Result<f64> {
        let value = anomaly::peak(p, |c| {
            if self == Self::FireCore {
                reads::magic_value(s, "fire", Channel::Source, c)
            } else {
                self.read(s, c)
            }
        })?;
        Ok(visibility::sized(
            value,
            if self == Self::FireCore { 500.0 } else { 0.5 },
        ))
    }
    fn local(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::stands_out(s, p, self.around(s)?, |c| self.read(s, c))
    }
    fn isolation(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::alone_among(s, p, &self.found(s)?, 2.0 * self.around(s)?)
    }
    fn cultural(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::attachment(s, p, self.around(s)?)
    }
}
fn costs(s: &impl State, p: &Place, weight: f64) -> io::Result<Vec<Cost>> {
    p.cells
        .iter()
        .map(|&cell| {
            Ok(Cost {
                cell,
                factor: 1.0 + weight * cover_shared::scalar(s, Scalar::Tearing, cell)?,
            })
        })
        .collect()
}
fn movement<S: State + 'static>(kind: SourcePlace) -> Movement<S> {
    let mut movement: Movement<S> = cover_shared::movement("Fire's hot ground costs a road; torn ground makes routes unreliable and carriers lose their way.");
    movement.roads = Slot::Value(Rc::new(move |s, p| {
        if kind == SourcePlace::FireCore {
            carry_rules::cost_near(s, p, 1.5, measure(&s.field()?.scale, 0.00125, 1, 1.0)?)
        } else {
            costs(s, p, 2.0)
        }
    }));
    if kind == SourcePlace::Tear {
        movement.boats = Slot::Value(Rc::new(|s, p| costs(s, p, 2.0)));
        movement.drainage = Slot::Value(Rc::new(|s, p| {
            p.cells
                .iter()
                .map(|&cell| {
                    Ok(Cost {
                        cell,
                        factor: 1.0 + reads::magic_value(s, "veil", Channel::Wild, cell)?,
                    })
                })
                .collect()
        }));
        movement.magic = Slot::Value(
            [
                Carrier::Crust,
                Carrier::River,
                Carrier::Wind,
                Carrier::Ice,
                Carrier::People,
            ]
            .into_iter()
            .map(|carrier| {
                (
                    carrier,
                    Rc::new(|s: &S, p: &Place| costs(s, p, 1.0)) as OnPlace<S, Vec<Cost>>,
                )
            })
            .collect(),
        );
    } else {
        movement.boats = Slot::NotApplicable("A core in rock adds no boat cost.");
        movement.drainage = Slot::NotApplicable("Water reads the heated rock's resistance.");
        movement.magic = Slot::NotApplicable("Fire propagation reads crust conductance itself.");
    }
    movement
}
fn near<S: State + 'static>(source: SourcePlace, kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |s, a, b| places::within(s, a, b, source.around(s)?)),
    }
}
fn inside<S: State + 'static>(kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(|_, a, b| Ok(b.cells.contains(&a.anchor))),
    }
}
fn others<S: State + 'static>(kind: SourcePlace) -> Others<S> {
    Others { statement: Must::Value("Fire feeds conduits and works while breaking doors and wards; a tear holds doors and can fray into wild ground, held open by salt.".into()), needs: Slot::NotApplicable("The source or fields supply their own prerequisites."),
        excludes: if kind == SourcePlace::FireCore { Slot::Value(vec![inside(Kind::Door), inside(Kind::WardRing), inside(Kind::WardLine)]) } else { Slot::NotApplicable("A wild share and door can both stand on a tear.") },
        contains: if kind == SourcePlace::Tear { Slot::Value(cover_shared::holds(&[Kind::Door])) } else { Slot::NotApplicable("A core is a source point.") },
        pairs_with: Slot::Value(if kind == SourcePlace::FireCore { [Kind::ThermalVein, Kind::Crater, Kind::Vent, Kind::Forge, Kind::Mine].into_iter().map(|k| near(kind, k)).collect() } else { vec![near(kind, Kind::WildZone), inside(Kind::SaltPan)] }),
    }
}
fn counterpart<S: CatalogueState<Schedule>, Schedule>(
    kind: SourcePlace,
    s: &S,
    c: &Carried,
) -> io::Result<Option<usize>> {
    carry_rules::counterpart(s, c, s.parent_cell_span(), 1.0, |cell| kind.is_a(s, cell))
}
fn across<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: SourcePlace,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value("Captured Fire sources stand while refined fields derive current strain. A name follows the nearest rule cell or goes when the finer field has none.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::NotApplicable("Current owner evaluation supplies source or strain without place-shaped ground."), counterpart: Slot::Value(Rc::new(move |s, c| counterpart(kind, s, c))), unrealized: Slot::Value(Rc::new(move |s, c| Ok(counterpart(kind, s, c)?.map_or(Unrealized::Drop, Unrealized::Move)))), settle: if kind == SourcePlace::Tear { Slot::Value(Rc::new(move |s, c| Ok(carry_rules::moves_to(counterpart(kind, s, c)?)))) } else { Slot::NotApplicable("A water round moves no Fire source.") }, schedule: Slot::NotApplicable("The owning system refreshes the field.") }
}
fn fate(kind: SourcePlace, s: &impl State, p: &Place) -> io::Result<Fate> {
    Ok(if kind == SourcePlace::FireCore {
        if reads::magic_value(s, "fire", Channel::Sealed, p.anchor)? > 0.0 {
            Fate::Ends {
                leaves: Some(Kind::Placer),
            }
        } else {
            Fate::Persists
        }
    } else if cover_shared::scalar(s, Scalar::Verdure, p.anchor)? >= 0.5 {
        Fate::Ends { leaves: None }
    } else if reads::magic_value(s, "veil", Channel::Wild, p.anchor)? >= 0.15 {
        Fate::Becomes(Kind::WildZone)
    } else {
        Fate::Persists
    })
}
fn naming<S: State + 'static>(kind: SourcePlace) -> Naming<S> {
    Naming { statement: Must::Value("Nearest people name the source after its crater, town or ruin, and dependent works or doors can inherit it.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(if kind == SourcePlace::FireCore { vec![NameRelation { relation: near(kind, Kind::Crater), chance: None }] } else { [Kind::Settlement, Kind::Ruin].into_iter().map(|k| NameRelation { relation: near(kind, k), chance: None }).collect() }), lends_name_to: Slot::Value(if kind == SourcePlace::FireCore { vec![near(kind, Kind::Forge), near(kind, Kind::Mine)] } else { cover_shared::holds(&[Kind::Door]) }), term: Slot::Unwritten }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    kind: SourcePlace,
) -> Entry<S, Schedule> {
    let (id, system, rule, name) = kind.identity();
    Entry { id, group: Group::Anomalies, name: name.into(), recognition: Recognition { distinct: Must::Value("The owning rule identifies a strong located Fire source or current Veil strain, independently of its conduit, wild share or paired door.".into()), is_a: Must::Value(Rc::new(move |s, c| kind.is_a(s, c))), landform: Slot::Unwritten },
        existence: Existence { statement: Must::Value("Heat maxima, impacts and forges establish cores; competing fields and their meetings establish tears.".into()), origins: Slot::Unwritten, way: Must::Value(ExistenceWay::Emerges), requires: Slot::Value(Rc::new(move |s, c| Ok(if kind == SourcePlace::FireCore { reads::magic_value(s, "fire", Channel::Source, c)? } else { anomaly::origin_source(s, "veil", "tear", c)? } > 0.0))), suitability: Slot::NotApplicable("The source and fields determine location."), places: Must::Value(Rc::new(move |s| kind.found(s))) },
        publication: Publication { statement: Must::Value("Publish the source site or strain coverage through the owning class.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(move |s: &S, p: &Place| records::rule(s, p, system, rule))) }, across_maps: across(kind), event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten, fields: cover_shared::fields("Fire's thermal, living and rock feedback and Veil's current strain and moved share own their effects; the place duplicates none."), movement: movement(kind), others: others(kind),
            people: People { statement: Must::Value("Cores supply dangerous heat and ore; tears draw keepers but forcing a crossing threatens travellers.".into()), offers: Slot::Value(Rc::new(move |s, p| Ok(if kind == SourcePlace::FireCore { let v = kind.magnitude(s, p)?; [(Benefit::Power, v), (Benefit::Materials, v)].into_iter().collect() } else { [(Benefit::Sanctity, anomaly::peak(p, |c| kind.read(s, c))? / 2.0)].into_iter().collect() }))), threatens: Slot::Value(Rc::new(move |s, p| Ok(vec![Hazard { hazard: if kind == SourcePlace::FireCore { "burning ground" } else { "forced crossing and shifting ground" }.into(), reach: measure(&s.field()?.scale, if kind == SourcePlace::FireCore { 0.00125 } else { 0.0005 }, 1, 1.0)?, severity: anomaly::peak(p, |c| kind.read(s, c))? / if kind == SourcePlace::FireCore { 1000.0 } else { 1.0 } }]))) },
            time: ThroughTime { statement: Must::Value("Sealed cores leave ore for placers; living ground knits tears and shifting strain makes wild ground.".into()), fate: Slot::Value(Rc::new(move |s, p| fate(kind, s, p))) },
            visibility: Visibility { statement: Must::Value("Source or tearing strength combines with contrast and isolation; dependent towns can carry a lesser mark.".into()), magnitude: Slot::Value(Rc::new(move |s, p| kind.magnitude(s, p))), local_conditions: Slot::Value(Rc::new(move |s, p| kind.local(s, p))), isolation: Slot::Value(Rc::new(move |s, p| kind.isolation(s, p))), cultural: Slot::Value(Rc::new(move |s, p| kind.cultural(s, p))), importance: Must::Value(Rc::new(move |s, p| Ok((0.45 * kind.magnitude(s, p)? + 0.35 * kind.local(s, p)? + 0.2 * kind.isolation(s, p)?).max(kind.cultural(s, p)?)))) }, naming: naming(kind),
        },
    }
}
