//! A craft's visible ground reads its existing question responder; the place adds no effects.
use super::{
    carry_rules,
    catalogue::CatalogueState,
    contract::*,
    cover_shared,
    kinds::{Group, Kind},
    map_records, places, records,
    state::State,
    values::*,
    visibility,
};
use crate::{
    features::records::Attributes,
    field::{
        people::crafts::{self, Craft, CRAFTS},
        significance::measure,
    },
};
use std::{io, rc::Rc};
#[derive(Clone, Copy)]
pub enum Practice {
    HearthRing,
    ReadIce,
    HeldShore,
    BoundWood,
    SwornGround,
    VowedGround,
}
struct Description {
    kind: Kind,
    name: &'static str,
    craft: Craft,
    breaks: &'static str,
    shows: &'static str,
    price: &'static str,
    offers: &'static [(Benefit, f64)],
    threat: Option<(&'static str, f64)>,
}
impl Practice {
    pub const ALL: [Self; 6] = [
        Self::HearthRing,
        Self::ReadIce,
        Self::HeldShore,
        Self::BoundWood,
        Self::SwornGround,
        Self::VowedGround,
    ];
    fn description(self) -> Description {
        match self {
            Self::HearthRing => Description { kind: Kind::HearthRing, name: "Hearth ring", craft: CRAFTS[0], breaks: "Within a kept hearth the season is the hearth's, not the climate's, and the ground holds nothing against a way.", shows: "Fields stand green in a ring inside ice or cold waste, and ways run straight through rock.", price: "Every use burns the keeper's hands.", offers: &[(Benefit::Food, 0.8), (Benefit::Trade, 0.5)], threat: None },
            Self::ReadIce => Description { kind: Kind::ReadIce, name: "Read ice", craft: CRAFTS[1], breaks: "Where readers work nothing is forgotten: ways, kept lines and what a people holds do not fade.", shows: "Old names, old claims and old roads stand as if their makers had not gone.", price: "Readers lose track of which memories are their own.", offers: &[(Benefit::Sanctity, 0.5), (Benefit::Defence, 0.3)], threat: None },
            Self::HeldShore => Description { kind: Kind::HeldShore, name: "Held shore", craft: CRAFTS[2], breaks: "Where divers hold it the sea does not stand at its level: it is held off the shallows beside their shore.", shows: "Sea floor lies dry and lived on below the level of the sea beside it.", price: "Those who carry the charge are slow to answer and partly absent.", offers: &[(Benefit::Food, 0.4), (Benefit::Trade, 0.6)], threat: Some(("the sea returning", 0.9)) },
            Self::BoundWood => Description { kind: Kind::BoundWood, name: "Bound wood", craft: CRAFTS[3], breaks: "Those who tend are bound to what they tend: they do not leave it and raise nothing on it, and hunger and hurt take no one there.", shows: "A wood holds a town's people and no houses, more than its land could feed.", price: "Tenders sicken when their ground is cut and cannot leave it.", offers: &[(Benefit::Food, 0.6), (Benefit::Sanctity, 0.4)], threat: None },
            Self::SwornGround => Description { kind: Kind::SwornGround, name: "Sworn ground", craft: CRAFTS[4], breaks: "An oath sworn on raked ground does not give way, and the remembered dead are present on it.", shows: "A realm keeps ground no living people hold for it, and a city stands where only its dead are.", price: "Rakers cannot forget.", offers: &[(Benefit::Defence, 0.6), (Benefit::Sanctity, 0.5)], threat: None },
            Self::VowedGround => Description { kind: Kind::VowedGround, name: "Vowed ground", craft: CRAFTS[5], breaks: "Inside the vow nothing is harmed: hunger, hazard and attack take no one.", shows: "No one has died there of anything that strikes, while the country at its rim takes what was turned away.", price: "The vowed cannot dig, kindle, dam or cut, and must walk their boundary for as long as it is to hold.", offers: &[(Benefit::Defence, 1.0), (Benefit::Sanctity, 1.0)], threat: Some(("harm turned away to the rim", 0.6)) },
        }
    }
    fn strength(self, s: &impl State, c: usize) -> io::Result<f64> {
        if matches!(self, Self::HeldShore) {
            crafts::sea_held_off(s.field()?, c)
        } else {
            crafts::practised(s.field()?, self.description().craft, c)
        }
    }
    fn is_a(self, s: &impl State, c: usize) -> io::Result<bool> {
        Ok(self.strength(s, c)?
            >= if matches!(self, Self::HeldShore) {
                0.5
            } else {
                0.25
            })
    }
    fn found(self, s: &impl State) -> io::Result<Vec<Place>> {
        Ok(places::region_places(
            s,
            self.description().kind,
            |c| self.is_a(s, c),
            |c| self.strength(s, c),
        )?
        .as_ref()
        .clone())
    }
    fn local(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::stands_out(s, p, around(s)?, |c| self.strength(s, c))
    }
    fn isolation(self, s: &impl State, p: &Place) -> io::Result<f64> {
        visibility::alone_among(s, p, &self.found(s)?, around(s)?)
    }
}
fn around(s: &impl State) -> io::Result<f64> {
    Ok(6.0 * s.field()?.scale.cells(1.0))
}
fn magnitude(s: &impl State, p: &Place) -> io::Result<f64> {
    Ok(visibility::sized(
        cover_shared::area(s, p)?,
        measure(&s.field()?.scale, 0.000125, 2, 1.0)?,
    ))
}
fn cultural(s: &impl State, p: &Place) -> io::Result<f64> {
    visibility::attachment(s, p, around(s)?)
}
fn neighbour<S: State + 'static>() -> Relation<S> {
    Relation {
        kind: Kind::Settlement,
        holds: Rc::new(|s, a, b| places::within(s, a, b, around(s)?)),
    }
}
fn record(
    practice: Practice,
    s: &impl map_records::MapState,
    p: &Place,
) -> io::Result<Option<crate::features::Feature>> {
    let d = practice.description();
    let mut attributes = Attributes::new();
    attributes.insert("craft".into(), d.craft.name.into());
    attributes.insert("system".into(), d.craft.system.into());
    attributes.insert("breaks".into(), d.breaks.into());
    attributes.insert(
        "practised".into(),
        ((practice.strength(s, p.anchor)? * 100.0 + 0.5).floor() / 100.0).into(),
    );
    if p.cells.len() >= records::MINIMUM_AREA_CELLS {
        records::area(
            s,
            p,
            records::Shape {
                kind: d.kind.as_str(),
                layer: "magicPractices",
                name: d.name,
                attributes,
            },
            Some(&|c| practice.strength(s, c)),
        )
    } else {
        map_records::site(s, p, d.kind.as_str(), "magicPractices", d.name, attributes)
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>(
    practice: Practice,
) -> Entry<S, Schedule> {
    let d = practice.description();
    Entry { id: d.kind, group: Group::Anomalies, name: d.name.into(),
        recognition: Recognition { distinct: Must::Value(format!("Ground where {} is practised: {} {}", d.craft.name, d.breaks, d.shows)), is_a: Must::Value(Rc::new(move |s, c| practice.is_a(s, c))), landform: Slot::Unwritten },
        existence: Existence { statement: Must::Value("People practise their learned craft where its medium reaches them; nobody sites this ground.".into()), origins: Slot::Unwritten, way: Must::Value(ExistenceWay::Emerges), requires: Slot::Value(Rc::new(move |s, c| Ok(practice.strength(s, c)? > 0.0))), suitability: Slot::NotApplicable("The people and their medium decide."), places: Must::Value(Rc::new(move |s| practice.found(s))) },
        publication: Publication { statement: Must::Value("Publish an outline for an area, or a mark for smaller ground, with people's places.".into()), moment: Must::Value(Moment::Society), record: Must::Value(Rc::new(move |s: &S, p: &Place| record(practice, s, p))) },
        across_maps: AcrossMaps { statement: Must::Value("A child keeps its parent's place record; its own practice follows people on its own lattice.".into()), stands_on: Slot::Unwritten, carry: Slot::Value(Rc::new(carry_rules::where_it_lands)), realize: Slot::NotApplicable("The record asks for no finer terrain."), counterpart: Slot::NotApplicable("The refinement does not yet hold the craft to find it by."), unrealized: Slot::NotApplicable("The parent's record stands without seeking a counterpart."), settle: Slot::NotApplicable("The parent's record stands without seeking a counterpart."), schedule: Slot::NotApplicable("No place-specific refinement step.") }, event: None,
        roles: Roles { true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten,
            fields: cover_shared::fields(&format!("{} The craft's break is a question answer, not a place write.", d.breaks)), movement: cover_shared::movement("The craft answers crossing costs directly; this place adds no costs, material transport or barrier crossing."),
            others: Others { statement: Must::Value("Practitioners live in or beside their system's ground; two crafts can meet there.".into()), needs: Slot::Value(vec![neighbour()]), excludes: Slot::NotApplicable("Crafts can share ground."), contains: Slot::NotApplicable("The ground contains whatever stands there."), pairs_with: Slot::NotApplicable("System entries name their own pairs.") },
            people: People { statement: Must::Value(format!("{} {}", d.shows, d.price)), offers: Slot::Value(Rc::new(move |_, _| Ok(practice.description().offers.iter().copied().collect()))), threatens: Slot::Value(Rc::new(move |s, p| match practice.description().threat { Some((hazard, severity)) => Ok(vec![Hazard { hazard: hazard.into(), severity, reach: around(s)? + cover_shared::area(s, p)?.sqrt() }]), None => Ok(Vec::new()) })) },
            time: ThroughTime { statement: Must::Value("The break lasts while practitioners remain on its medium; when they go the ordinary rule holds again.".into()), fate: Slot::Value(Rc::new(move |s, p| Ok(if practice.strength(s, p.anchor)? >= 0.25 { Fate::Persists } else { Fate::Ends { leaves: None } }))) },
            visibility: Visibility { statement: Must::Value("Extent, contrast and isolation establish the mark; a capital can carry it.".into()), magnitude: Slot::Value(Rc::new(magnitude)), local_conditions: Slot::Value(Rc::new(move |s, p| practice.local(s, p))), isolation: Slot::Value(Rc::new(move |s, p| practice.isolation(s, p))), cultural: Slot::Value(Rc::new(cultural)), importance: Must::Value(Rc::new(move |s, p| Ok((0.5 * magnitude(s, p)? + 0.3 * practice.local(s, p)? + 0.2 * practice.isolation(s, p)?).max(cultural(s, p)?)))) },
            naming: Naming { statement: Must::Value("Named by those who practise there.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::Value(vec![NameRelation { relation: neighbour(), chance: None }]), lends_name_to: Slot::NotApplicable("Nothing is named after it yet."), term: Slot::Unwritten },
        },
    }
}
