use super::{history, pass, questions::Questions};
use crate::{
    execution::{Command, CommandKind, Query},
    field::Field,
    human::operations,
    storage::ReadBand,
};
use std::rc::Rc;

// Arconis: docs/architecture/subsystems.arconis#item=p_watch — observe changes to inhabited ground during world history.
pub struct Operations {
    pub watch: Command<Field, f64>,
    pub meet: Command<Field, history::HazardEvent>,
    pub pass: pass::Operations,
}
impl Operations {
    pub fn new(
        questions: Rc<Questions>,
        owner: Rc<operations::Operations<Field>>,
        rivers: Query<Field, ReadBand<u32>>,
    ) -> Self {
        let history = history::Operations::new(owner.clone());
        let pass = pass::Operations::new(questions, owner.clone(), rivers);
        Self {
            watch: Command::with_inputs(
                "human.land-watch",
                CommandKind::Event,
                vec![],
                move |context, years: &f64| {
                    context.run(&owner.forget, years)?;
                    context.run(&history.watch, &())
                },
            ),
            meet: history.meet,
            pass,
        }
    }
}
