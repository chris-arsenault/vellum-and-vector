use super::{
    dam_sites::{self, Trial},
    places::Places,
    works::Works,
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult, Query},
    field::{water::network::RiverEvolution, Field},
    storage::{Band, ReadBand},
};
use std::{cell::RefCell, rc::Rc};

pub struct Era {
    pub places: Rc<RefCell<Places>>,
    pub works: Rc<RefCell<Works>>,
    pub drawn: Vec<usize>,
    pub era: String,
}
pub struct Operations {
    mark: Command<Field, Vec<usize>>,
    channel_form: Query<Field, ()>,
    evolve: Command<Field, RiverEvolution>,
}
pub fn dams() -> Query<Field, ReadBand<u8>> {
    Query::new("human.dam-constraints", vec![], |field: &Field, _| {
        Ok(field
            .engineered_dams
            .as_ref()
            .map(Band::read_only)
            .unwrap_or_else(|| field.coverage.borrow_mut().allocate(0u8).read_only()))
    })
}
fn standing(era: &Era) -> Vec<usize> {
    era.works
        .borrow()
        .standing()
        .map(|w| w.cell)
        .chain(era.drawn.iter().copied())
        .collect()
}
impl Operations {
    pub fn new(channel_form: Query<Field, ()>, evolve: Command<Field, RiverEvolution>) -> Self {
        Self {
            channel_form,
            evolve,
            mark: Command::with_inputs(
                "human.dam-constraints",
                CommandKind::Work,
                vec![],
                |context, cells: &Vec<usize>| {
                    let field = context.state_mut();
                    field.engineered_dams = if cells.is_empty() {
                        None
                    } else {
                        let mut dams = field.coverage.borrow_mut().allocate(0u8);
                        for &cell in cells {
                            dams.set(cell, 1)?;
                        }
                        Some(dams)
                    };
                    Ok(())
                },
            ),
        }
    }
    pub fn settle(
        &self,
        context: &mut CommandContext<'_, Field>,
        cells: &Vec<usize>,
    ) -> ExecutionResult<()> {
        context.run(&self.mark, cells)?;
        context.query(&self.channel_form)?;
        Ok(())
    }
    fn retain(&self, context: &mut CommandContext<'_, Field>) -> ExecutionResult<()> {
        context.run(
            &self.evolve,
            &RiverEvolution {
                channel_length: None,
            },
        )?;
        context.query(&self.channel_form)?;
        Ok(())
    }
    fn try_dams(
        &self,
        context: &mut CommandContext<'_, Field>,
        era: &Era,
        wanted: &[Trial],
    ) -> ExecutionResult<bool> {
        let field = context.state();
        let mut before = field.coverage.borrow_mut().scratch(field.mesh.len(), 0u8);
        for cell in 0..field.mesh.len() {
            before.set(cell, u8::from(field.water().column.kind.get(cell)? == 2))?;
        }
        let mut candidates = standing(era);
        candidates.extend(wanted.iter().map(|t| t.cell));
        self.settle(context, &candidates)?;
        let (dry, accepted) = dam_sites::judge(
            context.state(),
            &mut era.works.borrow_mut(),
            wanted,
            &before.read_only(),
            &era.era,
        )?;
        if dry {
            self.settle(context, &standing(era))?;
        }
        Ok(accepted > 0)
    }
    fn advance(&self, context: &mut CommandContext<'_, Field>, era: &Era) -> ExecutionResult<()> {
        let failed =
            dam_sites::fail_abandoned(&era.places.borrow(), &mut era.works.borrow_mut(), &era.era);
        let mut unmarked = false;
        for &cell in &era.drawn {
            let marked = context
                .state()
                .engineered_dams
                .as_ref()
                .map(|d| d.get(cell))
                .transpose()?
                .unwrap_or(0);
            unmarked |= marked == 0;
        }
        let wanted = dam_sites::trials(context.state(), &era.places.borrow(), &era.works.borrow())?;
        let changed = failed || unmarked;
        if unmarked {
            era.works.borrow_mut().note_water_moved();
        }
        if wanted.is_empty() {
            if changed {
                self.settle(context, &standing(era))?;
                self.retain(context)?;
            }
        } else {
            let accepted = self.try_dams(context, era, &wanted)?;
            if changed || accepted {
                self.retain(context)?;
            }
        }
        Ok(())
    }
    pub fn operation(self: Rc<Self>) -> Command<Field, Era> {
        Command::with_inputs(
            "human.waterworks",
            CommandKind::Event,
            vec![],
            move |context, era| self.advance(context, era),
        )
    }
}
