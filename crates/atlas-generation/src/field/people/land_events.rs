// Arconis: docs/architecture/subsystems.arconis#item=pp_events — applies famine, disaster and siege while keeping frontiers.
use super::{
    events::{dead_on, rounded, Event, Events},
    frontiers,
    hazards::Hazard,
    place_country::KnownWay,
    places::{Place, Places},
    questions::Questions,
    traditions,
    work::working,
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::Field,
    human::operations::{self, Keep, Wear},
    storage::ReadBand,
};
use std::{cell::RefCell, io, rc::Rc};

#[derive(Clone)]
pub struct Struck {
    pub kind: String,
    pub magnitude: f64,
    pub cell: usize,
}
pub struct Era {
    pub memory: Rc<RefCell<traditions::Context>>,
    pub events: Rc<RefCell<Events>>,
    pub places: Rc<RefCell<Places>>,
    pub ways: Rc<RefCell<Vec<KnownWay>>>,
    pub era: String,
    pub years: f64,
    pub town: f64,
    pub random: Rc<RefCell<dyn FnMut() -> f64>>,
}
fn exposure(
    field: &Field,
    place: &Place,
    hazard: Hazard,
) -> io::Result<(Vec<usize>, Option<usize>, f64)> {
    let mut cells = Vec::new();
    let mut worst = None;
    let mut yearly = 0.0;
    for &cell in &place.cells {
        let chance = hazard.yearly(field, cell)?;
        if chance <= 0.0 {
            continue;
        }
        cells.push(cell);
        if chance > yearly {
            worst = Some(cell);
            yearly = chance;
        }
    }
    Ok((cells, worst, yearly))
}
struct Strike<'a> {
    era: &'a Era,
    harm: &'a ReadBand<f64>,
    owner: &'a operations::Operations<Field>,
    effects: &'a Command<Field, Struck>,
}
impl Strike<'_> {
    fn place(&self, context: &mut CommandContext<'_, Field>, place: &Place) -> ExecutionResult<()> {
        for hazard in Hazard::ALL {
            let (cells, worst, yearly) = exposure(context.state(), place, hazard)?;
            let Some(worst) = worst else {
                continue;
            };
            if (self.era.random.borrow_mut())() >= -(-yearly * self.era.years).exp_m1() {
                continue;
            }
            let magnitude =
                (hazard.severity() * (0.5 + (self.era.random.borrow_mut())() * 1.5)).min(1.0);
            let before = dead_on(context.state(), place)?;
            let mut intensity = working(context.state());
            for cell in cells {
                intensity.set(cell, magnitude * self.harm.get(cell)?)?;
            }
            context.run(
                &self.owner.wear,
                &Wear {
                    mix: hazard.mix(),
                    intensity: intensity.read_only(),
                },
            )?;
            let casualties = rounded(dead_on(context.state(), place)? - before);
            self.era.events.borrow_mut().record(Event {
                id: String::new(),
                kind: hazard.kind().into(),
                era: self.era.era.clone(),
                place: place.id.clone(),
                cell: worst,
                casualties,
                townsfolk: rounded(place.town_people),
                magnitude,
                causes: vec![format!(
                    "{}: {} {casualties} died.",
                    self.era.era,
                    hazard.cause()
                )],
            });
            context.run(
                self.effects,
                &Struck {
                    kind: hazard.kind().into(),
                    magnitude,
                    cell: worst,
                },
            )?;
        }
        self.threats(context, place)
    }
    /// The dangers of the places and magic meetings standing this era, striking the living
    /// places within their ground, each recorded under its own name.
    fn threats(
        &self,
        context: &mut CommandContext<'_, Field>,
        place: &Place,
    ) -> ExecutionResult<()> {
        let meetings = context
            .state()
            .place_offers()
            .map(|offers| offers.meetings().to_vec())
            .unwrap_or_default();
        if meetings.is_empty() {
            return Ok(());
        }
        let mut here = crate::hpc::BitSet::new(context.state().mesh.len());
        for &cell in &place.cells {
            here.add(cell);
        }
        for threat in meetings {
            let exposed: Vec<(usize, f64)> = threat
                .cells
                .iter()
                .copied()
                .filter(|&(cell, _)| here.has(cell))
                .collect();
            let Some(&(worst, share)) = exposed.iter().max_by(|a, b| a.1.total_cmp(&b.1)) else {
                continue;
            };
            if share <= 0.0 {
                continue;
            }
            // A meeting states how often a year it strikes the ground it covers; how much of
            // the ground it covers sets how hard.
            if (self.era.random.borrow_mut())() >= -(-threat.yearly * self.era.years).exp_m1() {
                continue;
            }
            let magnitude =
                (threat.severity * share * (0.5 + (self.era.random.borrow_mut())() * 1.5)).min(1.0);
            let toll = magnitude * MEETING_WEAR;
            let before = dead_on(context.state(), place)?;
            let mut intensity = working(context.state());
            for &(cell, bears) in &exposed {
                intensity.set(cell, toll * bears / share * self.harm.get(cell)?)?;
            }
            context.run(
                &self.owner.wear,
                &Wear {
                    mix: threat_mix(),
                    intensity: intensity.read_only(),
                },
            )?;
            let casualties = rounded(dead_on(context.state(), place)? - before);
            self.era.events.borrow_mut().record(Event {
                id: String::new(),
                kind: threat.kind.clone(),
                era: self.era.era.clone(),
                place: place.id.clone(),
                cell: worst,
                casualties,
                townsfolk: rounded(place.town_people),
                magnitude,
                causes: vec![format!(
                    "{}: {} {casualties} died.",
                    self.era.era, threat.cause
                )],
            });
        }
        Ok(())
    }
}
/// How hard a meeting at full severity wears the living ground it strikes. Through the
/// shake-and-burn mix this takes about a fifth of the people there, as the old society
/// cycle's hazards killed a fifth of a community at full severity.
const MEETING_WEAR: f64 = 0.5;
/// How a magic meeting wears the people it strikes: by shaking and burning, as the land's
/// own upheavals do, until a meeting's hazard states its own way of harming.
fn threat_mix() -> crate::human::catalogue::CompiledLayerMix {
    use crate::human::catalogue::{compile, LayerMode};
    let mut striking = [0.0; 7];
    striking[LayerMode::Shake as usize] = 0.5;
    striking[LayerMode::Burn as usize] = 0.5;
    compile(striking)
}
pub fn operation(
    questions: Rc<Questions>,
    owner: Rc<operations::Operations<Field>>,
    effects: Command<Field, Struck>,
) -> Command<Field, Era> {
    Command::with_inputs(
        "human.events",
        CommandKind::Event,
        vec![],
        move |context, era: &Era| {
            let asked = context.query(&questions.harm)?.values();
            let mut harm = working(context.state());
            for cell in 0..context.state().mesh.len() {
                harm.set(cell, asked.get(cell)?)?;
            }
            let harm = harm.read_only();
            era.events.borrow_mut().era = Some(era.era.clone());
            let places = era.places.borrow().known.clone();
            let strike = Strike {
                era,
                harm: &harm,
                owner: &owner,
                effects: &effects,
            };
            for place in places.iter().filter(|p| p.absorbed_by.is_none()) {
                era.events
                    .borrow_mut()
                    .famine(context.state(), place, &era.era, era.town)?;
                if place.abandoned.is_none() {
                    strike.place(context, place)?;
                }
                era.events.borrow_mut().siege(
                    context.state(),
                    &era.memory.borrow(),
                    place,
                    &era.era,
                )?;
            }
            era.events.borrow_mut().count_dead(context.state())?;
            let mut kept = vec![false; context.state().mesh.len()];
            for frontier in
                frontiers::ways(context.state(), &era.places.borrow(), &era.ways.borrow())?
            {
                for end in frontier.ends {
                    kept[end.anchor] = true;
                }
            }
            let cells = kept
                .into_iter()
                .enumerate()
                .filter_map(|(cell, held)| held.then_some(cell))
                .collect();
            context.run(
                &owner.keep,
                &Keep {
                    cells,
                    years: era.years,
                },
            )
        },
    )
}
