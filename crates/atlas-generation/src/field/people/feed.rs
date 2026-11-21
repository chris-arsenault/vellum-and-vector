// Arconis: docs/architecture/subsystems.arconis#item=pp_feed — puts land to crops and herds to feed people.
use super::{
    facts::*,
    land::{mix, WorkInput},
    questions::Questions,
    work::{habitable, km2, working, Work},
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::Field,
    human::{
        catalogue::{LayerId, LayerMode},
        operations::{self, Lay, Wear},
    },
    storage::{Band, ReadBand},
};
use std::rc::Rc;

struct Felt {
    hunger: Band<f64>,
    spare: Band<f64>,
    hunger_felt: Band<f64>,
    spare_felt: Band<f64>,
}
/// Harvest available to trade, in residents fed per square kilometre.
fn market_supply(living: f64, support: f64) -> f64 {
    if living > 0.0 {
        (support - living).max(0.0)
    } else {
        0.0
    }
}
fn feel(
    context: &CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    margin: f64,
) -> ExecutionResult<Felt> {
    let support = context.query(&q.support)?.values();
    let field = context.state();
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
) -> ExecutionResult<()> {
    let felt = feel(context, work, q, (GROWTH_RATE * work.facts.years).exp_m1())?;
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
) -> ExecutionResult<()> {
    let field = context.state();
    let support = context.query(&q.support)?.values();
    let draw = context.query(&q.draw)?.values();
    let (demand, demand_felt) = food_requests(field, work, &support, &draw)?;
    let mut offered = working(field);
    let mut reached = working(field);
    let mut taken = working(field);
    let mut taken_felt = working(field);
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
        work.imports
            .set(cell, (brought - sent) / km2(field, cell))?;
    }
    Ok(())
}

/// Travel discounts requests before they reach the supplier. A faint request
/// across a costly route cannot claim the entire harvest by being the only bid.
fn offer_per_request(available: f64, reachable_requests: f64) -> f64 {
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
pub fn operation(
    q: Rc<Questions>,
    owner: Rc<operations::Operations<Field>>,
) -> Command<Field, WorkInput> {
    Command::with_inputs(
        "human.land.feed",
        CommandKind::Work,
        vec![],
        move |context, input: &WorkInput| {
            let mut work = input.borrow_mut();
            if !work.facts.farms {
                return Ok(());
            }
            clear(context, &work, &q, &owner)?;
            share(context, &mut work, &q)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{super::yields::cultivated_yield, market_supply};

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
}
