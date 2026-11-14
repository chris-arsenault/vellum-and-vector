use super::{
    facts::{passes_for, Facts},
    history, pass,
    questions::Questions,
};
use crate::{
    execution::{Command, CommandKind, Query},
    field::Field,
    human::{
        catalogue::LayerId,
        operations::{self, Apportion},
    },
    storage::ReadBand,
};
use std::rc::Rc;

pub struct Era {
    pub years: f64,
    pub mobility: f64,
}
pub struct Operations {
    pub watch: Command<Field, f64>,
    pub epoch: Command<Field>,
    pub era: Command<Field, Era>,
    pub meet: Rc<Command<Field>>,
    pub inherited: Command<Field, ReadBand<i32>>,
    pub pass: Rc<Command<Field, Facts>>,
}
impl Operations {
    pub fn new(
        questions: Rc<Questions>,
        owner: Rc<operations::Operations<Field>>,
        rivers: Query<Field, ReadBand<u32>>,
    ) -> Self {
        let history = history::Operations::new(owner.clone());
        let pass = Rc::new(pass::operation(questions.clone(), owner.clone(), rivers));
        let meet = Rc::new(history.meet);
        let watching = history.watch;
        let forgetting = owner.clone();
        let meet_epoch = meet.clone();
        let pass_epoch = pass.clone();
        let meet_era = meet.clone();
        let pass_era = pass.clone();
        Self {
            watch: Command::with_inputs(
                "human.land-watch",
                CommandKind::Event,
                vec![],
                move |context, years: &f64| {
                    context.run(&forgetting.forget, years)?;
                    context.run(&watching, &())
                },
            ),
            epoch: Command::with_inputs(
                "human.land-epoch",
                CommandKind::Event,
                vec![],
                move |context, _| {
                    context.run(&meet_epoch, &())?;
                    context.run(&pass_epoch, &Facts::loose(200.0))
                },
            ),
            era: Command::with_inputs(
                "human.land-era",
                CommandKind::Elapsed,
                vec![],
                move |context, era: &Era| {
                    context.run(&meet_era, &())?;
                    let passes = passes_for(era.years);
                    for _ in 0..passes {
                        context.run(
                            &pass_era,
                            &Facts::settled(era.years / passes as f64, era.mobility),
                        )?;
                    }
                    Ok(())
                },
            ),
            inherited: Command::with_inputs(
                "human.land-inherit",
                CommandKind::Work,
                vec![],
                move |context, groups: &ReadBand<i32>| {
                    for (kinds, question) in [
                        (vec![LayerId::Farmland], &questions.crop),
                        (vec![LayerId::Pasture], &questions.herd),
                        (
                            vec![LayerId::Population, LayerId::BuiltUp, LayerId::Standing],
                            &questions.support,
                        ),
                    ] {
                        let weight = context.query(question)?.values();
                        context.run(
                            &owner.apportion,
                            &Apportion {
                                kinds,
                                groups: groups.clone(),
                                weight,
                            },
                        )?;
                    }
                    Ok(())
                },
            ),
            meet,
            pass,
        }
    }
}
