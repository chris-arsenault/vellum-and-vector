use super::{
    country,
    facts::{CONTESTED, KEEPING, RUIN_HOLD},
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
    let held = realm_seats::seats(field, era)?;
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
/// Each cell's realm, and the realm that nearly holds it as firmly, where one does.
struct Falling {
    code: Vec<i32>,
    rival: Vec<i32>,
}
/// How many times harder a realm holds ground `crowding` times fuller than its land feeds, of
/// which `ruined` of the built ground lies in ruin: the old society cycle divided reach by
/// crowding and cut it to a quarter over ruins.
pub fn hard_to_hold(crowding: f64, ruined: f64) -> f64 {
    let crowding = if crowding.is_finite() {
        crowding.max(1.0)
    } else {
        1.0
    };
    crowding / (1.0 - (1.0 - RUIN_HOLD) * ruined.clamp(0.0, 1.0))
}
/// `hard_to_hold` on every cell: its people against what its land feeds, and the ruined
/// share of its built ground.
fn holding_costs(field: &Field, support: &crate::storage::ReadBand<f64>) -> io::Result<Vec<f64>> {
    use crate::human::{catalogue::LayerId, HumanField};
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let ruined = field.people.view(HumanField::RuinedBuiltUp);
    let mut costs = Vec::with_capacity(field.mesh.len());
    for cell in 0..field.mesh.len() {
        let fed = support.get(cell)?;
        let crowding = if fed > 0.0 {
            field.people.people(cell)? / fed
        } else {
            1.0
        };
        let (standing, gone) = (built.get(cell)?, ruined.get(cell)?);
        let share = if standing + gone > 0.0 {
            gone / (standing + gone)
        } else {
            0.0
        };
        costs.push(hard_to_hold(crowding, share));
    }
    Ok(costs)
}
fn falling(
    field: &Field,
    era: &Era,
    held: &[Seat],
    support: &crate::storage::ReadBand<f64>,
) -> io::Result<Falling> {
    let hold = holding_costs(field, support)?;
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
    // A seat holds best the country its own people's crafts know how to work.
    let seekers = held
        .iter()
        .map(|seat| super::seeking::keepers(field, seat.anchor))
        .collect::<io::Result<Vec<_>>>()?;
    let leading = leading_of(field, Tradition::Allegiance)?;
    let mut code = vec![0; field.mesh.len()];
    let mut rival = vec![0; field.mesh.len()];
    for (cell, code) in code.iter_mut().enumerate() {
        let mut normals = Vec::new();
        for (at, cost) in costs.iter().enumerate() {
            let raw = cost.get(cell)?;
            if raw.is_finite() {
                let suited = super::seeking::toward(field, &seekers[at], cell)?;
                normals.push((at, holding_cost(raw, hold[cell], held[at].strength, suited)));
            }
        }
        let incumbent = held.iter().position(|s| s.code == leading.code[cell]);
        let Some((best, close)) = decide(&normals, incumbent) else {
            continue;
        };
        if let Some(other) = close {
            rival[cell] = held[other].code;
        }
        *code = held[best].code;
    }
    Ok(Falling { code, rival })
}
/// What it costs a realm to hold a cell: the going from its seat, as hard as the cell is to
/// hold, over the realm's strength and how well the cell suits its seat's crafts.
pub fn holding_cost(going: f64, hard: f64, strength: f64, suited: f64) -> f64 {
    going * hard / (strength * suited).max(f64::EPSILON)
}
/// Who holds a cell, and who contests it, from each reaching realm's cost of holding it
/// (`normals`, by realm index) and the realm that held it before, if any: the cheapest, unless
/// the realm before still holds it within reach of that, and the cheapest other whose cost comes
/// close to the holder's.
fn decide(normals: &[(usize, f64)], before: Option<usize>) -> Option<(usize, Option<usize>)> {
    let &(cheapest, least) = normals.iter().min_by(|a, b| a.1.total_cmp(&b.1))?;
    let kept = before.and_then(|b| normals.iter().find(|(at, _)| *at == b).copied());
    let (holder, cost) = match kept {
        Some((at, cost)) if least > KEEPING * cost => (at, cost),
        _ => (cheapest, least),
    };
    let rival = normals
        .iter()
        .filter(|(at, other)| *at != holder && cost >= CONTESTED * other)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|&(at, _)| at);
    Some((holder, rival))
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
    let support = context.query(&questions.support)?.values();
    realm_seats::tend(context.state(), era, &support)?;
    record_livelihoods(context, era, questions)?;
    for realm in realm_seats::active(era) {
        realm_seats::follow_the_crowd(context.state(), era, &realm)?;
    }
    let held = realm_seats::seats(context.state(), era)?;
    if held.is_empty() {
        for place in era.places.borrow_mut().known.iter_mut() {
            place.contested_by = None;
        }
        return Ok(());
    }
    let yielding = context.query(&questions.yielding)?.values();
    let field = context.state();
    let fell = falling(field, era, &held, &support)?;
    for place in era.places.borrow_mut().known.iter_mut() {
        place.contested_by = (fell.rival[place.anchor] != 0).then_some(fell.rival[place.anchor]);
    }
    let share = (0.5 * era.capacity * era.years / 100.0).min(1.0);
    let overlay = allegiances(field, &fell.code, share, &yielding)?;
    context.run(&owner.overlay, &overlay)
}
/// The overlay by which each cell's people take up the realm that holds them, `share` of them
/// over the era as far as they yield to it, and by which ground no realm holds (`holders`
/// zero there) forgets its realm at the same pace.
fn allegiances(
    field: &Field,
    holders: &[i32],
    share: f64,
    yielding: &ReadBand<f64>,
) -> io::Result<Overlay> {
    let mut code = field.coverage.borrow_mut().scratch(field.mesh.len(), 0i32);
    let mut people = working(field);
    for (cell, &held) in holders.iter().enumerate() {
        code.set(cell, if held != 0 { held } else { -1 })?;
        let giving = if held != 0 { yielding.get(cell)? } else { 1.0 };
        people.set(cell, field.people.people(cell)? * share * giving)?;
    }
    let mut traditions = std::array::from_fn(|_| None);
    traditions[Tradition::Allegiance as usize] = Some(code.read_only());
    Ok(Overlay {
        traditions,
        people: people.read_only(),
        hardness: 0.0,
    })
}
/// Records on each realm what its people live by this era: the shares of its food from
/// farming, herding, fishing and gathering.
fn record_livelihoods(
    context: &mut CommandContext<'_, Field>,
    era: &Era,
    questions: &Questions,
) -> ExecutionResult<()> {
    let crop = context.query(&questions.crop)?.values();
    let herd = context.query(&questions.herd)?.values();
    let wild = context.query(&questions.wild)?.values();
    let catch = context.query(&questions.catch)?.values();
    let field = context.state();
    let leads = leading_of(field, Tradition::Allegiance)?;
    let realms = realm_seats::active(era);
    let codes: Vec<i32> = realms.iter().map(|r| r.code).collect();
    let shares = super::realm_character::livelihood_shares(
        field,
        &codes,
        &leads.code,
        [&crop, &herd, &wild, &catch],
    )?;
    let mut memory = era.memory.borrow_mut();
    for (code, shares) in codes.into_iter().zip(shares) {
        memory.traditions.known[code as usize - 1].livelihoods = shares;
    }
    Ok(())
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
#[cfg(test)]
mod tests {
    use super::{allegiances, decide, hard_to_hold, holding_cost, RUIN_HOLD};

    #[test]
    fn a_realm_holds_country_its_seats_crafts_suit_more_cheaply() {
        let plain = holding_cost(10.0, 1.0, 2.0, 1.0);
        let suited = holding_cost(10.0, 1.0, 2.0, 1.5);
        let unsuited = holding_cost(10.0, 1.0, 2.0, 0.5);
        assert!(suited < plain && plain < unsuited);
        // Two realms an equal walk away: the one whose crafts suit the ground holds it.
        let (fire, other) = (
            holding_cost(10.0, 1.0, 1.0, 1.4),
            holding_cost(9.0, 1.0, 1.0, 0.8),
        );
        assert_eq!(decide(&[(0, fire), (1, other)], None).unwrap().0, 0);
    }

    #[test]
    fn a_realm_keeps_its_ground_unless_another_holds_it_far_more_cheaply() {
        // Realm 0 held the ground; realm 1 holds it a little more cheaply: 0 keeps it.
        assert_eq!(decide(&[(0, 10.0), (1, 8.0)], Some(0)).unwrap().0, 0);
        // Far more cheaply: 1 takes it.
        assert_eq!(decide(&[(0, 10.0), (1, 5.0)], Some(0)).unwrap().0, 1);
        // Unheld ground goes to the cheapest.
        assert_eq!(decide(&[(0, 10.0), (1, 8.0)], None).unwrap().0, 1);
        // A realm that held it but no longer reaches it keeps nothing.
        assert_eq!(decide(&[(1, 8.0)], Some(0)).unwrap().0, 1);
        assert!(decide(&[], Some(0)).is_none());
    }
    #[test]
    fn a_close_runner_up_contests_the_ground() {
        // The keeper at 10 and a rival at 8: within four fifths, so it is contested.
        assert_eq!(decide(&[(0, 10.0), (1, 8.0)], Some(0)).unwrap().1, Some(1));
        // A distant third does not contest it.
        assert_eq!(decide(&[(0, 10.0), (2, 20.0)], Some(0)).unwrap().1, None);
        // The new holder at 5 against the old at 10 is not close.
        assert_eq!(decide(&[(0, 10.0), (1, 5.0)], Some(0)).unwrap().1, None);
    }
    use crate::{
        execution::Executor,
        field::{people::fixture::*, Field},
        human::identity::{leading, Tradition},
    };

    #[test]
    fn crowded_and_ruined_ground_is_harder_to_hold() {
        assert_eq!(hard_to_hold(0.5, 0.0), 1.0);
        assert_eq!(hard_to_hold(3.0, 0.0), 3.0);
        assert!((hard_to_hold(1.0, 1.0) - 1.0 / RUIN_HOLD).abs() < 1e-12);
        assert_eq!(hard_to_hold(f64::INFINITY, 0.0), 1.0);
    }
    #[test]
    fn held_ground_takes_up_its_realm_and_unreached_ground_forgets_its_own() {
        let (mut taken, mut lost) = (0, 0);
        let field = land(|seed, mesh| {
            taken = point(mesh, 300.0, 500.0);
            lost = point(mesh, 700.0, 500.0);
            people(seed, taken, &[layer(100.0, 1, 0, 4, 0)]);
            people(seed, lost, &[layer(100.0, 1, 0, 4, 0)]);
        });
        let mut holders = vec![0; field.mesh.len()];
        holders[taken] = 5;
        let yielding = band(&field, |_| 0.5);
        let overlay = allegiances(&field, &holders, 0.4, &yielding).unwrap();
        let mut run = Executor::new(field);
        run.run_with(&Field::human_operations().overlay, &overlay)
            .unwrap();
        let field = run.state();
        // Four tenths of the era's people, as far as half of them yield: a fifth take realm 5.
        let column = field.people.column(taken).unwrap();
        assert_eq!(leading(&column, Tradition::Allegiance), (4, 80.0));
        let fifth: f64 = column
            .iter()
            .filter(|l| l.traditions[Tradition::Allegiance as usize] == 5)
            .map(|l| l.people)
            .sum();
        assert!((fifth - 20.0).abs() < 1e-9);
        // Ground no realm holds forgets realm 4 by the same four tenths.
        let column = field.people.column(lost).unwrap();
        assert!((leading(&column, Tradition::Allegiance).1 - 60.0).abs() < 1e-9);
    }
}
