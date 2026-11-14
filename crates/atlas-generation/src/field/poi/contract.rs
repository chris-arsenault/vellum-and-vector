//! The current POI roles remain independent strategies over generation state.
use super::{
    kinds::{AreaKind, Group, Kind},
    values::*,
};
use crate::{features::Feature, field::people::land_events::Struck};
// hpc-exempt: sparse catalogue configuration and claimed origin anchors.
use std::{collections::BTreeMap, io, rc::Rc};

pub type OnCell<S, T> = Rc<dyn Fn(&S, usize) -> io::Result<T>>;
pub type OnPlace<S, T> = Rc<dyn Fn(&S, &Place) -> io::Result<T>>;
pub type OnCarried<S, T> = Rc<dyn Fn(&S, &Carried) -> io::Result<T>>;
pub type Places<S> = Rc<dyn Fn(&S) -> io::Result<Vec<Place>>>;
pub type RelationRule<S> = Rc<dyn Fn(&S, &Place, &Place) -> io::Result<bool>>;
// hpc-exempt: origins claim sparse discovered place anchors in declared order.
pub type Finder<S> = Rc<dyn Fn(&S, &super::origins::Claims) -> io::Result<Vec<Found>>>;
pub struct Origin<S> {
    pub id: String,
    pub statement: String,
    pub reads: Vec<Kind>,
    pub finds: Finder<S>,
}
pub struct Recognition<S> {
    pub distinct: Must<String>,
    pub is_a: Must<OnCell<S, bool>>,
    pub landform: Slot<LandformMark>,
}
pub struct Existence<S> {
    pub origins: Slot<Vec<Origin<S>>>,
    pub statement: Must<String>,
    pub way: Must<ExistenceWay>,
    pub requires: Slot<OnCell<S, bool>>,
    pub suitability: Slot<OnCell<S, f64>>,
    pub places: Must<Places<S>>,
}
pub struct Publication<S> {
    pub statement: Must<String>,
    pub moment: Must<Moment>,
    pub record: Must<Rc<dyn PublicationRecord<S>>>,
}
/// Most entries construct records; community entries can update an existing subject's detail.
pub trait PublicationRecord<S> {
    fn record(&self, state: &mut S, place: &Place) -> io::Result<Option<Feature>>;
}
impl<S, F> PublicationRecord<S> for F
where
    F: Fn(&S, &Place) -> io::Result<Option<Feature>>,
{
    fn record(&self, state: &mut S, place: &Place) -> io::Result<Option<Feature>> {
        self(state, place)
    }
}
pub struct Fields<S> {
    pub statement: Must<String>,
    pub terrain: Slot<OnPlace<S, Vec<FieldChange>>>,
    pub water: Slot<OnPlace<S, Vec<FieldChange>>>,
    pub climate: Slot<OnPlace<S, Vec<FieldChange>>>,
    pub cover: Slot<OnPlace<S, Vec<FieldChange>>>,
    pub magic: Slot<OnPlace<S, Vec<FieldChange>>>,
}
pub type EventChanges<S> = Rc<dyn Fn(&S, &Struck) -> io::Result<Vec<PhysicalChange>>>;
pub type AcceptEvent = Rc<dyn Fn(&Struck) -> bool>;
// hpc-exempt: one strategy per named carrier in the catalogue.
pub type CarrierCosts<S> = BTreeMap<Carrier, OnPlace<S, Vec<Cost>>>;
pub struct EventCommand<S> {
    pub accepts: AcceptEvent,
    pub changes: EventChanges<S>,
}
pub type Carriage<S> = Rc<dyn Fn(&S, &Feature) -> io::Result<Option<Carried>>>;
pub struct AcrossMaps<S, Schedule> {
    pub statement: Must<String>,
    pub stands_on: Slot<AreaKind>,
    pub carry: Slot<Carriage<S>>,
    pub realize: Slot<OnCarried<S, Vec<FieldChange>>>,
    pub counterpart: Slot<OnCarried<S, Option<usize>>>,
    pub unrealized: Slot<OnCarried<S, Unrealized>>,
    pub settle: Slot<OnCarried<S, Unrealized>>,
    pub schedule: Slot<Schedule>,
}
pub struct Movement<S> {
    pub statement: Must<String>,
    pub roads: Slot<OnPlace<S, Vec<Cost>>>,
    pub boats: Slot<OnPlace<S, Vec<Cost>>>,
    pub drainage: Slot<OnPlace<S, Vec<Cost>>>,
    // hpc-exempt: one optional cost strategy per named magic carrier.
    pub magic: Slot<CarrierCosts<S>>,
    pub links: Slot<OnPlace<S, Vec<Link>>>,
    pub crosses: Slot<OnPlace<S, Vec<Barrier>>>,
}
pub struct Relation<S> {
    pub kind: Kind,
    pub holds: RelationRule<S>,
}
pub struct Others<S> {
    pub statement: Must<String>,
    pub needs: Slot<Vec<Relation<S>>>,
    pub excludes: Slot<Vec<Relation<S>>>,
    pub contains: Slot<Vec<Relation<S>>>,
    pub pairs_with: Slot<Vec<Relation<S>>>,
}
// hpc-exempt: benefit strengths keyed by the seven catalogue roles, not cells.
pub type Benefits = BTreeMap<Benefit, f64>;
pub struct People<S> {
    pub statement: Must<String>,
    pub offers: Slot<OnPlace<S, Benefits>>,
    pub threatens: Slot<OnPlace<S, Vec<Hazard>>>,
}
pub struct ThroughTime<S> {
    pub statement: Must<String>,
    pub fate: Slot<OnPlace<S, Fate>>,
}
pub struct Visibility<S> {
    pub statement: Must<String>,
    pub magnitude: Slot<OnPlace<S, f64>>,
    pub local_conditions: Slot<OnPlace<S, f64>>,
    pub isolation: Slot<OnPlace<S, f64>>,
    pub cultural: Slot<OnPlace<S, f64>>,
    pub importance: Must<OnPlace<S, f64>>,
}
pub struct NameRelation<S> {
    pub relation: Relation<S>,
    pub chance: Option<f64>,
}
pub struct Naming<S> {
    pub statement: Must<String>,
    pub named_by: Slot<OnPlace<S, Option<String>>>,
    pub takes_name_from: Slot<Vec<NameRelation<S>>>,
    pub lends_name_to: Slot<Vec<Relation<S>>>,
    pub term: Slot<OnPlace<S, NameTerm>>,
}
pub struct Variety<S> {
    pub statement: String,
    pub of: OnPlace<S, String>,
}
pub struct TrueSize<S> {
    pub statement: String,
    pub size: OnPlace<S, Size>,
    pub represents: OnPlace<S, usize>,
}
pub struct Roles<S> {
    pub true_size: Slot<TrueSize<S>>,
    pub variety: Slot<Variety<S>>,
    pub appearance: Slot<OnPlace<S, serde_json::Map<String, serde_json::Value>>>,
    pub account: Slot<OnPlace<S, String>>,
    pub fields: Fields<S>,
    pub movement: Movement<S>,
    pub others: Others<S>,
    pub people: People<S>,
    pub time: ThroughTime<S>,
    pub visibility: Visibility<S>,
    pub naming: Naming<S>,
}
pub struct Entry<S, Schedule> {
    pub id: Kind,
    pub group: Group,
    pub name: String,
    pub recognition: Recognition<S>,
    pub existence: Existence<S>,
    pub publication: Publication<S>,
    pub across_maps: AcrossMaps<S, Schedule>,
    pub event: Option<EventCommand<S>>,
    pub roles: Roles<S>,
}
pub struct GroupPage {
    pub id: Group,
    pub name: String,
    pub belongs: Must<String>,
    pub excludes: Must<String>,
}
