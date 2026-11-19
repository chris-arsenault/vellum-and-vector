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
fn food_requests(
    field: &Field,
    work: &Work,
    support: &ReadBand<f64>,
) -> std::io::Result<(Band<f64>, Band<f64>)> {
    let mut demand = working(field);
    let mut demand_felt = working(field);
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            demand.set(cell, field.people.people(cell)? * km2(field, cell))?;
        }
    }
    work.reach(field, &demand, &mut demand_felt)?;
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
        demand.set(
            cell,
            market_demand(people, support.get(cell)?, surrounding) * km2(field, cell),
        )?;
    }
    work.reach(field, &demand, &mut demand_felt)?;
    Ok((demand, demand_felt))
}

fn share(
    context: &CommandContext<'_, Field>,
    work: &mut Work,
    q: &Questions,
) -> ExecutionResult<()> {
    let field = context.state();
    let support = context.query(&q.support)?.values();
    let (demand, demand_felt) = food_requests(field, work, &support)?;
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
fn market_demand(living: f64, support: f64, surrounding: f64) -> f64 {
    // Potential arrivals come from the surrounding population. An established
    // city cannot commission a second city of its own size from empty land.
    let arrivals = (living - surrounding).max(0.0).min(surrounding);
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
        assert_eq!(market_demand(50.0, 50.0, 50.0), 0.0);
        assert_eq!(market_demand(50.0, 35.0, 50.0), 15.0);
        assert_eq!(market_demand(100.0, 100.0, 50.0), 50.0);
        assert_eq!(market_demand(100.0, 160.0, 50.0), 0.0);
        assert_eq!(market_demand(1_000.0, 1_000.0, 50.0), 50.0);
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
