use super::{
    facts::PRESSURE,
    land::WorkInput,
    questions::Questions,
    work::{habitable, km2, working, Work},
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::Field,
    human::{
        catalogue::LayerId,
        operations::{self, Move},
    },
    storage::Band,
};
use std::{io, rc::Rc};

struct Leaving {
    targets: Band<i32>,
    share: Band<f64>,
}
fn choose(
    context: &CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    leaving: &mut Leaving,
    score: impl Fn(usize, f64) -> io::Result<f64>,
    going: impl Fn(usize, usize, f64) -> io::Result<f64>,
) -> ExecutionResult<()> {
    let moving = context.query(&q.moving)?.values();
    let field = context.state();
    for cell in 0..field.mesh.len() {
        leaving.targets.set(cell, -1)?;
        leaving.share.set(cell, 0.0)?;
        if !habitable(field, cell)? || field.people.people(cell)? <= 0.0 {
            continue;
        }
        let mut best = 0.0;
        let mut target = None;
        let mut through = 0.0;
        for edge in 0..3 {
            let Some(to) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if !habitable(field, to)? {
                continue;
            }
            let passed =
                work.going.passed.get(cell * work.going.stride + edge)? * work.going.stride as f64;
            let scored = score(to, passed)?;
            if scored > best {
                best = scored;
                target = Some(to);
                through = passed;
            }
        }
        if let Some(target) = target {
            leaving.targets.set(cell, target as i32)?;
            leaving.share.set(
                cell,
                work.facts.mobility * moving.get(cell)? * going(cell, target, through)?,
            )?;
        }
    }
    Ok(())
}
fn move_people(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    owner: &operations::Operations<Field>,
    leaving: &Leaving,
) -> ExecutionResult<()> {
    context.run(
        &owner.move_layer,
        &Move {
            kind: LayerId::Population,
            targets: leaving.targets.read_only(),
            share: leaving.share.read_only(),
            years: work.facts.years / work.facts.sweeps as f64,
        },
    )
}
fn spill(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
    leaving: &mut Leaving,
) -> ExecutionResult<()> {
    let support = context.query(&q.support)?.values();
    let field = context.state();
    let fed = |cell| Ok::<_, io::Error>(support.get(cell)? + work.imports.get(cell)?);
    choose(
        context,
        work,
        q,
        leaving,
        |to, passed| Ok((fed(to)? - field.people.people(to)?).max(0.0) * km2(field, to) * passed),
        |from, _, _| {
            let room = fed(from)?;
            let fill = if room > 0.0 {
                field.people.people(from)? / room
            } else {
                f64::INFINITY
            };
            Ok(((fill - (1.0 - PRESSURE)).max(0.0) / PRESSURE).min(1.0))
        },
    )?;
    move_people(context, work, owner, leaving)
}
fn drain(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
    leaving: &mut Leaving,
) -> ExecutionResult<()> {
    let field = context.state();
    let mut crowd = working(field);
    let mut pull = working(field);
    let open = |cell| {
        Ok::<_, io::Error>(
            (work.market.get(cell)?
                / (1.0 + PRESSURE * field.people.people(cell)? * km2(field, cell)))
            .min(1.0),
        )
    };
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            crowd.set(cell, field.people.people(cell)? * km2(field, cell))?;
        }
    }
    work.reach(field, &crowd, &mut pull)?;
    choose(
        context,
        work,
        q,
        leaving,
        |to, passed| Ok(pull.get(to)? * passed * open(to)?),
        |from, to, passed| {
            let rise = 1.0 - pull.get(from)? / pull.get(to)?;
            let of_range = (1.0 / passed - 1.0).sqrt();
            Ok(if rise > 0.0 {
                open(to)? * (rise / of_range.max(1e-9)).min(1.0)
            } else {
                0.0
            })
        },
    )?;
    move_people(context, work, owner, leaving)
}
pub fn operation(
    q: Rc<Questions>,
    owner: Rc<operations::Operations<Field>>,
) -> Command<Field, WorkInput> {
    Command::with_inputs(
        "human.land.gather",
        CommandKind::Elapsed,
        vec![],
        move |context, input: &WorkInput| {
            let work = input.borrow();
            let field = context.state();
            let targets = field.coverage.borrow_mut().scratch(field.mesh.len(), 0i32);
            let mut leaving = Leaving {
                targets,
                share: working(field),
            };
            for _ in 0..work.facts.sweeps {
                spill(context, &work, &q, &owner, &mut leaving)?;
                if work.facts.farms {
                    drain(context, &work, &q, &owner, &mut leaving)?;
                }
            }
            Ok(())
        },
    )
}
