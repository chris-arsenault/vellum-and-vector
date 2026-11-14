use super::{
    country,
    identity_reads::leading_of,
    places::Places,
    questions::Questions,
    realm_seats::{self, Seat},
    traditions,
    travel::Travel,
    work::working,
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::Field,
    human::{
        identity::Tradition,
        operations::{self, Overlay},
    },
    links::Offers,
    storage::ReadBand,
};
use std::{cell::RefCell, io, rc::Rc};

pub struct Era {
    pub memory: Rc<RefCell<traditions::Context>>,
    pub places: Rc<RefCell<Places>>,
    pub era: String,
    pub years: f64,
    pub reach: f64,
    pub capacity: f64,
    pub realms: usize,
    pub friction: ReadBand<f64>,
    pub climbing: ReadBand<f64>,
    pub rivers: Rc<ReadBand<u32>>,
    pub links: Rc<Offers<Field>>,
}
impl Era {
    pub fn travel<'a>(&self, field: &'a Field) -> io::Result<Travel<'a>> {
        Travel::new(
            field,
            self.friction.clone(),
            self.climbing.clone(),
            self.rivers.clone(),
        )
    }
}
fn found(field: &Field, era: &Era) -> io::Result<()> {
    let towns = realm_seats::living(&era.places.borrow());
    if realm_seats::active(era).is_empty() {
        return realm_seats::first(field, era, &towns);
    }
    let held = realm_seats::seats(era);
    let travel = era.travel(field)?;
    let centres: Vec<_> = held.iter().map(|s| s.anchor).collect();
    let strengths: Vec<_> = held.iter().map(|s| s.strength).collect();
    let reached = country::spread(
        field,
        &centres,
        &|a, b| travel.step(a, b),
        era.reach,
        Some(&strengths),
        &era.links,
    )?;
    let allegiance = leading_of(field, Tradition::Allegiance)?;
    let great = 4.0 * era.places.borrow().least;
    let mut raised = 0;
    for town in towns {
        if raised >= era.realms {
            break;
        }
        if town.town_people < great
            || reached.owner[town.anchor] >= 0
            || realm_seats::seated(era, &town.id)
        {
            continue;
        }
        let parent = allegiance.code[town.anchor];
        realm_seats::found(field, era, &town, (parent != 0).then_some(parent))?;
        raised += 1;
    }
    Ok(())
}
fn falling(field: &Field, era: &Era, held: &[Seat]) -> io::Result<Vec<i32>> {
    let travel = era.travel(field)?;
    let mut costs = Vec::new();
    for seat in held {
        costs.push(
            country::spread(
                field,
                &[seat.anchor],
                &|a, b| travel.step(a, b),
                era.reach * seat.strength,
                None,
                &era.links,
            )?
            .cost,
        );
    }
    let leading = leading_of(field, Tradition::Allegiance)?;
    let mut code = vec![0; field.mesh.len()];
    for (cell, code) in code.iter_mut().enumerate() {
        let mut best = None;
        let mut best_cost = f64::INFINITY;
        for (at, cost) in costs.iter().enumerate() {
            let raw = cost.get(cell)?;
            let normal = raw / held[at].strength;
            if raw.is_finite() && (best.is_none() || normal < best_cost) {
                best = Some(at);
                best_cost = normal;
            }
        }
        if let Some(mut best) = best {
            if let Some(incumbent) = held.iter().position(|s| s.code == leading.code[cell]) {
                let cost = costs[incumbent].get(cell)?;
                if cost.is_finite() && best_cost > 0.6 * cost / held[incumbent].strength {
                    best = incumbent;
                }
            }
            *code = held[best].code;
        }
    }
    Ok(code)
}
fn spread(
    context: &mut CommandContext<'_, Field>,
    era: &Era,
    questions: &Questions,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    for realm in realm_seats::active(era) {
        realm_seats::reseat(context, era, &realm, owner)?;
    }
    let held = realm_seats::seats(era);
    if held.is_empty() {
        return Ok(());
    }
    let yielding = context.query(&questions.yielding)?.values();
    let field = context.state();
    let codes = falling(field, era, &held)?;
    let mut code = field.coverage.borrow_mut().scratch(field.mesh.len(), 0i32);
    let mut people = working(field);
    let share = (0.5 * era.capacity * era.years / 100.0).min(1.0);
    for (cell, &held) in codes.iter().enumerate() {
        code.set(cell, held)?;
        people.set(
            cell,
            if held != 0 {
                field.people.people(cell)? * share * yielding.get(cell)?
            } else {
                0.0
            },
        )?;
    }
    let mut traditions = std::array::from_fn(|_| None);
    traditions[Tradition::Allegiance as usize] = Some(code.read_only());
    context.run(
        &owner.overlay,
        &Overlay {
            traditions,
            people: people.read_only(),
            hardness: 0.0,
        },
    )
}
pub fn operation(
    questions: Rc<Questions>,
    owner: Rc<operations::Operations<Field>>,
) -> Command<Field, Era> {
    let founding = Command::with_inputs(
        "human.realms.found",
        CommandKind::Event,
        vec![],
        |context, era: &Era| Ok(found(context.state(), era)?),
    );
    let spreading = Command::with_inputs(
        "human.realms.spread",
        CommandKind::Elapsed,
        vec![],
        move |context, era: &Era| spread(context, era, &questions, &owner),
    );
    Command::with_inputs(
        "human.realms.era",
        CommandKind::Elapsed,
        vec![],
        move |context, era: &Era| {
            context.run(&founding, era)?;
            context.run(&spreading, era)
        },
    )
}
