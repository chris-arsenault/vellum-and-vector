use super::{
    facts::{passes_for, Facts, PEOPLE_PER_BUILT_KM2},
    history, pass,
    questions::Questions,
    work::{habitable, working},
};
use crate::{
    execution::{Command, CommandKind, Query},
    field::Field,
    human::{
        catalogue::LayerId,
        operations::{self, Apportion},
        HumanField,
    },
    storage::{Band, ReadBand},
};
use std::{io, rc::Rc};

/// The people a dry cell holds: those its land feeds as now used, and those its built ground
/// houses, on the share of it people can live on. Town people stay on the houses they came
/// with instead of moving onto the fields.
fn room(field: &Field, support: &ReadBand<f64>, livable: &ReadBand<f64>) -> io::Result<Band<f64>> {
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let mut room = working(field);
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            room.set(
                cell,
                (support.get(cell)?.max(0.0) + built.get(cell)? * PEOPLE_PER_BUILT_KM2)
                    * livable.get(cell)?,
            )?;
        }
    }
    Ok(room)
}
pub struct Era {
    pub years: f64,
    pub mobility: f64,
}
// Arconis: docs/architecture/subsystems.arconis#item=p_watch — people's land operations, run after geology each epoch.
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
            // A finer map draws its parent's people in finer detail and lives no history: each
            // parent cell's fields, herds and people are shared among the child cells beneath
            // it by how well each suits them.
            inherited: Command::with_inputs(
                "human.land-inherit",
                CommandKind::Work,
                vec![],
                move |context, groups: &ReadBand<i32>| {
                    for (kinds, question) in [
                        (vec![LayerId::Farmland], Some(&questions.crop)),
                        (vec![LayerId::Pasture], Some(&questions.herd)),
                        (
                            vec![LayerId::Population, LayerId::BuiltUp, LayerId::Standing],
                            None,
                        ),
                    ] {
                        let weight = match question {
                            Some(question) => context.query(question)?.values(),
                            None => {
                                let support = context.query(&questions.support)?.values();
                                let livable = context.query(&questions.livable)?.values();
                                room(context.state(), &support, &livable)?.read_only()
                            }
                        };
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
