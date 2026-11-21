//! The era's place offers: what the catalogue's places give people and threaten them with,
//! read once per era onto the land. This is the only place people's processes meet the
//! catalogue; they read benefit and threat bands and never a place kind.
use super::{
    catalogue::Catalogue,
    contract::{Benefits, Entry},
    publication::PublicationState,
    realized::present,
    values::{Benefit, Place},
};
use crate::{
    field::{refinement::topology::within, Field},
    human::identity::held,
    storage::{Band, ReadBand},
};
use std::io;

/// Benefit and threat bands, per cell, as the places standing at the start of an era offer
/// them, the waters the Pressure system makes perilous, and the magic meetings that strike.
/// A benefit's value is its strength where the place's people gather, times the share of the
/// cell's people it serves; a threat's is its severity over the cells within its reach.
pub struct PlaceOffers {
    benefits: Vec<ReadBand<f64>>,
    threatened: ReadBand<f64>,
    perilous: ReadBand<f64>,
    links: Vec<crate::links::Link>,
    meetings: Vec<Meeting>,
}
impl PlaceOffers {
    /// The distant pairs the standing places join for walkers, such as a traversable door,
    /// each at the cost its place declares.
    pub fn links(&self) -> &[crate::links::Link] {
        &self.links
    }
    pub fn benefit(&self, benefit: Benefit, cell: usize) -> io::Result<f64> {
        self.benefits[benefit as usize].get(cell)
    }
    /// How threatened a cell is by the dangers its places declare: what makes people there
    /// want walls. The land's own hazards and magic meetings strike; these do not.
    pub fn threatened(&self, cell: usize) -> io::Result<f64> {
        self.threatened.get(cell)
    }
    /// How much of a water cell's catch its peril takes: the old society cycle's rule that
    /// Pressure's crush cuts coastal catch to three tenths.
    pub fn perilous(&self, cell: usize) -> io::Result<f64> {
        self.perilous.get(cell)
    }
    /// The magic meetings that endanger people this era, for the events that strike them.
    pub fn meetings(&self) -> &[Meeting] {
        &self.meetings
    }
}
/// A magic meeting that strikes the ground it covers: its hazard, cause, how often a year it
/// strikes, how badly, and how much of each cell it covers.
#[derive(Clone)]
pub struct Meeting {
    pub kind: String,
    pub cause: String,
    pub cells: Vec<(usize, f64)>,
    pub severity: f64,
    pub yearly: f64,
}
/// The Pressure intensity, in thousandths, at which the old society cycle cut coastal catch.
const CRUSHING: f64 = 360.0;
/// The share of the catch Pressure's crush takes from boats that dare it.
const CRUSHED: f64 = 0.7;
/// The share of a cell's people `benefits` serves with `benefit`: everyone, or those holding
/// its beneficiary's tradition.
fn served(field: &Field, benefits: &Benefits, benefit: Benefit, cell: usize) -> io::Result<f64> {
    let Some(beneficiary) = benefits.serves(benefit) else {
        return Ok(1.0);
    };
    let column = field.people.column(cell)?;
    let everyone: f64 = column.iter().map(|layer| layer.people).sum();
    if everyone <= 0.0 {
        return Ok(0.0);
    }
    let holding = held(&column, beneficiary.tradition)
        .into_iter()
        .find(|(code, _)| *code == beneficiary.code)
        .map_or(0.0, |(_, people)| people);
    Ok(holding / everyone)
}
fn dry(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(field.water.borrow().kind_at(cell)? == 0)
}
/// The dry ground a place gives to: its own dry cells, and for its cells in water (a harbour's
/// basin, a river mouth) the shore beside them, where the people who use it live.
fn ground(field: &Field, place: &Place) -> io::Result<Vec<usize>> {
    let mut cells = Vec::new();
    for &cell in &place.cells {
        if cell >= field.mesh.len() {
            continue;
        }
        if dry(field, cell)? {
            cells.push(cell);
            continue;
        }
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                if dry(field, next)? && !cells.contains(&next) {
                    cells.push(next);
                }
            }
        }
    }
    Ok(cells)
}
/// How much of a place's offer each of its cells feels: all of it where its people gather
/// most, less across its outlying ground, so a town's market pulls toward the town and not
/// evenly over its countryside. Ground nobody lives on feels it evenly.
fn gathering(field: &Field, cells: &[usize]) -> io::Result<Vec<f64>> {
    let people = cells
        .iter()
        .map(|&cell| field.people.people(cell))
        .collect::<io::Result<Vec<_>>>()?;
    let most = people.iter().copied().fold(0.0, f64::max);
    Ok(if most > 0.0 {
        people.iter().map(|p| p / most).collect()
    } else {
        vec![1.0; people.len()]
    })
}
fn lay_offers(
    field: &Field,
    place: &Place,
    offers: &Benefits,
    bands: &mut [Band<f64>],
) -> io::Result<()> {
    let cells = ground(field, place)?;
    let felt = gathering(field, &cells)?;
    for (&benefit, &strength) in offers {
        // An unreadable offer (NaN or infinite) gives nothing.
        if !usable(strength) {
            continue;
        }
        let band = &mut bands[benefit as usize];
        for (&cell, &share) in cells.iter().zip(&felt) {
            let value = strength * share * served(field, offers, benefit, cell)?;
            band.set(cell, band.get(cell)? + value)?;
        }
    }
    Ok(())
}
/// A positive, finite strength; NaN and infinities are not.
fn usable(value: f64) -> bool {
    value.is_finite() && value > 0.0
}
/// The pairs a place joins on this map, at the cost of going through, in the map's steps.
fn joined(field: &Field, joins: &[super::values::Link]) -> Vec<crate::links::Link> {
    joins
        .iter()
        .filter(|link| link.a < field.mesh.len() && link.b < field.mesh.len())
        .filter(|link| link.steps.is_finite() && link.steps >= 0.0)
        .map(|link| crate::links::Link {
            a: link.a,
            b: link.b,
            cost: link.steps * field.mesh.spacing(),
        })
        .collect()
}
/// A place's declared dangers, over the cells within each one's reach: how threatened the
/// ground is, which sets how much its people want walls. They do not strike; the land's own
/// hazards strike, and a place's danger mostly describes one of them.
fn lay_threats<S>(
    field: &Field,
    state: &S,
    place: &Place,
    threats: &super::contract::OnPlace<S, Vec<super::values::Hazard>>,
    threatened: &mut Band<f64>,
) -> io::Result<()> {
    for hazard in threats(state, place)? {
        if !usable(hazard.severity) || !hazard.reach.is_finite() {
            continue;
        }
        for cell in within(&field.mesh, place.anchor, hazard.reach.max(0.0)) {
            threatened.set(cell, threatened.get(cell)? + hazard.severity)?;
        }
    }
    Ok(())
}
/// Magic meetings that endanger people, over the ground each covers. They raise how
/// threatened that ground is and strike the living places on it.
fn meetings<S: super::state::State>(
    field: &Field,
    state: &S,
    threatened: &mut Band<f64>,
) -> io::Result<Vec<Meeting>> {
    let mut found = Vec::new();
    for meeting in state.meeting_hazards() {
        if !usable(meeting.severity) || !usable(meeting.rate) {
            continue;
        }
        let mut cells = Vec::new();
        for cell in 0..field.mesh.len() {
            let covered = meeting.coverage.get(cell)?;
            if usable(covered) {
                let share = covered.min(1.0);
                cells.push((cell, share));
                threatened.set(cell, threatened.get(cell)? + meeting.severity * share)?;
            }
        }
        if !cells.is_empty() {
            found.push(Meeting {
                kind: meeting.kind,
                cause: meeting.cause,
                cells,
                severity: meeting.severity,
                yearly: meeting.rate,
            });
        }
    }
    Ok(found)
}
/// The waters the Pressure system's crush makes perilous: where its intensity reaches the old
/// society cycle's crushing strength, boats keep three tenths of the catch.
fn perilous<S: super::state::State>(field: &Field, state: &S) -> io::Result<Band<f64>> {
    let mut band = field.coverage.borrow_mut().allocate(0.0);
    for cell in 0..field.mesh.len() {
        if field.water.borrow().kind_at(cell)? == 0 {
            continue;
        }
        let pressure = super::reads::magic_value(
            state,
            "pressure",
            crate::magic::channels::Channel::Intensity,
            cell,
        )?;
        if pressure >= CRUSHING {
            band.set(cell, CRUSHED)?;
        }
    }
    Ok(band)
}
/// The places of one entry standing on this map, published here or left to finer maps.
fn standing<S: PublicationState<Schedule>, Schedule>(
    state: &S,
    entry: &Entry<S, Schedule>,
) -> io::Result<Vec<Place>> {
    let Some(find) = entry.existence.places.value() else {
        return Ok(Vec::new());
    };
    let length = state.field()?.mesh.len();
    let mut places = Vec::new();
    for place in find(state)? {
        // A remembered record without a cell on this map stands nowhere here.
        if place.anchor < length && present(state, entry, &place)? {
            places.push(place);
        }
    }
    Ok(places)
}
pub fn offered<S: PublicationState<Schedule>, Schedule>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
) -> io::Result<PlaceOffers> {
    let field = state.field()?;
    let mut benefits: Vec<Band<f64>> = Benefit::ALL
        .iter()
        .map(|_| field.coverage.borrow_mut().allocate(0.0))
        .collect();
    let mut threatened = field.coverage.borrow_mut().allocate(0.0);
    let mut links = Vec::new();
    let mut trace = Trace::default();
    for entry in catalogue.entries() {
        let offers = entry.roles.people.offers.value();
        let threats = entry.roles.people.threatens.value();
        let joins = entry.roles.movement.links.value();
        if offers.is_none() && threats.is_none() && joins.is_none() {
            continue;
        }
        let places = standing(state, entry)?;
        let mut given = [0.0; Benefit::ALL.len()];
        for place in &places {
            if let Some(joins) = joins {
                links.extend(joined(field, &joins(state, place)?));
            }
            if let Some(offers) = offers {
                let offered = offers(state, place)?;
                for (&benefit, &strength) in &offered {
                    given[benefit as usize] += strength;
                }
                lay_offers(field, place, &offered, &mut benefits)?;
            }
            if let Some(threats) = threats {
                lay_threats(field, state, place, threats, &mut threatened)?;
            }
        }
        trace.kind(entry.id.as_str(), places.len(), given);
    }
    let meetings = meetings(field, state, &mut threatened)?;
    trace.write(field, &benefits, &meetings)?;
    Ok(PlaceOffers {
        benefits: benefits.iter().map(Band::read_only).collect(),
        threatened: threatened.read_only(),
        perilous: perilous(field, state)?.read_only(),
        links,
        meetings,
    })
}
/// What the era's places offered, written to the server log when `ATLAS_TRACE_PEOPLE` is set:
/// each kind's places and offers, and each benefit as the average person feels it.
#[derive(Default)]
struct Trace {
    kinds: Vec<serde_json::Value>,
}
impl Trace {
    fn on() -> bool {
        std::env::var_os("ATLAS_TRACE_PEOPLE").is_some()
    }
    fn kind(&mut self, kind: &str, places: usize, given: [f64; Benefit::ALL.len()]) {
        if !Self::on() || places == 0 {
            return;
        }
        let offered: serde_json::Map<_, _> = Benefit::ALL
            .iter()
            .zip(given)
            .filter(|(_, v)| *v > 0.0)
            .map(|(b, v)| {
                (
                    format!("{b:?}"),
                    serde_json::json!((v * 100.0).round() / 100.0),
                )
            })
            .collect();
        self.kinds
            .push(serde_json::json!({"kind": kind, "places": places, "offered": offered}));
    }
    fn write(&self, field: &Field, benefits: &[Band<f64>], meetings: &[Meeting]) -> io::Result<()> {
        if !Self::on() {
            return Ok(());
        }
        let meetings: Vec<serde_json::Value> = meetings
            .iter()
            .map(|m| serde_json::json!({"kind": m.kind, "cells": m.cells.len()}))
            .collect();
        let mut felt = serde_json::Map::new();
        for benefit in Benefit::ALL {
            let band = &benefits[benefit as usize];
            let (mut people, mut weighted) = (0.0, 0.0);
            for cell in 0..field.mesh.len() {
                let living = field.people.people(cell)? * field.mesh.area(cell);
                people += living;
                weighted += living * band.get(cell)?;
            }
            let mean = weighted / people.max(f64::EPSILON);
            felt.insert(
                format!("{benefit:?}"),
                serde_json::json!((mean * 1000.0).round() / 1000.0),
            );
        }
        eprintln!(
            "{}",
            serde_json::json!({"event": "people.place-offers", "details": {
                "kinds": self.kinds, "peopleWeightedOffer": felt, "meetings": meetings}})
        );
        Ok(())
    }
}
