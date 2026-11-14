use super::{places::Place, traditions::Context};
use crate::{
    field::Field,
    human::{
        identity::{leading, Tradition},
        HumanField,
    },
};
use serde::{Deserialize, Serialize};
// hpc-exempt: remembered allegiance by named settlement id.
use std::{collections::BTreeMap, io};

#[derive(Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub kind: String,
    pub era: String,
    pub place: String,
    pub cell: usize,
    pub casualties: f64,
    pub townsfolk: f64,
    pub magnitude: f64,
    pub causes: Vec<String>,
}
#[derive(Default)]
pub struct Events {
    next: usize,
    pub known: Vec<Event>,
    dead_before: Option<Vec<f64>>,
    // hpc-exempt: historical allegiance of named settlements.
    held: BTreeMap<String, i32>,
    pub era: Option<String>,
}
pub fn dead_on(field: &Field, place: &Place) -> io::Result<f64> {
    let dead = field.people.view(HumanField::MassDeath);
    place
        .cells
        .iter()
        .try_fold(0.0, |total, &cell| Ok(total + dead.get(cell)?))
}
pub fn rounded(value: f64) -> f64 {
    (value + 0.5).floor()
}
impl Events {
    pub fn record(&mut self, mut event: Event) {
        event.id = format!("event:{}", self.next);
        self.next += 1;
        self.known.push(event);
    }
    pub fn famine(&mut self, field: &Field, place: &Place, era: &str, town: f64) -> io::Result<()> {
        let Some(before) = &self.dead_before else {
            return Ok(());
        };
        let dead = field.people.view(HumanField::MassDeath);
        let mut died = 0.0;
        for &cell in &place.cells {
            died += (dead.get(cell)? - before[cell]).max(0.0);
        }
        if died < town {
            return Ok(());
        }
        let casualties = rounded(died);
        let townsfolk = rounded(place.town_people.max(place.peak));
        self.record(Event { id: String::new(), kind: "famine".into(), era: era.into(), place: place.id.clone(), cell: place.anchor,
            casualties, townsfolk, magnitude: casualties / (casualties + townsfolk),
            causes: vec![format!("{era}: the country around this place could not feed those who lived on it, and {casualties} died here.")] });
        Ok(())
    }
    pub fn siege(
        &mut self,
        field: &Field,
        memory: &Context,
        place: &Place,
        era: &str,
    ) -> io::Result<()> {
        let column = field.people.column(place.anchor)?;
        let (realm, holding) = leading(&column, Tradition::Allegiance);
        let before = self.held.get(&place.id).copied().unwrap_or(0);
        if realm != 0 {
            self.held.insert(place.id.clone(), realm);
        }
        if realm == 0 || before == 0 || before == realm || place.abandoned.is_some() {
            return Ok(());
        }
        let name = |code| {
            memory
                .traditions
                .get(code)
                .and_then(|t| memory.entities.get(&t.entity))
                .map_or("another realm", |e| e.name.as_str())
        };
        let everyone: f64 = column.iter().map(|layer| layer.people).sum();
        self.record(Event {
            id: String::new(),
            kind: "siege".into(),
            era: era.into(),
            place: place.id.clone(),
            cell: place.anchor,
            casualties: 0.0,
            townsfolk: rounded(place.town_people),
            magnitude: if everyone > 0.0 {
                holding / everyone
            } else {
                0.0
            },
            causes: vec![format!(
                "{era}: this place passed from the hold of {} to {}.",
                name(before),
                name(realm)
            )],
        });
        Ok(())
    }
    pub fn count_dead(&mut self, field: &Field) -> io::Result<()> {
        let dead = field.people.view(HumanField::MassDeath);
        self.dead_before = Some(
            (0..field.mesh.len())
                .map(|cell| dead.get(cell))
                .collect::<io::Result<_>>()?,
        );
        Ok(())
    }
}
