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
    pub delivery: Delivery,
    pub statement: Must<String>,
    pub moment: Must<Moment>,
    pub record: Must<Rc<dyn PublicationRecord<S>>>,
}
#[derive(Clone, Copy)]
pub enum Delivery {
    Ecology,
    Lakes,
    Volcanism,
    Landforms,
}
/// Most entries construct records; community entries can update an existing subject's detail.
pub trait PublicationRecord<S> {
    fn record(&self, state: &mut S, place: &Place) -> io::Result<Option<Feature>>;
    fn publishes_subjects(&self) -> bool {
        false
    }
    fn prepare_batch(&self, _state: &S, _records: &mut [(Place, Feature)]) -> io::Result<()> {
        Ok(())
    }
    fn published(&self, _state: &S) {}
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
    pub on_foot: Option<TrailRole>,
    pub statement: Must<String>,
    pub roads: Slot<OnPlace<S, Vec<Cost>>>,
    pub boats: Slot<OnPlace<S, Vec<Cost>>>,
    pub drainage: Slot<OnPlace<S, Vec<Cost>>>,
    // hpc-exempt: one optional cost strategy per named magic carrier.
    pub magic: Slot<CarrierCosts<S>>,
    pub links: Slot<OnPlace<S, Vec<Link>>>,
    pub crosses: Slot<OnPlace<S, Vec<Barrier>>>,
}
/// How the place participates in the local walking network.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrailRole {
    Destination,
    Junction,
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
/// Whom a place's offers serve: the people holding one tradition. Offers with none serve
/// everyone. Consumers value a benefit; the place says only what it gives and to whom.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Beneficiary {
    pub tradition: crate::human::identity::Tradition,
    pub code: i32,
}
/// What a place gives people, in the seven benefits every consumer speaks, and whom each
/// serves. It reads as the benefit map it extends, so entries keep building it from pairs.
#[derive(Clone, Default)]
pub struct Benefits {
    // hpc-exempt: benefit strengths keyed by the seven catalogue roles, not cells.
    strengths: BTreeMap<Benefit, f64>,
    // hpc-exempt: beneficiaries keyed by the seven catalogue roles, not cells.
    serves: BTreeMap<Benefit, Beneficiary>,
}
impl Benefits {
    pub fn new() -> Self {
        Self::default()
    }
    /// The same offers, with `benefit` for the people holding `tradition` `code` only. A code
    /// of 0 is no tradition, so that benefit stays open to everyone.
    #[must_use]
    pub fn serving(
        mut self,
        benefit: Benefit,
        tradition: crate::human::identity::Tradition,
        code: i32,
    ) -> Self {
        if code == 0 {
            self.serves.remove(&benefit);
        } else {
            self.serves.insert(benefit, Beneficiary { tradition, code });
        }
        self
    }
    /// Whom `benefit` serves; `None` is everyone.
    pub fn serves(&self, benefit: Benefit) -> Option<Beneficiary> {
        self.serves.get(&benefit).copied()
    }
}
impl std::ops::Deref for Benefits {
    // hpc-exempt: the benefit map, keyed by catalogue role, not cells.
    type Target = BTreeMap<Benefit, f64>;
    fn deref(&self) -> &Self::Target {
        &self.strengths
    }
}
impl std::ops::DerefMut for Benefits {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.strengths
    }
}
impl FromIterator<(Benefit, f64)> for Benefits {
    fn from_iter<I: IntoIterator<Item = (Benefit, f64)>>(pairs: I) -> Self {
        Self {
            strengths: pairs.into_iter().collect(),
            // hpc-exempt: beneficiaries keyed by catalogue role, not cells.
            serves: BTreeMap::new(),
        }
    }
}
impl IntoIterator for Benefits {
    type Item = (Benefit, f64);
    type IntoIter = std::collections::btree_map::IntoIter<Benefit, f64>;
    fn into_iter(self) -> Self::IntoIter {
        self.strengths.into_iter()
    }
}
impl<'a> IntoIterator for &'a Benefits {
    type Item = (&'a Benefit, &'a f64);
    type IntoIter = std::collections::btree_map::Iter<'a, Benefit, f64>;
    fn into_iter(self) -> Self::IntoIter {
        self.strengths.iter()
    }
}
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

#[cfg(test)]
mod tests {
    use super::{Benefit, Benefits};
    use crate::human::identity::Tradition;

    #[test]
    fn a_benefit_can_serve_one_tradition_while_the_rest_serve_everyone() {
        let offers: Benefits = [(Benefit::Trade, 0.5), (Benefit::Power, 0.8)]
            .into_iter()
            .collect::<Benefits>()
            .serving(Benefit::Power, Tradition::Allegiance, 7);
        assert_eq!(offers.get(&Benefit::Power), Some(&0.8));
        assert_eq!(offers.serves(Benefit::Trade), None);
        assert_eq!(offers.serves(Benefit::Power).map(|b| b.code), Some(7));
        assert_eq!(
            offers
                .serving(Benefit::Power, Tradition::Allegiance, 0)
                .serves(Benefit::Power),
            None
        );
    }
}
