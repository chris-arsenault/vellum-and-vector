//! Exchange beyond food. People make goods where the land offers them the means, and every
//! people wants goods: materials where places offer materials (ore, salt, stone, timber), wares
//! where they offer power (mills, forges, furnaces), and each magic craft's goods where its
//! keepers practise it on its medium. The kinds clear together through the market food uses:
//! makers offer what they make beyond their own wants, every cell asks for what it lacks, and
//! each request takes its share of the supply within reach, discounted by travel. A materials
//! town trades with a wares town, and two towns of different crafts with each other.
//!
//! What a cell sends, and what passes through it on the way, is its trade. Goods travel from
//! their makers up toward the crowds that want them, wearing the ways they take; trade draws
//! people and their food, and raises the wealth a built place gathers toward. No price or stock
//! is kept: each pass reads the trade from the land as it stands.
pub use super::facts::{TRADING, WEALTH};
use super::{
    crafts::{self, CRAFTS},
    facts::{CARRIED, MADE, MAKERS, WANTED_CRAFTED, WANTED_MATERIALS, WANTED_WARES, WORKABLE},
    feed::offer_per_request,
    seeking,
    work::{habitable, km2, working, Work},
};
use crate::{
    field::{poi::values::Benefit, Field},
    storage::Band,
};
use std::io;

/// How many kinds of goods there are: materials, wares and one for each craft.
pub const KINDS: usize = 2 + CRAFTS.len();
/// Goods of every kind, as one amount per kind.
pub type Kinds = [f64; KINDS];
/// The kind of materials, and of wares; each craft's goods follow.
pub const MATERIALS: usize = 0;
pub const WARES: usize = 1;
/// How much of each kind a person wants a year, in goods: the measure every amount here is
/// counted in.
fn wanted(kind: usize) -> f64 {
    match kind {
        MATERIALS => WANTED_MATERIALS,
        WARES => WANTED_WARES,
        // A people wants a little of every craft's goods.
        _ => WANTED_CRAFTED / CRAFTS.len() as f64,
    }
}
fn all_wanted() -> f64 {
    (0..KINDS).map(wanted).sum()
}

/// How much of each kind a cell's people make a year, per km²: as many of them as make goods,
/// as far as the means their land offers employ them. Materials and wares follow the
/// materials and power its places offer; each craft's goods follow its keepers there and how
/// fully its medium lies under them.
pub fn made(field: &Field, cell: usize) -> io::Result<Kinds> {
    let people = field.people.people(cell)?.max(0.0);
    let mut made = [0.0; KINDS];
    if let Some(offers) = field.place_offers() {
        for (kind, benefit) in [(MATERIALS, Benefit::Materials), (WARES, Benefit::Power)] {
            let means = offers.benefit(benefit, cell)?.clamp(0.0, 1.0);
            made[kind] = making(people * MAKERS, means);
        }
    }
    for (craft, share) in seeking::keepers(field, cell)? {
        if let Some(index) = CRAFTS.iter().position(|c| c.code == craft.code) {
            let medium = crafts::medium_at(field, craft, cell)?;
            made[2 + index] = making(people * share * MAKERS, medium);
        }
    }
    Ok(made)
}
/// What `makers` per km² make a year where the means are offered `means` fully.
pub fn making(makers: f64, means: f64) -> f64 {
    makers.max(0.0).min(WORKABLE * means.clamp(0.0, 1.0)) * MADE
}
/// The goods market of one pass, per cell and kind, in goods a year per cell: what each cell
/// brought in and sent out, and how strongly each cell asks for each kind once its requests
/// are felt over the going.
pub struct Market {
    pub brought: Vec<Kinds>,
    pub sent: Vec<Kinds>,
    pub asked_felt: Vec<Kinds>,
}
fn add(into: &mut Kinds, from: &Kinds, passed: f64) {
    for (into, from) in into.iter_mut().zip(from) {
        *into += from * passed;
    }
}
/// Clears every kind over the going, as food clears: makers offer what they make beyond their
/// own wants, every cell asks for what it lacks, each request takes its share of the supply
/// within reach.
pub fn market(field: &Field, work: &Work, made: &[Kinds]) -> io::Result<Market> {
    let cells = field.mesh.len();
    let (mut spare, mut asked) = (vec![[0.0; KINDS]; cells], vec![[0.0; KINDS]; cells]);
    for (cell, made) in made.iter().enumerate().take(cells) {
        if !habitable(field, cell)? {
            continue;
        }
        let (area, people) = (km2(field, cell), field.people.people(cell)?);
        for kind in 0..KINDS {
            let wants = people * wanted(kind);
            spare[cell][kind] = (made[kind] - wants).max(0.0) * area;
            asked[cell][kind] = (wants - made[kind]).max(0.0) * area;
        }
    }
    let sweeps = super::reach::REACH_SWEEPS;
    let asked_felt = work.going.reach_each(&field.mesh, &asked, sweeps, add)?;
    let offered: Vec<Kinds> = (0..cells)
        .map(|c| std::array::from_fn(|k| offer_per_request(spare[c][k], asked_felt[c][k])))
        .collect();
    let reached = work.going.reach_each(&field.mesh, &offered, sweeps, add)?;
    let taken: Vec<Kinds> = (0..cells)
        .map(|c| {
            std::array::from_fn(|k| {
                if reached[c][k] > 0.0 {
                    asked[c][k] * (1.0 / reached[c][k]).min(1.0)
                } else {
                    0.0
                }
            })
        })
        .collect();
    let taken_felt = work.going.reach_each(&field.mesh, &taken, sweeps, add)?;
    Ok(Market {
        brought: (0..cells)
            .map(|c| std::array::from_fn(|k| taken[c][k] * reached[c][k]))
            .collect(),
        sent: (0..cells)
            .map(|c| std::array::from_fn(|k| offered[c][k] * taken_felt[c][k]))
            .collect(),
        asked_felt,
    })
}
/// The cells a maker's goods of `kind` travel through toward those who want them: from the
/// maker, up the going toward where wants of that kind are felt most, until no neighbour lies
/// higher. Like a journey's route, its steps follow the going.
pub fn route(
    field: &Field,
    work: &Work,
    wanting: &[Kinds],
    kind: usize,
    from: usize,
) -> io::Result<Vec<usize>> {
    let mut at = from;
    let mut route = Vec::new();
    for _ in 0..super::reach::REACH_SWEEPS {
        let mut next = None;
        let mut highest = wanting[at][kind];
        for edge in 0..work.going.stride {
            let Some(to) = field.mesh.neighbor(at, edge) else {
                continue;
            };
            let passes = work.going.passed.get(at * work.going.stride + edge)? > 0.0;
            if passes && wanting[to][kind] > highest {
                highest = wanting[to][kind];
                next = Some(to);
            }
        }
        let Some(to) = next else {
            break;
        };
        route.push(to);
        at = to;
    }
    Ok(route)
}
/// A cell's trade per person against what a person wants: what it sent and what passed
/// through it, over all its people's wants.
pub fn turnover(traded: f64, people: f64) -> f64 {
    if people > 0.0 {
        (traded / (people * all_wanted())).max(0.0)
    } else {
        0.0
    }
}
/// How much a cell trading at `turnover` adds to a gain, as a share of `full`: half of it where
/// its people trade as much as they want, approaching all of it as trade grows past that.
pub fn from_trade(turnover: f64, full: f64) -> f64 {
    let t = turnover.max(0.0);
    full * t / (1.0 + t)
}
/// The goods trade of one pass: each cell's turnover, and the goods carried a year through
/// each cell on their way, which wear it as their carriers' journeys do.
pub struct Trade {
    pub turnover: Band<f64>,
    pub carried: Band<f64>,
}
/// Trades every kind of goods over the going.
pub fn trade(field: &Field, work: &Work) -> io::Result<Trade> {
    let cells = field.mesh.len();
    let mut makes = vec![[0.0; KINDS]; cells];
    for (cell, make) in makes.iter_mut().enumerate() {
        if habitable(field, cell)? {
            *make = made(field, cell)?;
        }
    }
    let market = market(field, work, &makes)?;
    let mut carried = working(field);
    let mut traded = working(field);
    for cell in 0..cells {
        for (kind, &sent) in market.sent[cell].iter().enumerate() {
            if sent <= 0.0 {
                continue;
            }
            traded.set(cell, traded.get(cell)? + sent)?;
            for step in route(field, work, &market.asked_felt, kind, cell)? {
                carried.set(step, carried.get(step)? + sent)?;
                traded.set(step, traded.get(step)? + sent)?;
            }
        }
    }
    let mut turnover = working(field);
    for cell in 0..cells {
        let people = field.people.people(cell)? * km2(field, cell);
        turnover.set(cell, self::turnover(traded.get(cell)?, people))?;
    }
    trace(field, &market)?;
    Ok(Trade { turnover, carried })
}
/// The goods a place's people trade a year, over its cells: what they send and what passes
/// through their markets.
pub fn traded_by(field: &Field, trade: &Trade, cells: &[usize]) -> io::Result<f64> {
    let mut goods = 0.0;
    for &cell in cells.iter().filter(|&&c| c < field.mesh.len()) {
        let people = field.people.people(cell)? * km2(field, cell);
        goods += trade.turnover.get(cell)? * people * all_wanted();
    }
    Ok(goods)
}
/// What changed hands this pass, written to the server log when `ATLAS_TRACE_PEOPLE` is set:
/// the goods of each kind sent, and the share of all wants met by trade.
fn trace(field: &Field, market: &Market) -> io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none() {
        return Ok(());
    }
    let mut sent = [0.0; KINDS];
    for cell in &market.sent {
        add(&mut sent, cell, 1.0);
    }
    let mut wants = 0.0;
    for cell in 0..field.mesh.len() {
        wants += field.people.people(cell)? * km2(field, cell) * all_wanted();
    }
    let all: f64 = sent.iter().sum();
    eprintln!(
        "{}",
        serde_json::json!({"event": "people.trade", "details": {
            "sentByKind": sent.map(f64::round),
            "shareOfWantsTraded": (all / wants.max(f64::EPSILON) * 1000.0).round() / 1000.0}})
    );
    Ok(())
}
/// Trades every kind of goods this pass: holds each cell's turnover on the field, where the
/// `draw` and `wealth` questions read it, and wears the ways the goods travel. Loose peoples
/// trade nothing, so their passes hold no turnover.
pub fn operation(
    owner: std::rc::Rc<crate::human::operations::Operations<Field>>,
) -> crate::execution::Command<Field, super::land::WorkInput> {
    crate::execution::Command::with_inputs(
        "human.land.trade",
        crate::execution::CommandKind::Work,
        vec![],
        move |context, input: &super::land::WorkInput| {
            let work = input.borrow();
            if !work.facts.farms {
                context.state_mut().goods_turnover = None;
                return Ok(());
            }
            let field = context.state();
            let traded = trade(field, &work)?;
            let mut worn = working(field);
            for cell in 0..field.mesh.len() {
                worn.set(cell, traded.carried.get(cell)? / CARRIED * work.facts.years)?;
            }
            drop(work);
            context.state_mut().goods_turnover = Some(traded.turnover);
            context.run(&owner.travel, &worn.read_only())
        },
    )
}
/// How trade reaches the rest of the census: a trading cell draws people more strongly than
/// its places alone would, and its built ground gathers toward more wealth. Both read the
/// turnover the latest trading pass held. The census's processes ask these questions and never
/// call into the goods trade; only the era's place record measures trade, to publish it.
pub fn respond(
    book: &mut crate::answers::QuestionBook<Field, &'static str>,
) -> crate::execution::ExecutionResult<()> {
    use crate::answers::{Responder, ResponseKind};
    for (key, full) in [("draw", TRADING), ("wealth", WEALTH)] {
        book.respond(
            key,
            Responder {
                by: "the goods traded here".into(),
                queries: vec![],
                kind: ResponseKind::Scale(Box::new(move |field, cell, _| {
                    Ok(1.0 + from_trade(field.goods_turnover(cell)?, full))
                })),
            },
        )?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        field::{people::fixture::*, poi::offered::PlaceOffers, shared::Scalar},
        human::HumanField,
    };
    use std::rc::Rc;

    /// Two towns `apart` units apart on the middle row, and a third far to the north.
    fn towns(apart: f64, keeping: [i32; 2]) -> (Field, usize, usize, usize) {
        let (mut west, mut east, mut far) = (0, 0, 0);
        let field = land(|seed, mesh| {
            west = point(mesh, 500.0 - apart / 2.0, 500.0);
            east = point(mesh, 500.0 + apart / 2.0, 500.0);
            far = point(mesh, 500.0, 950.0);
            people(seed, west, &[layer(1000.0, 1, 0, 0, keeping[0])]);
            people(seed, east, &[layer(1000.0, 1, 0, 0, keeping[1])]);
            people(seed, far, &[layer(1000.0, 1, 0, 0, 0)]);
        });
        (field, west, east, far)
    }
    fn offering(field: &mut Field, given: &[crate::field::poi::offered::TestOffer<'_>]) {
        field.place_offers = Some(Rc::new(PlaceOffers::of(field, given).unwrap()));
    }
    fn makes(field: &Field) -> Vec<Kinds> {
        (0..field.mesh.len())
            .map(|c| made(field, c).unwrap())
            .collect()
    }
    fn total(kinds: &[Kinds], kind: usize) -> f64 {
        kinds.iter().map(|k| k[kind]).sum()
    }

    #[test]
    fn a_mine_employs_so_many_however_many_live_around_it() {
        // A city over a thin vein makes less than a village over a rich one.
        assert!(making(1000.0 * MAKERS, 0.1) < making(100.0 * MAKERS, 1.0));
        // Where the means suffice, the makers are the limit.
        assert_eq!(making(10.0, 1.0), 10.0 * MADE);
        assert_eq!(making(10.0, 0.0), 0.0);
    }
    #[test]
    fn a_mining_town_sends_materials_to_its_neighbour_and_every_good_arrives() {
        let (mut field, mine, farm, far) = towns(40.0, [0, 0]);
        offering(
            &mut field,
            &[(Benefit::Materials, &|c| if c == mine { 1.0 } else { 0.0 })],
        );
        let work = plain_work(&field);
        let market = market(&field, &work, &makes(&field)).unwrap();
        assert!(market.sent[mine][MATERIALS] > 0.0);
        assert!(market.brought[farm][MATERIALS] > 0.0);
        assert_eq!(market.sent[farm][MATERIALS], 0.0);
        assert!(market.brought[far][MATERIALS] < 1e-3 * market.brought[farm][MATERIALS]);
        // No wares or craft goods are made, so none move.
        assert_eq!(total(&market.sent, WARES), 0.0);
        let (sent, brought) = (
            total(&market.sent, MATERIALS),
            total(&market.brought, MATERIALS),
        );
        assert!(
            (sent - brought).abs() < 1e-6 * sent,
            "sent {sent} brought {brought}"
        );
    }
    #[test]
    fn every_good_arrives_through_a_door_too() {
        let (mut field, mine, farm, far) = towns(40.0, [0, 0]);
        offering(
            &mut field,
            &[(Benefit::Materials, &|c| if c == mine { 1.0 } else { 0.0 })],
        );
        let door = crate::links::Link {
            a: mine,
            b: far,
            cost: field.mesh.spacing(),
        };
        let work = work_with(
            &field,
            crate::field::people::facts::Facts::settled(100.0, 1.0),
            &[door],
        );
        let market = market(&field, &work, &makes(&field)).unwrap();
        // The door brings the far town within the mine's reach.
        assert!(market.brought[far][MATERIALS] > 0.0);
        assert!(market.brought[farm][MATERIALS] > 0.0);
        let (sent, brought) = (
            total(&market.sent, MATERIALS),
            total(&market.brought, MATERIALS),
        );
        assert!(
            (sent - brought).abs() < 1e-6 * sent,
            "sent {sent} brought {brought}"
        );
    }
    #[test]
    fn towns_of_different_crafts_trade_both_ways() {
        let (fire, salt) = (CRAFTS[0], CRAFTS[4]);
        assert_eq!(
            (fire.medium, salt.medium),
            (Scalar::Quickening, Scalar::Salting)
        );
        let (field, forge, rake, _) = {
            let (mut west, mut east, mut far) = (0, 0, 0);
            let field = land(|seed, mesh| {
                west = point(mesh, 480.0, 500.0);
                east = point(mesh, 520.0, 500.0);
                far = point(mesh, 500.0, 950.0);
                people(
                    seed,
                    west,
                    &[layer(500.0, 1, 0, 0, fire.code), layer(500.0, 1, 0, 0, 0)],
                );
                people(
                    seed,
                    east,
                    &[layer(500.0, 1, 0, 0, salt.code), layer(500.0, 1, 0, 0, 0)],
                );
                seed.shared
                    .scalar_mut(Scalar::Quickening)
                    .set(west, 1.0)
                    .unwrap();
                seed.shared
                    .scalar_mut(Scalar::Salting)
                    .set(east, 1.0)
                    .unwrap();
            });
            (field, west, east, far)
        };
        let work = plain_work(&field);
        let market = market(&field, &work, &makes(&field)).unwrap();
        let (fire_goods, salt_goods) = (2, 2 + 4);
        assert!(market.sent[forge][fire_goods] > 0.0 && market.brought[rake][fire_goods] > 0.0);
        assert!(market.sent[rake][salt_goods] > 0.0 && market.brought[forge][salt_goods] > 0.0);
    }
    #[test]
    fn a_town_making_part_of_its_wants_asks_only_for_the_rest() {
        let (mut field, west, east, _) = towns(40.0, [0, 0]);
        // A thin vein under the west town: it makes some materials, less than its wants.
        let wants = 1000.0 * wanted(MATERIALS);
        let means = 0.5 * wants / (WORKABLE * MADE);
        offering(
            &mut field,
            &[(Benefit::Materials, &move |c| {
                if c == west {
                    means
                } else {
                    0.0
                }
            })],
        );
        let made = makes(&field);
        assert!((made[west][MATERIALS] - 0.5 * wants).abs() < 1e-9);
        let market = market(&field, &plain_work(&field), &made).unwrap();
        assert_eq!(market.sent[west][MATERIALS], 0.0);
        assert_eq!(market.sent[east][MATERIALS], 0.0);
    }
    #[test]
    fn goods_travel_toward_those_who_want_them_and_wear_that_way() {
        use crate::execution::Executor;
        let (mut field, mine, farm, far) = towns(40.0, [0, 0]);
        offering(
            &mut field,
            &[(Benefit::Materials, &|c| if c == mine { 1.0 } else { 0.0 })],
        );
        let way = {
            let work = plain_work(&field);
            let market = market(&field, &work, &makes(&field)).unwrap();
            route(&field, &work, &market.asked_felt, MATERIALS, mine).unwrap()
        };
        assert_eq!(
            way.last(),
            Some(&farm),
            "the goods' way ends at the town that wants them"
        );
        let work = Rc::new(std::cell::RefCell::new(plain_work(&field)));
        let mut run = Executor::new(field);
        run.run_with(&operation(Rc::new(Field::human_operations())), &work)
            .unwrap();
        let field = run.state();
        let walked = field.people.view(HumanField::WalkedRoute);
        for &cell in &way {
            assert!(
                walked.get(cell).unwrap() > 0.0,
                "the way to the farm is worn"
            );
        }
        let behind = at(field, 480.0 - 3.0 * field.mesh.spacing(), 500.0);
        assert_eq!(
            walked.get(behind).unwrap(),
            0.0,
            "no goods go away from those who want them"
        );
        assert_eq!(walked.get(far).unwrap(), 0.0);
    }
    /// The `draw` and `wealth` answers in each cell, from the people's question book as every
    /// run registers it, over ground without rivers.
    fn answers(run: &mut crate::execution::Executor<Field>) -> [crate::storage::ReadBand<f64>; 2] {
        let mut book = crate::answers::QuestionBook::default();
        let rivers = crate::execution::Query::new("rivers", vec![], |field: &Field, _| {
            Ok(field
                .coverage
                .borrow_mut()
                .scratch(field.mesh.len(), 0u32)
                .read_only())
        });
        run.select(&rivers);
        crate::atlas::questions::register_people(&mut book, rivers).unwrap();
        let book = Rc::new(book);
        ["draw", "wealth"].map(|key| {
            let question = Field::question(book.clone(), key, key);
            run.select(&question);
            run.query(&question).unwrap().values()
        })
    }
    #[test]
    fn trade_reaches_the_census_only_through_the_questions_it_answers() {
        use crate::execution::Executor;
        let (mut field, mine, farm, far) = towns(40.0, [0, 0]);
        offering(
            &mut field,
            &[(Benefit::Materials, &|c| if c == mine { 1.0 } else { 0.0 })],
        );
        let work = Rc::new(std::cell::RefCell::new(plain_work(&field)));
        let mut run = Executor::new(field);
        let [draw_before, wealth_before] = answers(&mut run);
        run.run_with(&operation(Rc::new(Field::human_operations())), &work)
            .unwrap();
        let [draw, wealth] = answers(&mut run);
        // The mine and the market its goods are sold in draw more and grow richer.
        for cell in [mine, farm] {
            assert!(draw.get(cell).unwrap() > draw_before.get(cell).unwrap());
            assert!(wealth.get(cell).unwrap() > wealth_before.get(cell).unwrap());
        }
        // Where nothing changes hands, trade changes neither answer.
        assert_eq!(draw.get(far).unwrap(), draw_before.get(far).unwrap());
        assert_eq!(wealth.get(far).unwrap(), 1.0);
    }
    #[test]
    fn a_village_that_only_buys_gains_no_trade_of_its_own() {
        let (mut mine, mut market_town, mut village) = (0, 0, 0);
        let mut field = land(|seed, mesh| {
            mine = point(mesh, 480.0, 500.0);
            market_town = point(mesh, 520.0, 500.0);
            village = point(mesh, 500.0, 470.0);
            people(seed, mine, &[layer(1000.0, 1, 0, 0, 0)]);
            people(seed, market_town, &[layer(2000.0, 1, 0, 0, 0)]);
            people(seed, village, &[layer(100.0, 1, 0, 0, 0)]);
        });
        offering(
            &mut field,
            &[(Benefit::Materials, &|c| if c == mine { 1.0 } else { 0.0 })],
        );
        let work = plain_work(&field);
        let market = market(&field, &work, &makes(&field)).unwrap();
        let way = route(&field, &work, &market.asked_felt, MATERIALS, mine).unwrap();
        assert!(market.brought[village][MATERIALS] > 0.0, "the village buys");
        assert!(!way.contains(&village), "the goods' way does not pass it");
        let traded = trade(&field, &work).unwrap();
        assert_eq!(traded.turnover.get(village).unwrap(), 0.0);
        assert!(traded.turnover.get(market_town).unwrap() > 0.0);
    }
    #[test]
    fn loose_peoples_do_not_trade() {
        use crate::execution::Executor;
        let (mut field, mine, _, _) = towns(40.0, [0, 0]);
        offering(
            &mut field,
            &[(Benefit::Materials, &|c| if c == mine { 1.0 } else { 0.0 })],
        );
        // Trade an earlier settled pass held does not outlast a loose one.
        let earlier = field.coverage.borrow_mut().scratch(field.mesh.len(), 1.0);
        field.goods_turnover = Some(earlier);
        let loose = crate::field::people::facts::Facts::loose(100.0);
        let work = Rc::new(std::cell::RefCell::new(work_with(&field, loose, &[])));
        let mut run = Executor::new(field);
        run.run_with(&operation(Rc::new(Field::human_operations())), &work)
            .unwrap();
        assert_eq!(run.state().goods_turnover(mine).unwrap(), 0.0);
    }
    #[test]
    fn trade_adds_half_a_gain_at_full_trade_and_never_all_of_it() {
        assert_eq!(turnover(0.0, 100.0), 0.0);
        assert_eq!(turnover(10.0, 0.0), 0.0);
        assert_eq!(from_trade(0.0, 0.6), 0.0);
        assert!((from_trade(1.0, 0.6) - 0.3).abs() < 1e-12);
        assert!(from_trade(100.0, 0.6) < 0.6);
    }
}
