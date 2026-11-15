// Arconis: docs/architecture/subsystems.arconis#item=pp_feed — puts land to crops and herds to feed people.
use super::{
    facts::*,
    land::{mix, WorkInput},
    questions::Questions,
    travel::length,
    work::{habitable, km2, working, Work},
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::Field,
    human::{
        catalogue::{LayerId, LayerMode},
        operations::{self, Lay, Wear},
    },
    scale::{AreaUnit, MapScale},
    storage::Band,
};
use std::rc::Rc;

struct Felt {
    hunger: Band<f64>,
    spare: Band<f64>,
    hunger_felt: Band<f64>,
    spare_felt: Band<f64>,
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
fn share(
    context: &CommandContext<'_, Field>,
    work: &mut Work,
    q: &Questions,
) -> ExecutionResult<()> {
    let felt = feel(context, work, q, 0.0)?;
    let field = context.state();
    let mut offered = working(field);
    let mut reached = working(field);
    let mut taken = working(field);
    let mut taken_felt = working(field);
    let in_range = std::f64::consts::PI * length(field, work.facts.range)?.powi(2);
    for cell in 0..field.mesh.len() {
        if felt.hunger_felt.get(cell)? > 0.0 {
            offered.set(cell, felt.spare.get(cell)? / felt.hunger_felt.get(cell)?)?;
        }
    }
    work.reach(field, &offered, &mut reached)?;
    for cell in 0..field.mesh.len() {
        if reached.get(cell)? > 0.0 {
            taken.set(
                cell,
                felt.hunger.get(cell)? * (1.0 / reached.get(cell)?).min(1.0),
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
        let unclaimed = (felt.spare_felt.get(cell)? - felt.hunger_felt.get(cell)?).max(0.0);
        work.imports
            .set(cell, (brought - sent) / km2(field, cell))?;
        work.market.set(
            cell,
            unclaimed / work.land.get(cell)?
                * MapScale::area_units(in_range, AreaUnit::SquareMetre, AreaUnit::SquareKilometre),
        )?;
    }
    Ok(())
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
