// Arconis: docs/architecture/subsystems.arconis#item=pp_found — founds the first people, only on an empty map.
use super::{
    facts::*,
    questions::Questions,
    work::{habitable, working, Work},
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::Field,
    human::{
        catalogue::{self, LayerId, LayerMode},
        operations::{self, Lay, Wear},
        HumanField,
    },
};
use std::{cell::RefCell, rc::Rc};

pub type WorkInput = Rc<RefCell<Work>>;
pub struct Operations {
    pub found: Command<Field, Facts>,
    pub grow: Command<Field, WorkInput>,
    pub harden: Command<Field, WorkInput>,
}
pub fn mix(mode: LayerMode) -> catalogue::CompiledLayerMix {
    let mut values = [0.0; 7];
    values[mode as usize] = 1.0;
    catalogue::compile(values)
}
impl Operations {
    pub fn new(questions: Rc<Questions>, owner: Rc<operations::Operations<Field>>) -> Self {
        let found_q = questions.clone();
        let found_o = owner.clone();
        let grow_q = questions.clone();
        let grow_o = owner.clone();
        Self {
            found: Command::with_inputs(
                "human.land.found",
                CommandKind::Initialize,
                vec![],
                move |context, _| found(context, &found_q, &found_o),
            ),
            grow: Command::with_inputs(
                "human.land.grow",
                CommandKind::Elapsed,
                vec![],
                move |context, input: &WorkInput| grow(context, &input.borrow(), &grow_q, &grow_o),
            ),
            harden: Command::with_inputs(
                "human.land.harden",
                CommandKind::Elapsed,
                vec![],
                move |context, input: &WorkInput| {
                    harden(context, &input.borrow(), &questions, &owner)
                },
            ),
        }
    }
}
fn found(
    context: &mut CommandContext<'_, Field>,
    q: &Questions,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    for cell in 0..context.state().mesh.len() {
        if context.state().people.people(cell)? > 0.0 {
            return Ok(());
        }
    }
    let wild = context.query(&q.wild)?.values();
    let livable = context.query(&q.livable)?.values();
    let field = context.state();
    let mut amount = working(field);
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            amount.set(cell, FOUNDERS * wild.get(cell)? * livable.get(cell)?)?;
        }
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::Population,
            amount: amount.read_only(),
        },
    )
}
fn grow(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    if !work.facts.grows {
        return Ok(());
    }
    let support = context.query(&q.support)?.values();
    let harm = context.query(&q.harm)?.values();
    let livable = context.query(&q.livable)?.values();
    let field = context.state();
    trace_refused(field, &livable)?;
    let mut born = working(field);
    let mut starved = working(field);
    let filling = (-GROWTH_RATE * work.facts.years).exp();
    let lasting = (-work.facts.years / HUNGER_YEARS).exp();
    for cell in 0..field.mesh.len() {
        let living = field.people.people(cell)?;
        // Ground people cannot live on holds nobody, however well it is fed.
        let room = (support.get(cell)? + work.imports.get(cell)?) * livable.get(cell)?;
        if living <= 0.0 {
            continue;
        }
        if living < room {
            born.set(
                cell,
                room / (1.0 + (room / living - 1.0) * filling) - living,
            )?;
        } else if living > room {
            starved.set(
                cell,
                -(1.0 - (living - room) * (1.0 - lasting) / living).ln() * harm.get(cell)?,
            )?;
        }
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::Population,
            amount: born.read_only(),
        },
    )?;
    context.run(
        &owner.wear,
        &Wear {
            mix: mix(LayerMode::Starve),
            intensity: starved.read_only(),
        },
    )
}
/// The dry ground that refuses people and the people still on it, written to the server log
/// when `ATLAS_TRACE_PEOPLE` is set.
fn trace_refused(field: &Field, livable: &crate::storage::ReadBand<f64>) -> std::io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none() {
        return Ok(());
    }
    let (mut cells, mut people) = (0, 0.0);
    for cell in 0..field.mesh.len() {
        // Ground a medium refuses outright: no one should remain on it.
        if habitable(field, cell)? && livable.get(cell)? <= 0.0 {
            cells += 1;
            people += field.people.people(cell)? * super::work::km2(field, cell);
        }
    }
    eprintln!(
        "{}",
        serde_json::json!({"event": "people.refused", "details": {
            "dryCellsRefused": cells, "peopleOnThem": people.round()}})
    );
    Ok(())
}
fn harden(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    if !work.facts.builds {
        return Ok(());
    }
    let builders = context.query(&q.building)?.values();
    let field = context.state();
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let works = field.people.view(HumanField::Layer(LayerId::Standing));
    let mut raised = working(field);
    let mut empty = working(field);
    let building = 1.0 - (-work.facts.years / BUILDING_YEARS).exp();
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        let needed =
            (field.people.people(cell)? / PEOPLE_PER_BUILT_KM2).min(1.0) * builders.get(cell)?;
        let standing = built.get(cell)?;
        if needed > standing {
            raised.set(cell, (needed - standing) * building)?;
        } else if standing > 0.0 {
            empty.set(
                cell,
                work.facts.years / BUILDING_YEARS * (1.0 - needed / standing),
            )?;
        }
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::BuiltUp,
            amount: raised.read_only(),
        },
    )?;
    context.run(
        &owner.wear,
        &Wear {
            mix: mix(LayerMode::Neglect),
            intensity: empty.read_only(),
        },
    )?;
    let gathering = 1.0 - (-work.facts.years / WORKS_YEARS).exp();
    for cell in 0..context.state().mesh.len() {
        raised.set(
            cell,
            (built.get(cell)? * catalogue::FULL_STANDING_PER_BUILT_KM2 - works.get(cell)?).max(0.0)
                * gathering,
        )?;
    }
    context.run(
        &owner.lay,
        &Lay {
            kind: LayerId::Standing,
            amount: raised.read_only(),
        },
    )
}
