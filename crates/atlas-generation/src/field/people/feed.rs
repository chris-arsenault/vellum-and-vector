// Arconis: docs/architecture/subsystems.arconis#item=pp_feed — puts land to crops and herds to feed people.
use super::{
    contract::{Absent, Condition, Contract, EffectTime, Product, Source, Strategy},
    facts::*,
    land::{mix, WorkInput},
    questions::Questions,
    work::{habitable, km2, working, Work},
};
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandContext, CommandKind, ExecutionResult, Query},
    field::Field,
    human::{
        catalogue::{LayerId, LayerMode},
        operations::{self, Lay, Wear},
    },
    storage::{Band, ReadBand},
};
use std::{io, rc::Rc};

#[derive(Clone, Copy)]
pub enum Feeding {
    Elapsed,
    Present,
}

#[derive(Clone, Copy)]
pub enum FoodStart {
    WorkedLandSupply,
}
impl Source for FoodStart {
    type Value = Query<Field, AnswerBand>;
}

#[derive(Clone, Copy)]
pub enum OutsideSupply {
    ReachableParentBalance,
}
impl Source for OutsideSupply {
    type Value = Market;
}

pub type Provision = Strategy<Feeding, FoodStart, OutsideSupply>;

const START: Condition<FoodStart> = Condition::From {
    source: FoodStart::WorkedLandSupply,
    absent: Absent::Error("Provisioning requires the working field's food support"),
};

const HISTORICAL: Provision = Strategy {
    name: "era-provision",
    time: EffectTime::Elapsed,
    slot: "people pass before demographic response and movement",
    initial: START,
    boundary: Condition::None,
    algorithm: Feeding::Elapsed,
};
const PRESENT: Provision = Strategy {
    name: "current-provision",
    time: EffectTime::SpatialIteration,
    slot: "people pass before movement and built-ground response",
    initial: START,
    boundary: Condition::From {
        source: OutsideSupply::ReachableParentBalance,
        absent: Absent::Empty,
    },
    algorithm: Feeding::Present,
};

pub const PROVISION: Contract<Feeding, FoodStart, OutsideSupply> = Contract {
    id: "human.land.feed",
    effect: "Work land for food and deliver it to households that need it",
    reads: &[
        Product::Layer(LayerId::Population),
        Product::Question("support"),
        Product::Question("cropYield"),
        Product::Question("herdYield"),
        Product::Question("wildYield"),
        Product::Question("draw"),
        Product::Travel,
        Product::OutsideFood,
    ],
    writes: &[
        Product::Layer(LayerId::Farmland),
        Product::Layer(LayerId::Pasture),
        Product::NetFoodImports,
        Product::FoodShortfall,
    ],
    catalog_id: "human.land.feed",
    strategies: &[HISTORICAL, PRESENT],
};

struct Felt {
    hunger: Band<f64>,
    spare: Band<f64>,
    hunger_felt: Band<f64>,
    spare_felt: Band<f64>,
}

/// Food available outside the working footprint and the requests it already faces,
/// both measured in residents fed per year.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Market {
    pub surplus: f64,
    pub demand: f64,
}

#[derive(Clone, Copy)]
pub struct Connection {
    pub cell: usize,
    pub area_km2: f64,
    pub customers: f64,
    pub balance: Market,
}

fn provisions(
    strategy: Provision,
    years: f64,
    outside: Option<Market>,
) -> io::Result<(f64, Option<Market>)> {
    let imports = strategy.boundary.bind(|source| match source {
        OutsideSupply::ReachableParentBalance => Ok(outside),
    })?;
    Ok(match strategy.algorithm {
        Feeding::Elapsed => ((GROWTH_RATE * years).exp_m1(), None),
        Feeding::Present => (0.0, Some(imports.unwrap_or_default())),
    })
}

impl Market {
    fn fraction(self, local_demand: f64) -> f64 {
        let competing_demand = self.demand + local_demand;
        if competing_demand > 0.0 {
            (self.surplus / competing_demand).min(1.0)
        } else {
            0.0
        }
    }
}

/// Harvest available to trade, in residents fed per square kilometre.
fn market_supply(living: f64, support: f64) -> f64 {
    if living > 0.0 {
        (support - living).max(0.0)
    } else {
        0.0
    }
}
fn feel(field: &Field, work: &Work, support: &ReadBand<f64>, margin: f64) -> io::Result<Felt> {
    let mut felt = Felt {
        hunger: working(field),
        spare: working(field),
        hunger_felt: working(field),
        spare_felt: working(field),
    };
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        let living = field.people.people(cell)?;
        let fed = support.get(cell)?;
        felt.hunger.set(
            cell,
            (living * (1.0 + margin) - fed).max(0.0) * km2(field, cell),
        )?;
        felt.spare
            .set(cell, MARKET_SHARE * living.min(fed) * km2(field, cell))?;
    }
    work.reach(field, &felt.hunger, &mut felt.hunger_felt)?;
    work.reach(field, &felt.spare, &mut felt.spare_felt)?;
    Ok(felt)
}
fn clear(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
    growth: f64,
    support: &ReadBand<f64>,
) -> ExecutionResult<()> {
    let felt = feel(context.state(), work, support, growth)?;
    let crop = context.query(&q.crop)?.values();
    let herd = context.query(&q.herd)?.values();
    let wild = context.query(&q.wild)?.values();
    let field = context.state();
    let mut crops = working(field);
    let mut herds = working(field);
    let mut idle = working(field);
    let rate = 1.0 - (-work.facts.years / CLEARING_YEARS).exp();
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? || field.people.people(cell)? <= 0.0 {
            continue;
        }
        let wanted =
            (felt.hunger_felt.get(cell)? - felt.spare_felt.get(cell)?) / work.land.get(cell)?;
        let farmed = crop.get(cell)? >= herd.get(cell)?;
        let gain = crop.get(cell)?.max(herd.get(cell)?) - wild.get(cell)?;
        if wanted > 0.0 && gain > 0.0 {
            let band = if farmed { &mut crops } else { &mut herds };
            band.set(
                cell,
                rate * field.people.free_area(cell)?.min(wanted / gain),
            )?;
        } else if wanted < 0.0 {
            idle.set(
                cell,
                work.facts.years / CLEARING_YEARS
                    * ((felt.spare_felt.get(cell)? - felt.hunger_felt.get(cell)?)
                        / felt.spare_felt.get(cell)?)
                    .min(1.0),
            )?;
        }
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::Farmland,
            amount: crops.read_only(),
        },
    )?;
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::Pasture,
            amount: herds.read_only(),
        },
    )?;
    context.run(
        &owner.wear,
        &Wear {
            mix: mix(LayerMode::Fallow),
            intensity: idle.read_only(),
        },
    )
}
/// How much more strongly a cell draws people than the country around it: its draw per
/// person against the draw per person within the travel reach. Offers felt everywhere alike
/// cancel; a seat or harbour above its country raises it.
pub fn relative_draw(here: f64, people: f64, around: f64, around_people: f64) -> f64 {
    if people <= 0.0 || around <= 0.0 || around_people <= 0.0 {
        return 1.0;
    }
    ((here / people) / (around / around_people)).max(0.0)
}
fn food_requests(
    field: &Field,
    work: &Work,
    support: &ReadBand<f64>,
    draw: &ReadBand<f64>,
) -> std::io::Result<(Band<f64>, Band<f64>)> {
    let mut demand = working(field);
    let mut demand_felt = working(field);
    let mut drawing = working(field);
    let mut drawing_felt = working(field);
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            demand.set(cell, field.people.people(cell)? * km2(field, cell))?;
            // A town orders food for the arrivals it draws, by its places, trade or anything
            // else that answers the `draw` question.
            drawing.set(cell, draw.get(cell)? * km2(field, cell))?;
        }
    }
    work.reach(field, &demand, &mut demand_felt)?;
    work.reach(field, &drawing, &mut drawing_felt)?;
    let mut traced = Strongest::default();
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        let area = work.land.get(cell)?;
        let people = field.people.people(cell)?;
        let surrounding = if area > 0.0 {
            demand_felt.get(cell)? / area
        } else {
            people
        };
        let relative = relative_draw(
            draw.get(cell)?,
            people,
            drawing_felt.get(cell)?,
            demand_felt.get(cell)?,
        );
        let wanted = market_demand(people, people * relative, support.get(cell)?, surrounding);
        demand.set(cell, wanted * km2(field, cell))?;
        if relative > 1.0 {
            traced.offer(Drawing {
                weight: relative * people * km2(field, cell),
                cell,
                people,
                relative,
                surrounding,
                wanted,
            });
        }
    }
    traced.write(field, support)?;
    work.reach(field, &demand, &mut demand_felt)?;
    Ok((demand, demand_felt))
}
/// One cell drawing above its country, as the food trace reports it.
#[derive(Clone, Copy)]
struct Drawing {
    weight: f64,
    cell: usize,
    people: f64,
    relative: f64,
    surrounding: f64,
    wanted: f64,
}
/// The eight cells drawing most above their country, written to the server log when
/// `ATLAS_TRACE_PEOPLE` is set: their people, relative draw, country density, local food and
/// the food their markets order. It keeps only the strongest eight, without sorting cells.
#[derive(Default)]
struct Strongest {
    kept: Vec<Drawing>,
}
impl Strongest {
    fn offer(&mut self, drawing: Drawing) {
        if self.kept.len() < 8 {
            self.kept.push(drawing);
            return;
        }
        let weakest = (0..self.kept.len()).fold(0, |w, i| {
            if self.kept[i].weight < self.kept[w].weight {
                i
            } else {
                w
            }
        });
        if drawing.weight > self.kept[weakest].weight {
            self.kept[weakest] = drawing;
        }
    }
    fn write(&self, field: &Field, support: &ReadBand<f64>) -> std::io::Result<()> {
        if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none() {
            return Ok(());
        }
        let [ox, oy] = field.mesh.origin();
        let mut top = Vec::new();
        for d in &self.kept {
            let [x, y] = field.mesh.position(d.cell);
            top.push(serde_json::json!({
                "at": [(x + ox).round(), (y + oy).round()], "weight": d.weight.round(),
                "perKm2": d.people.round(), "relativeDraw": (d.relative * 100.0).round() / 100.0,
                "countryPerKm2": d.surrounding.round(), "fedPerKm2": support.get(d.cell)?.round(),
                "ordersPerKm2": d.wanted.round(),
            }));
        }
        eprintln!(
            "{}",
            serde_json::json!({"event": "people.drawing", "details": {"top": top}})
        );
        Ok(())
    }
}

fn share(
    context: &CommandContext<'_, Field>,
    work: &mut Work,
    q: &Questions,
    market: Option<Market>,
) -> ExecutionResult<()> {
    let field = context.state();
    let support = context.query(&q.support)?.values();
    let draw = context.query(&q.draw)?.values();
    let (demand, demand_felt) = food_requests(field, work, &support, &draw)?;
    let mut offered = working(field);
    let mut reached = working(field);
    let mut taken = working(field);
    let mut taken_felt = working(field);
    let mut unmet = 0.0;
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? && demand_felt.get(cell)? > 0.0 {
            let available =
                market_supply(field.people.people(cell)?, support.get(cell)?) * km2(field, cell);
            offered.set(cell, offer_per_request(available, demand_felt.get(cell)?))?;
        }
    }
    work.reach(field, &offered, &mut reached)?;
    for cell in 0..field.mesh.len() {
        if reached.get(cell)? > 0.0 {
            taken.set(
                cell,
                demand.get(cell)? * (1.0 / reached.get(cell)?).min(1.0),
            )?;
        }
    }
    work.reach(field, &taken, &mut taken_felt)?;
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        let brought = taken.get(cell)? * reached.get(cell)?;
        let sent = offered.get(cell)? * taken_felt.get(cell)?;
        let unfilled = (demand.get(cell)? - brought).max(0.0);
        taken.set(cell, unfilled)?;
        unmet += unfilled;
        work.imports
            .set(cell, (brought - sent) / km2(field, cell))?;
    }
    if let Some(market) = market {
        deliver_imports(field, work, market, &taken, unmet)?;
    }
    Ok(())
}

fn deliver_imports(
    field: &Field,
    work: &mut Work,
    market: Market,
    unfilled: &Band<f64>,
    unmet: f64,
) -> std::io::Result<()> {
    let mut felt = working(field);
    work.reach(field, unfilled, &mut felt)?;
    let mut offers = working(field);
    for gate in work.connections.iter() {
        let orders = felt.get(gate.cell)?;
        offers.set(
            gate.cell,
            offers.get(gate.cell)? + gate.balance.fraction(orders),
        )?;
    }
    let mut access = working(field);
    work.reach(field, &offers, &mut access)?;
    let mut requested = 0.0;
    for cell in 0..field.mesh.len() {
        requested += unfilled.get(cell)? * access.get(cell)?.min(1.0);
    }
    let filled = if requested > 0.0 {
        (market.surplus / requested).min(1.0)
    } else {
        0.0
    };
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            let delivered =
                filled * unfilled.get(cell)? * access.get(cell)?.min(1.0) / km2(field, cell);
            work.imports
                .set(cell, work.imports.get(cell)? + delivered)?;
        }
    }
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_some() {
        eprintln!(
            "{}",
            serde_json::json!({"event": "people.external-food",
                "offered": market.surplus.round(),
                "outsideDemand": market.demand.round(),
                "delivered": (filled * requested).round(),
                "unmet": (unmet - filled * requested).round(),
            })
        );
    }
    Ok(())
}

/// Travel discounts requests before they reach the supplier. A faint request
/// across a costly route cannot claim the entire harvest by being the only bid.
pub(super) fn offer_per_request(available: f64, reachable_requests: f64) -> f64 {
    if reachable_requests > 0.0 {
        (available / reachable_requests).min(1.0)
    } else {
        0.0
    }
}

/// Existing urban concentration can commission food for additional households.
/// Local food first covers current residents and any growth it can already feed.
/// `drawn` is the crowd the place draws as: its people, raised by how much more its places
/// draw than the country around, so a seat or harbour orders food for those who will come.
fn market_demand(living: f64, drawn: f64, support: f64, surrounding: f64) -> f64 {
    // Potential arrivals come from the surrounding population. An established
    // city cannot commission a second city of its own size from empty land.
    let arrivals = (drawn - surrounding).max(0.0).min(surrounding);
    (living + arrivals - support).max(0.0)
}
pub(crate) fn operation(
    q: Rc<Questions>,
    owner: Rc<operations::Operations<Field>>,
) -> Command<Field, WorkInput<Provision>> {
    Command::with_inputs(
        PROVISION.id,
        CommandKind::Work,
        vec![],
        move |context, input: &WorkInput<Provision>| {
            let mut work = input.work.borrow_mut();
            let feeding = input.strategy;
            if !work.facts.farms {
                return Ok(());
            }
            let start = feeding
                .initial
                .bind(|source| match source {
                    FoodStart::WorkedLandSupply => Ok(Some(q.support.clone())),
                })?
                .ok_or_else(|| io::Error::other("Provisioning has no initial food condition"))?;
            let support = context.query(&start)?.values();
            let (growth, market) = provisions(feeding, work.facts.years, work.outside_market)?;
            match feeding.algorithm {
                Feeding::Elapsed => clear(context, &work, &q, &owner, growth, &support)?,
                Feeding::Present => {
                    for (kind, question) in
                        [(LayerId::Farmland, &q.crop), (LayerId::Pasture, &q.herd)]
                    {
                        let yield_at = context.query(question)?.values();
                        let field = context.state();
                        let built = field
                            .people
                            .view(crate::human::HumanField::Layer(LayerId::BuiltUp));
                        let stock = field.people.view(crate::human::HumanField::Layer(kind));
                        let mut value = working(field);
                        for cell in 0..field.mesh.len() {
                            if habitable(field, cell)? {
                                let labor = field.people.people(cell)?.sqrt();
                                let demand = field.goods_turnover(cell)?.ln_1p();
                                value.set(
                                    cell,
                                    yield_at.get(cell)?
                                        * (1.0 - built.get(cell)?).max(0.0)
                                        * (1.0 + labor / (1.0 + labor))
                                        * (1.0 + demand)
                                        / (1.0 + super::hazards::exposure(field, cell)?),
                                )?;
                            }
                        }
                        super::gather::distribute(context, &work, &owner, kind, &stock, &value)?;
                    }
                }
            }
            share(context, &mut work, &q, market)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{super::yields::cultivated_yield, market_supply};

    #[test]
    fn contract_provisions_present_households_from_a_finite_market() {
        use super::*;
        use crate::field::people::contract::{MapType, ScaleBand, Site, Timing};

        let capture = Market {
            surplus: 60.0,
            demand: 40.0,
        };
        for &kind in MapType::REGIONAL {
            let site = Site {
                map_type: kind,
                cell_metres: 50.0,
            };
            let strategy = PROVISION
                .select(site, Timing::Present)
                .unwrap()
                .into_iter()
                .next()
                .unwrap();
            assert_eq!(strategy.time, EffectTime::SpatialIteration);
            assert!(matches!(
                strategy.initial.source(),
                Some(FoodStart::WorkedLandSupply)
            ));
            let (growth, market) = provisions(strategy, 250.0, Some(capture)).unwrap();
            assert_eq!(growth, 0.0);
            assert_eq!(market, Some(capture));
            assert_eq!(market.unwrap().fraction(80.0), 0.5);
            assert_eq!(
                provisions(strategy, 250.0, None).unwrap(),
                (0.0, Some(Market::default()))
            );
            assert!(PROVISION.select(site, Timing::Elapsed).unwrap().is_empty());
        }
        let world = Site {
            map_type: MapType::World,
            cell_metres: ScaleBand::World.endpoints().0,
        };
        let historical = PROVISION
            .select(world, Timing::Elapsed)
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert_eq!(historical.time, EffectTime::Elapsed);
        assert!(matches!(historical.boundary, Condition::None));
        let (growth, market) = provisions(historical, 250.0, Some(capture)).unwrap();
        assert!(growth > 0.0);
        assert_eq!(market, None);
    }

    #[test]
    fn productive_hinterlands_can_provision_capitals_and_exceptional_markets() {
        // Sixty rural residents per square kilometre, 65% cultivated, with
        // soil, water and terrain giving 60% of ideal growing conditions.
        let provision = market_supply(60.0, 0.65 * cultivated_yield(0.6));
        assert!((300_000.0..500_000.0).contains(&(7_000.0 * provision)));
        assert!(40_000.0 * provision > 2_000_000.0);
        assert!(cultivated_yield(0.05) < 3.0);
        assert_eq!(cultivated_yield(0.0), 0.0);
    }

    #[test]
    fn food_offers_require_producers_and_stay_within_their_yield() {
        assert_eq!(market_supply(0.0, 100.0), 0.0);
        assert_eq!(market_supply(100.0, 0.0), 0.0);
        assert_eq!(market_supply(100.0, 20.0), 0.0);
        assert!(market_supply(20.0, 100.0) >= 80.0);
    }

    #[test]
    fn urban_demand_anticipates_arrivals_only_where_people_concentrate() {
        use super::market_demand;
        assert_eq!(market_demand(50.0, 50.0, 50.0, 50.0), 0.0);
        assert_eq!(market_demand(50.0, 50.0, 35.0, 50.0), 15.0);
        assert_eq!(market_demand(100.0, 100.0, 100.0, 50.0), 50.0);
        assert_eq!(market_demand(100.0, 100.0, 160.0, 50.0), 0.0);
        assert_eq!(market_demand(1_000.0, 1_000.0, 1_000.0, 50.0), 50.0);
    }

    #[test]
    fn a_place_that_draws_above_its_country_orders_food_for_arrivals() {
        use super::{market_demand, relative_draw};
        assert_eq!(relative_draw(500.0, 100.0, 5_000.0, 1_000.0), 1.0);
        assert_eq!(relative_draw(1_250.0, 100.0, 5_000.0, 1_000.0), 2.5);
        let drawn = 60.0 * relative_draw(150.0, 60.0, 1_000.0, 1_000.0);
        assert!(market_demand(60.0, drawn, 60.0, 50.0) > market_demand(60.0, 60.0, 60.0, 50.0));
        assert_eq!(relative_draw(10.0, 0.0, 1.0, 1.0), 1.0);
    }

    #[test]
    fn rival_markets_share_an_offer_and_a_distant_request_stays_discounted() {
        use super::offer_per_request;
        let nearby = 1_000.0;
        let distant = 1_000.0 * 0.1;
        let offer = offer_per_request(550.0, nearby + distant);
        assert_eq!(nearby * offer, 500.0);
        assert_eq!(distant * offer, 50.0);
        assert_eq!(distant * offer_per_request(550.0, distant), 100.0);
        assert_eq!(offer_per_request(550.0, 0.0), 0.0);
    }

    #[test]
    fn outside_supply_faces_outside_and_inside_orders() {
        let market = super::Market {
            surplus: 120.0,
            demand: 200.0,
        };
        assert_eq!(market.fraction(100.0), 0.4);
        assert_eq!(super::Market::default().fraction(100.0), 0.0);
    }
}
