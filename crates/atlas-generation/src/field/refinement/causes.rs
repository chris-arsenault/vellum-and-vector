//! Established features retain their own contributions to the regional schedule.
use super::{
    courses::CapturedCourse,
    network::{Entry, Lake},
    seats::Seat,
};
use crate::{
    field::{
        landmarks::catalogue::Landmark,
        poi::{
            carry::{self, CarryState},
            catalogue::Catalogue,
            costs,
        },
    },
    hpc::{Direction, KeyedHeap},
};
use std::{io, rc::Rc};

#[derive(Default)]
pub struct Evidence {
    pub courses: Vec<CapturedCourse>,
    pub lakes: Vec<Lake>,
    pub seats: Vec<Seat>,
    pub entries: Vec<Entry>,
    pub landmarks: Vec<Landmark>,
}
pub type Action<S> = Rc<dyn Fn(&mut S) -> io::Result<()>>;
pub type Read<S> = Rc<dyn Fn(&mut S, &mut Evidence) -> io::Result<()>>;
pub type Influence<S> = Rc<dyn Fn(&S, &mut [f64]) -> io::Result<()>>;
pub struct Cause<S> {
    pub kind: String,
    pub read: Option<Read<S>>,
    pub influence: Option<Influence<S>>,
    pub support: Option<Action<S>>,
    pub restore: Option<Action<S>>,
    pub conjoin: Option<Action<S>>,
    pub respond: Option<Action<S>>,
}
pub type Schedule<S> = Rc<Cause<S>>;
impl<S> Cause<S> {
    pub fn new(kind: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            read: None,
            influence: None,
            support: None,
            restore: None,
            conjoin: None,
            respond: None,
        }
    }
}
pub struct Registry<S> {
    causes: Vec<Schedule<S>>,
}
impl<S> Default for Registry<S> {
    fn default() -> Self {
        Self { causes: Vec::new() }
    }
}
fn order_cells<T>(items: &mut Vec<T>, key: impl Fn(&T) -> usize) {
    let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for (at, item) in items.iter().enumerate() {
        heap.push(at as u32, [key(item) as f64]);
    }
    let mut source = std::mem::take(items)
        .into_iter()
        .map(Some)
        .collect::<Vec<_>>();
    while let Some((at, _)) = heap.pop() {
        items.push(source[at as usize].take().unwrap());
    }
}
impl Evidence {
    fn order(&mut self) {
        // hpc-exempt: sparse named feature records are ordered by stable identity.
        self.courses.sort_by(|a, b| a.feature.id.cmp(&b.feature.id));
        // hpc-exempt: sparse captured landmark identities.
        self.landmarks.sort_by(|a, b| a.id.cmp(&b.id));
        // hpc-exempt: sparse named settlement records.
        self.seats.sort_by(|a, b| a.feature_id.cmp(&b.feature_id));
        order_cells(&mut self.entries, |entry| entry.cell);
        order_cells(&mut self.lakes, |lake| lake.cells[0]);
    }
}
impl<S> Registry<S> {
    pub fn register(&mut self, cause: Schedule<S>) {
        if !self.causes.iter().any(|known| known.kind == cause.kind) {
            self.causes.push(cause);
        }
    }
    pub fn read(&self, state: &mut S) -> io::Result<Evidence> {
        let mut evidence = Evidence::default();
        for cause in &self.causes {
            if let Some(read) = &cause.read {
                read(state, &mut evidence)?;
            }
        }
        evidence.order();
        Ok(evidence)
    }
    pub fn influence(&self, state: &S, cost: &mut [f64]) -> io::Result<()> {
        for cause in &self.causes {
            if let Some(influence) = &cause.influence {
                influence(state, cost)?;
            }
        }
        Ok(())
    }
    fn act(
        &self,
        state: &mut S,
        choose: impl Fn(&Cause<S>) -> Option<&Action<S>>,
    ) -> io::Result<()> {
        for cause in &self.causes {
            if let Some(action) = choose(cause) {
                action(state)?;
            }
        }
        Ok(())
    }
    pub fn support(&self, state: &mut S) -> io::Result<()> {
        self.act(state, |cause| cause.support.as_ref())
    }
    pub fn restore(&self, state: &mut S) -> io::Result<()> {
        self.act(state, |cause| cause.restore.as_ref())
    }
    pub fn conjoin(&self, state: &mut S) -> io::Result<()> {
        self.act(state, |cause| cause.conjoin.as_ref())
    }
    pub fn respond(&self, state: &mut S) -> io::Result<()> {
        self.act(state, |cause| cause.respond.as_ref())
    }
}
impl<S: CarryState<Schedule<S>> + 'static> Registry<S> {
    pub fn register_catalogue(
        &mut self,
        catalogue: Rc<Catalogue<S, Schedule<S>>>,
        grade_places: Action<S>,
    ) {
        for entry in catalogue.entries() {
            if let Some(schedule) = entry.across_maps.schedule.value() {
                self.register(schedule.clone());
            }
        }
        let mut cause = Cause::new("catalogue");
        cause.influence = Some(Rc::new(move |state, cost| {
            let carried = carry::carried_places(state, &catalogue)?;
            costs::drainage_costs(
                state,
                carried
                    .iter()
                    .map(|item| (catalogue.get(item.kind), &item.place)),
                cost,
            )
        }));
        cause.restore = Some(grade_places);
        self.register(Rc::new(cause));
    }
}
pub fn lake<S: 'static>(read: crate::field::poi::lake::LakeReader<S>) -> Schedule<S> {
    let mut cause = Cause::new("lake");
    cause.read = Some(Rc::new(move |state, evidence| {
        evidence.lakes.extend(read(state)?);
        Ok(())
    }));
    Rc::new(cause)
}
pub fn dam<S: 'static>(respond: crate::field::poi::dam::ReservoirResponse<S>) -> Schedule<S> {
    let mut cause = Cause::new("dam");
    cause.respond = Some(Rc::new(move |state| respond(state)));
    Rc::new(cause)
}
