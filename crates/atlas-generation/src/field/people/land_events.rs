// Arconis: docs/architecture/subsystems.arconis#item=pp_events — applies famine, disaster and siege while keeping frontiers.
use super::{
    events::{dead_on, rounded, Event, Events},
    facts::PEOPLE_PER_BUILT_KM2,
    flight::{Fled, Flight, Going},
    frontiers,
    hazards::Hazard,
    place_country::KnownWay,
    places::{Place, Places},
    questions::Questions,
    traditions,
    travel::Travel,
    work::working,
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult, Query},
    field::Field,
    human::{
        catalogue::LayerId,
        operations::{self, Keep, Wear},
        HumanField,
    },
    links::Offers,
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
    pub links: Rc<Offers<Field>>,
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
    flight: &'a Flight<'a>,
    owner: &'a operations::Operations<Field>,
    effects: &'a Command<Field, Struck>,
}
/// How hard a siege wears the place it takes. With the magnitude's six to nine tenths, the
/// old society cycle's siege magnitudes, it kills about a fifth of an unbuilt town; a town's
/// standing holds its people against the wear as it holds them against any blow, so walls
/// count once.
const SIEGE_WEAR: f64 = 0.5;
/// A siege's magnitude, from six tenths where the losing realm still holds together to nine
/// where it has collapsed, as the old society cycle struck fragmented and collapsed realms.
pub fn siege_magnitude(loser_health: f64) -> f64 {
    0.6 + 0.3 * (1.0 - loser_health.clamp(0.0, 1.0))
}
/// Writes where a strike's survivors went onto its event and its account.
fn fled_to(era: &Era, event: &mut Event, fled: &Fled) {
    event.displaced = rounded(fled.people);
    event.refuge = fled.refuge.and_then(|cell| {
        era.places
            .borrow()
            .known
            .iter()
            .find(|p| p.abandoned.is_none() && p.absorbed_by.is_none() && p.cells.contains(&cell))
            .map(|p| p.id.clone())
    });
}
fn fled_clause(fled: f64) -> String {
    if fled > 0.0 {
        format!(", and {fled} fled to the country nearby")
    } else {
        String::new()
    }
}
impl Strike<'_> {
    /// A place taken by another realm is besieged: its people die and its works are worn the
    /// harder the further the losing realm had fallen, and its survivors flee. The siege is
    /// then recorded with its toll.
    fn siege(
        &self,
        context: &mut CommandContext<'_, Field>,
        place: &Place,
        event: &mut Event,
        loser_health: f64,
    ) -> ExecutionResult<()> {
        let magnitude = siege_magnitude(loser_health);
        let before = dead_on(context.state(), place)?;
        let mut intensity = working(context.state());
        for &cell in &place.cells {
            intensity.set(cell, SIEGE_WEAR * magnitude * self.harm.get(cell)?)?;
        }
        context.run(
            &self.owner.wear,
            &Wear {
                mix: siege_mix(),
                intensity: intensity.read_only(),
            },
        )?;
        let casualties = rounded(dead_on(context.state(), place)? - before);
        let fled = self.flight.flee(context, place, &place.cells, magnitude)?;
        fled_to(self.era, event, &fled);
        event.casualties = casualties;
        // The siege's works are worn through the standing layer above; it changes no ground,
        // so the catalogue's event command has nothing to do for it.
        event.magnitude = magnitude;
        event.causes.push(format!(
            "{} died in the taking{}.",
            casualties,
            fled_clause(event.displaced)
        ));
        Ok(())
    }
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
            for &cell in &cells {
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
            let fled = self.flight.flee(context, place, &cells, magnitude)?;
            let mut event = Event {
                id: String::new(),
                kind: hazard.kind().into(),
                era: self.era.era.clone(),
                place: place.id.clone(),
                cell: worst,
                casualties,
                townsfolk: rounded(place.town_people),
                magnitude,
                causes: Vec::new(),
                displaced: 0.0,
                refuge: None,
            };
            fled_to(self.era, &mut event, &fled);
            event.causes.push(format!(
                "{}: {} {casualties} died{}.",
                self.era.era,
                hazard.cause(),
                fled_clause(event.displaced)
            ));
            self.era.events.borrow_mut().record(event);
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
            let struck: Vec<usize> = exposed.iter().map(|&(cell, _)| cell).collect();
            let fled = self.flight.flee(context, place, &struck, magnitude)?;
            let mut event = Event {
                id: String::new(),
                kind: threat.kind.clone(),
                era: self.era.era.clone(),
                place: place.id.clone(),
                cell: worst,
                casualties,
                townsfolk: rounded(place.town_people),
                magnitude,
                causes: Vec::new(),
                displaced: 0.0,
                refuge: None,
            };
            fled_to(self.era, &mut event, &fled);
            event.causes.push(format!(
                "{}: {} {casualties} died{}.",
                self.era.era,
                threat.cause,
                fled_clause(event.displaced)
            ));
            self.era.events.borrow_mut().record(event);
        }
        Ok(())
    }
}
/// How a siege wears the place it takes: mostly by fire, and by the shaking down of walls
/// and roofs.
fn siege_mix() -> crate::human::catalogue::CompiledLayerMix {
    use crate::human::catalogue::{compile, LayerMode};
    let mut taking = [0.0; 7];
    taking[LayerMode::Burn as usize] = 0.6;
    taking[LayerMode::Shake as usize] = 0.4;
    compile(taking)
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
/// Each cell's room for people per km², as growth reckons it: what its land feeds and its
/// built ground houses, on ground people can live on.
fn room(
    context: &mut CommandContext<'_, Field>,
    questions: &Questions,
) -> ExecutionResult<ReadBand<f64>> {
    let fed = context.query(&questions.support)?.values();
    let livable = context.query(&questions.livable)?.values();
    let field = context.state();
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let mut room = working(field);
    for cell in 0..field.mesh.len() {
        room.set(
            cell,
            (fed.get(cell)?.max(0.0) + built.get(cell)? * PEOPLE_PER_BUILT_KM2)
                * livable.get(cell)?.max(0.0),
        )?;
    }
    Ok(room.read_only())
}
pub fn operation(
    questions: Rc<Questions>,
    owner: Rc<operations::Operations<Field>>,
    effects: Command<Field, Struck>,
    rivers: Query<Field, ReadBand<u32>>,
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
            let room = room(context, &questions)?;
            let friction = context.query(&questions.friction)?.values();
            let climbing = context.query(&questions.climbing)?.values();
            let rivers = context.query(&rivers)?;
            let going = {
                let field = context.state();
                Going::new(field, &Travel::new(field, friction, climbing, rivers)?)?
            };
            let flight = Flight {
                going: &going,
                links: &era.links,
                room: &room,
                owner: &owner,
            };
            era.events.borrow_mut().era = Some(era.era.clone());
            let places = era.places.borrow().known.clone();
            let strike = Strike {
                era,
                harm: &harm,
                flight: &flight,
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
                let taken = era.events.borrow_mut().siege(
                    context.state(),
                    &era.memory.borrow(),
                    place,
                    &era.era,
                )?;
                if let Some(mut siege) = taken {
                    strike.siege(context, place, &mut siege.event, siege.loser_health)?;
                    era.events.borrow_mut().record(siege.event);
                }
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
#[cfg(test)]
mod tests {
    use super::siege_magnitude;

    #[test]
    fn a_falling_realm_loses_its_towns_harder() {
        assert!((siege_magnitude(1.0) - 0.6).abs() < 1e-12);
        assert!((siege_magnitude(0.0) - 0.9).abs() < 1e-12);
        assert!(siege_magnitude(0.3) > siege_magnitude(0.7));
    }
}
