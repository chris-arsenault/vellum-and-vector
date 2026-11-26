use super::{
    contract::Timing, crafts, facts::Facts, feed, gather, goods, land, questions::Questions,
    work::Work,
};
use crate::{
    execution::{Command, CommandKind, Query},
    field::Field,
    human::operations::{self, Dwelling},
    storage::ReadBand,
};
use std::{cell::RefCell, rc::Rc};

#[derive(Clone)]
pub struct Inputs<S> {
    pub facts: Facts,
    pub strategy: S,
    pub parent: crate::field::refinement::people::Parent,
    pub city: Option<Rc<super::growth::Guidance>>,
}

// Arconis: docs/architecture/subsystems.arconis#item=pp_keep — standing places age during historical dwelling.
pub struct Operations {
    pub settle: Command<Field, Facts>,
    pub dwell: Command<Field, Facts>,
    pub trade: Command<Field, Inputs<goods::TradeStrategy>>,
    pub feed: Command<Field, Inputs<feed::Provision>>,
    pub grow: Command<Field, Inputs<land::Demography>>,
    pub gather: Command<Field, Inputs<gather::Placement>>,
    pub harden: Command<Field, Inputs<land::Capital>>,
    pub maintenance: Command<Field, Inputs<land::Capital>>,
}

impl Operations {
    pub fn new(
        questions: Rc<Questions>,
        owner: Rc<operations::Operations<Field>>,
        rivers: Query<Field, ReadBand<u32>>,
    ) -> Self {
        let land = land::Operations::new(questions.clone(), owner.clone());
        let learn = crafts::learning(owner.clone());
        let pass = Pass {
            work: Rc::default(),
            questions: questions.clone(),
            rivers,
        };
        let trade = pass.bind(goods::operation(owner.clone()), true, false);
        let feed = pass.bind(
            feed::operation(questions.clone(), owner.clone()),
            false,
            false,
        );
        let gather = pass.bind(
            gather::operation(questions.clone(), owner.clone()),
            false,
            false,
        );
        Self {
            trade,
            feed,
            gather,
            grow: pass.bind(land.grow, false, false),
            harden: pass.bind(land.harden, false, false),
            maintenance: pass.bind(land.maintenance, false, true),
            settle: Command::with_inputs(
                "human.land-settle",
                CommandKind::Event,
                vec![],
                move |scope, facts: &Facts| {
                    if land::FOUNDING
                        .select(scope.state().process_site(), Timing::Elapsed)?
                        .is_some()
                    {
                        scope.run(&land.found, facts)?;
                    }
                    if facts.learns
                        && crafts::LEARNING
                            .select(scope.state().process_site(), Timing::Elapsed)?
                            .is_some()
                    {
                        scope.run(&learn, &facts.years)?;
                    }
                    Ok(())
                },
            ),
            dwell: Command::with_inputs(
                "human.layers.dwell",
                CommandKind::Elapsed,
                vec![],
                move |scope, facts: &Facts| {
                    let fading = scope.query(&questions.forgetting)?.values();
                    scope.run(
                        &owner.dwell,
                        &Dwelling {
                            years: facts.years,
                            fading: Some(fading),
                        },
                    )
                },
            ),
        }
    }
}

struct Pass {
    work: Rc<RefCell<Option<land::SharedWork>>>,
    questions: Rc<Questions>,
    rivers: Query<Field, ReadBand<u32>>,
}

impl Pass {
    fn bind<S: Copy + 'static>(
        &self,
        command: Command<Field, land::WorkInput<S>>,
        first: bool,
        last: bool,
    ) -> Command<Field, Inputs<S>> {
        let work = self.work.clone();
        let questions = self.questions.clone();
        let rivers = self.rivers.clone();
        Command::with_inputs(
            command.name().to_owned(),
            CommandKind::Work,
            vec![],
            move |scope, input: &Inputs<S>| {
                if first || work.borrow().is_none() {
                    let mut opened = Work::open(
                        scope,
                        input.facts,
                        &questions,
                        &rivers,
                        input.city.as_deref(),
                    )?;
                    opened.city = input.city.clone();
                    opened.outside_market = input.parent.market;
                    opened.connections = input.parent.connections.clone();
                    opened.markets = input.parent.markets.clone();
                    opened.land.retain();
                    opened.imports.retain();
                    opened.going.passed.retain();
                    *work.borrow_mut() = Some(Rc::new(RefCell::new(opened)));
                }
                let current = work.borrow().as_ref().unwrap().clone();
                let result = scope.run(
                    &command,
                    &land::WorkInput {
                        work: current,
                        strategy: input.strategy,
                    },
                );
                if last {
                    work.borrow_mut().take();
                }
                result
            },
        )
    }
}
