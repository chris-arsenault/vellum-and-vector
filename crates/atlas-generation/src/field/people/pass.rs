use super::{crafts, facts::Facts, feed, gather, land, questions::Questions, work::Work};
use crate::{
    execution::{Command, CommandKind, Query},
    field::Field,
    human::operations::{self, Dwelling},
    storage::ReadBand,
};
use std::{cell::RefCell, rc::Rc};

// Arconis: docs/architecture/subsystems.arconis#item=pp_keep — one population pass; standing places age through it.
/// The same owner operations execute loose, settled and inherited population passes.
pub fn operation(
    questions: Rc<Questions>,
    owner: Rc<operations::Operations<Field>>,
    rivers: Query<Field, ReadBand<u32>>,
) -> Command<Field, Facts> {
    let land = land::Operations::new(questions.clone(), owner.clone());
    let learn = crafts::learning(owner.clone());
    let feed = feed::operation(questions.clone(), owner.clone());
    let gather = gather::operation(questions.clone(), owner.clone());
    Command::with_inputs(
        "human.land.pass",
        CommandKind::Elapsed,
        vec![],
        move |context, facts: &Facts| {
            context.run(&land.found, facts)?;
            if facts.learns {
                context.run(&learn, &facts.years)?;
            }
            let work = Rc::new(RefCell::new(Work::open(
                context, *facts, &questions, &rivers,
            )?));
            context.run(&feed, &work)?;
            context.run(&land.grow, &work)?;
            context.run(&gather, &work)?;
            context.run(&land.harden, &work)?;
            let fading = context.query(&questions.forgetting)?.values();
            context.run(
                &owner.dwell,
                &Dwelling {
                    years: facts.years,
                    fading: Some(fading),
                },
            )
        },
    )
}
