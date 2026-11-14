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
    human::HumanField,
    magic::{channels::Channel, hallowed::WARD_SEALS},
};
use std::{io, rc::Rc};
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Ward {
    Line,
    Ring,
}
impl Ward {
    pub const ALL: [Self; 2] = [Self::Line, Self::Ring];
    fn identity(self) -> (Kind, &'static str, &'static str) {
        match self {
            Self::Line => (Kind::WardLine, "line", "Ward line"),
            Self::Ring => (Kind::WardRing, "ring", "Sanctuary ring"),
        }
    }
    fn is_a(self, s: &impl State, c: usize) -> io::Result<bool> {
        reads::magic_rule(s, "hallowed", self.identity().1, c)
    }
    fn found(self, s: &impl State) -> io::Result<Vec<Place>> {
        let (kind, rule, _) = self.identity();
        Ok(places::rule_places(s, kind, "hallowed", rule)?
            .as_ref()
            .clone())
    }
    fn around(self, s: &impl State) -> io::Result<f64> {
        anomaly::country(s, if self == Self::Line { 0.0025 } else { 0.005 })
    }
    fn magnitude(self, s: &impl State, p: &Place) -> io::Result<f64> {
        let area = area(s, p)?;
        let scale = &s.field()?.scale;
        Ok(if self == Self::Line {
            visibility::sized(
                (area * p.cells.len() as f64).sqrt(),
                measure(scale, 0.0125, 1, 1.0)?,
            )
        } else {
            visibility::sized(
                area,
                measure(scale, std::f64::consts::PI * 0.005f64.powi(2), 2, 1.0)?,
            )
        })
    }
    fn local(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::stands_out(s, p, self.around(s)?, |c| {
            anomaly::intensity(s, "hallowed", c)
        })
    }
    fn isolation(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::alone_among(s, p, &self.found(s)?, 2.0 * self.around(s)?)
    }
    fn cultural(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::attachment(s, p, self.around(s)?)
    }
    fn source(self, s: &impl State, c: usize) -> io::Result<f64> {
        if self == Self::Line {
            anomaly::origin_source(s, "hallowed", "line", c)
        } else {
            reads::magic_value(s, "hallowed", Channel::Source, c)
        }
    }
}
fn area(s: &impl State, p: &Place) -> io::Result<f64> {
    anomaly::weighted_area(s, p, |_| Ok(1.0))
}
fn peak(s: &impl State, p: &Place) -> io::Result<f64> {
    Ok(anomaly::peak(p, |c| anomaly::intensity(s, "hallowed", c))? / 1000.0)
}
fn worn(s: &impl State, c: usize) -> io::Result<bool> {
    let Some(field) = reads::magic_field(s, "hallowed") else {
        return Ok(false);
    };
    Ok(s.field()?.people().view(HumanField::WalkedRoute).get(c)?
        / field.definition().parameters.road_full
        >= 0.1)
}
fn barred(s: &impl State, p: &Place) -> io::Result<Vec<Cost>> {
    let mut costs = Vec::new();
    for &cell in &p.cells {
        let warding = cover_shared::scalar(s, Scalar::Warding, cell)?;
        if warding > 0.0 {
            costs.push(Cost {
                cell,
                factor: if warding >= WARD_SEALS {
                    f64::INFINITY
                } else {
                    1.0 / (1.0 - warding)
                },
            });
        }
    }
    Ok(costs)
}
fn movement<S: State + 'static>(ward: Ward) -> Movement<S> {
    Movement { statement: Must::Value("A kept line costs a road at unworn crossings; sanctuary ground draws roads. River, wind and ice carriers lose the warded share and stop where it seals.".into()), roads: Slot::Value(Rc::new(move |s, p| {
        if ward == Ward::Ring { return carry_rules::cost_near(s, p, 0.8, 0.0); }
        let mut costs = Vec::new(); for &cell in &p.cells { if !worn(s, cell)? { costs.push(Cost { cell, factor: 2.0 }); } } Ok(costs)
    })), boats: Slot::NotApplicable("A ward bars no boat."), drainage: Slot::NotApplicable("Material resistance reads the ward where water cuts."),
        magic: Slot::Value([Carrier::River, Carrier::Wind, Carrier::Ice].into_iter().map(|carrier| (carrier, Rc::new(barred) as OnPlace<S, Vec<Cost>>)).collect()), links: Slot::NotApplicable("The ward joins nothing at a distance."),
        crosses: if ward == Ward::Line { Slot::Value(Rc::new(|s, p| { for &cell in &p.cells { if worn(s, cell)? { return Ok(vec![Barrier::Ward]); } } Ok(Vec::new()) })) } else { Slot::NotApplicable("A ring bars no walker.") },
    }
}
fn nearby<S: State + 'static>(ward: Ward, kind: Kind) -> Relation<S> {
    Relation {
        kind,
        holds: Rc::new(move |s, a, b| places::within(s, a, b, ward.around(s)?)),
    }
}
fn others<S: State + 'static>(ward: Ward) -> Others<S> {
    Others { statement: Must::Value("Wards close doors and conflict with open Fire; kept lines and settlements connect with shrines and safe ways.".into()), needs: Slot::NotApplicable("Kept ground and stored charge may outlast a seat."), excludes: Slot::Value(cover_shared::holds(&[Kind::Door, Kind::FireCore])), contains: if ward == Ward::Ring { Slot::Value(cover_shared::holds(&[Kind::Settlement, Kind::Shrine])) } else { Slot::NotApplicable("The line is too narrow to hold a place.") }, pairs_with: Slot::Value(if ward == Ward::Line { vec![nearby(ward, Kind::WardRing), nearby(ward, Kind::Shrine), nearby(ward, Kind::Ford)] } else { vec![nearby(ward, Kind::WardLine), nearby(ward, Kind::Shrine)] }) }
}
fn across<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    ward: Ward,
) -> AcrossMaps<S, Schedule> {
    AcrossMaps { statement: Must::Value(if ward == Ward::Ring { "A captured sanctuary retains identity. Current seats, maintained ways and retained charge determine warding; captured intensity supplies no floor." } else { "A captured kept line retains its source, ward and place through refinement." }.into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::NotApplicable("Shared Hallowed evaluation owns the ward on captured maintained ground and current material."), counterpart: Slot::Value(Rc::new(move |s, c| carry_rules::counterpart(s, c, s.parent_cell_span(), 1.0, |cell| ward.is_a(s, cell)))), unrealized: Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep))), settle: Slot::NotApplicable("A round's water moves no ward."), schedule: Slot::NotApplicable("Current warding refreshes alongside the other systems.") }
}
fn visible<S: State + 'static>(ward: Ward) -> Visibility<S> {
    Visibility { statement: Must::Value("Length or area, contrast and isolation establish the ward's mark; its town can carry a small one.".into()), magnitude: Slot::Value(Rc::new(move |s, p| ward.magnitude(s, p))), local_conditions: Slot::Value(Rc::new(move |s, p| ward.local(s, p))), isolation: Slot::Value(Rc::new(move |s, p| ward.isolation(s, p))), cultural: Slot::Value(Rc::new(move |s, p| ward.cultural(s, p))), importance: Must::Value(Rc::new(move |s, p| {
        let (m, l) = if ward == Ward::Line { (0.5, 0.3) } else { (0.4, 0.4) }; Ok((m * ward.magnitude(s, p)? + l * ward.local(s, p)? + 0.2 * ward.isolation(s, p)?).max(ward.cultural(s, p)?))
    })) }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    ward: Ward,
) -> Entry<S, Schedule> {
    let (id, rule, name) = ward.identity();
    Entry { id, group: Group::Anomalies, name: name.into(), recognition: Recognition { distinct: Must::Value("Hallowed's rule identifies a ward around a kept seat or a source-bearing maintained line.".into()), is_a: Must::Value(Rc::new(move |s, c| ward.is_a(s, c))), landform: Slot::Unwritten },
        existence: Existence { statement: Must::Value("Tenure, maintained works, frontiers and pilgrim ways establish warded ground.".into()), origins: Slot::Unwritten, way: Must::Value(ExistenceWay::Emerges), requires: Slot::Value(Rc::new(move |s, c| Ok(if ward == Ward::Line { ward.source(s, c)? } else { anomaly::intensity(s, "hallowed", c)? } > 0.0))), suitability: Slot::NotApplicable("People's keeping supplies the location."), places: Must::Value(Rc::new(move |s| ward.found(s))) },
        publication: Publication { statement: Must::Value("Publish the owning Hallowed class through its coverage.".into()), moment: Must::Value(Moment::Magic), record: Must::Value(Rc::new(move |s: &S, p: &Place| records::rule(s, p, "hallowed", rule))) }, across_maps: across(ward), event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten, fields: cover_shared::fields("Hallowed's rock and warding feedback hold ground and turn cutting, coastal force, storms and other systems onto the rim; the place adds no duplicate writes."), movement: movement(ward), others: others(ward),
            people: People { statement: Must::Value("Kept ground protects people and pilgrims; what it holds back threatens the edge.".into()), offers: Slot::Value(Rc::new(move |s, p| { let v = peak(s, p)?; Ok(if ward == Ward::Line { [(Benefit::Defence, v), (Benefit::Sanctity, v / 2.0), (Benefit::Trade, v / 4.0)].into_iter().collect() } else { [(Benefit::Sanctity, v), (Benefit::Defence, v / 2.0)].into_iter().collect() }) })), threatens: Slot::Value(Rc::new(move |s, p| Ok(vec![Hazard { hazard: if ward == Ward::Line { "what the ward turns back, at its edge" } else { "what the ward holds back, on its rim" }.into(), reach: if ward == Ward::Line { measure(&s.field()?.scale, 0.0005, 1, 1.0)? } else { (area(s, p)? / std::f64::consts::PI).sqrt() + measure(&s.field()?.scale, 0.00125, 1, 1.0)? }, severity: peak(s, p)? * if ward == Ward::Line { 0.5 } else { 1.0 } }]))) },
            time: ThroughTime { statement: Must::Value("The active ward lasts while its source is kept; after it ends altered stone remains ordinary material.".into()), fate: Slot::Value(Rc::new(move |s, p| Ok(if anomaly::peak(p, |c| ward.source(s, c))? > 0.0 { Fate::Persists } else { Fate::Ends { leaves: None } }))) }, visibility: visible(ward),
            naming: Naming { statement: Must::Value("Keepers use the seat's name, and its shrines or fords can share it.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(if ward == Ward::Line { vec![NameRelation { relation: nearby(ward, Kind::Settlement), chance: None }] } else { cover_shared::holds(&[Kind::Settlement]).into_iter().map(|relation| NameRelation { relation, chance: None }).collect() }), lends_name_to: Slot::Value(if ward == Ward::Line { vec![nearby(ward, Kind::Shrine), nearby(ward, Kind::Ford)] } else { cover_shared::holds(&[Kind::Shrine]) }), term: Slot::Unwritten },
        },
    }
}
