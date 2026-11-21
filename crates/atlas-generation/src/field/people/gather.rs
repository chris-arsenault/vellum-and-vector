// Arconis: docs/architecture/subsystems.arconis#item=pp_move — moves people toward room along the going.
use super::{
    facts::{CONCENTRATION, PRESSURE},
    land::WorkInput,
    questions::Questions,
    reach::{passed_over, ranges_of, REACH_SWEEPS},
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
    /// The journeys of this move that pass through other cells on their way.
    journeys: Vec<Journey>,
}
/// A move beyond the next cell: where it set out, the people who could go, and the cells it
/// passes through, which its travellers wear into ways.
struct Journey {
    from: usize,
    residents: f64,
    through: Vec<usize>,
    crossed: bool,
}
impl Leaving {
    fn request(
        &mut self,
        cell: usize,
        target: usize,
        share: f64,
        residents: f64,
        arrivals: &mut Band<f64>,
    ) -> io::Result<()> {
        self.targets.set(cell, target as i32)?;
        self.share.set(cell, share)?;
        arrivals.set(target, arrivals.get(target)? + share * residents)
    }
    fn admit(
        &mut self,
        arrivals: &Band<f64>,
        room: impl Fn(usize) -> io::Result<f64>,
    ) -> io::Result<()> {
        for cell in 0..self.targets.len() {
            let target = self.targets.get(cell)?;
            if target >= 0 {
                let to = target as usize;
                let admitted = supported_share(1.0, room(to)?, arrivals.get(to)?);
                self.share.set(cell, self.share.get(cell)? * admitted)?;
            }
        }
        Ok(())
    }
}
/// Where a route stops: once the going has passed on less than this share of a journey.
const ROUTE_PASSED: f64 = 0.1;
/// How much of a journey one step from `cell` along `edge` passes on, from 0 to 1.
fn step_passed(work: &Work, cell: usize, edge: usize) -> io::Result<f64> {
    Ok(work.going.passed.get(cell * work.going.stride + edge)? * work.going.stride as f64)
}
/// Somewhere a mover could settle, the share of the journey that reaches it, how many cells
/// of the route lie before it, and whether the route crossed water to reach it.
#[derive(Clone, Copy)]
struct Destination {
    cell: usize,
    passed: f64,
    along: usize,
    crossed: bool,
}
/// The places a mover from `from` could settle, and the route that reaches the far ones: its
/// dry neighbours, then every dry cell along the route that climbs `guide` (pull, or spare
/// food felt over the reach) across any ground travel allows, water and worn ways included.
/// A route's steps add their costs before decaying, as one journey of that length would, and
/// it ends where the going passes on too little.
fn destinations(
    field: &Field,
    work: &Work,
    guide: &Band<f64>,
    from: usize,
) -> io::Result<(Vec<Destination>, Vec<usize>)> {
    let mut found = Vec::new();
    for edge in 0..3 {
        if let Some(to) = field.mesh.neighbor(from, edge) {
            if habitable(field, to)? {
                found.push(Destination {
                    cell: to,
                    passed: step_passed(work, from, edge)?,
                    along: 0,
                    crossed: false,
                });
            }
        }
    }
    let (mut at, mut ranges, mut crossed) = (from, 0.0, false);
    let mut route = Vec::new();
    for _ in 0..REACH_SWEEPS {
        let mut next = None;
        let mut highest = guide.get(at)?;
        for edge in 0..3 {
            let Some(to) = field.mesh.neighbor(at, edge) else {
                continue;
            };
            let through = step_passed(work, at, edge)?;
            if through > 0.0 && guide.get(to)? > highest {
                highest = guide.get(to)?;
                next = Some((to, through));
            }
        }
        let Some((to, through)) = next else {
            break;
        };
        ranges += ranges_of(through);
        let passed = passed_over(ranges);
        if passed < ROUTE_PASSED {
            break;
        }
        at = to;
        if !habitable(field, at)? {
            crossed = true;
        } else if found.iter().all(|d| d.cell != at) {
            found.push(Destination {
                cell: at,
                passed,
                along: route.len(),
                crossed,
            });
        }
        route.push(at);
    }
    Ok((found, route))
}
/// The people arriving beyond the next cell and across water in one move, written to the
/// server log when `ATLAS_TRACE_PEOPLE` is set.
fn trace_journeys(leaving: &Leaving, moved: f64) -> io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none() {
        return Ok(());
    }
    let (mut beyond, mut crossed) = (0.0, 0.0);
    for journey in &leaving.journeys {
        let going = journey.residents * leaving.share.get(journey.from)?;
        beyond += going;
        if journey.crossed {
            crossed += going;
        }
    }
    eprintln!(
        "{}",
        serde_json::json!({"event": "people.journeys", "details": {
            "moved": moved.round(), "beyondTheNextCell": beyond.round(),
            "acrossWater": crossed.round()}})
    );
    Ok(())
}
/// The going a pass moves people along, and the field its routes climb.
struct Routes<'a> {
    work: &'a Work,
    guide: &'a Band<f64>,
}
fn choose(
    context: &CommandContext<'_, Field>,
    routes: &Routes<'_>,
    q: &Questions,
    leaving: &mut Leaving,
    score: impl Fn(usize, usize, f64) -> io::Result<f64>,
    going: impl Fn(usize, usize, f64) -> io::Result<f64>,
) -> ExecutionResult<Band<f64>> {
    let (work, guide) = (routes.work, routes.guide);
    let moving = context.query(&q.moving)?.values();
    let field = context.state();
    let mut arriving = working(field);
    leaving.journeys.clear();
    for cell in 0..field.mesh.len() {
        leaving.targets.set(cell, -1)?;
        leaving.share.set(cell, 0.0)?;
        if !habitable(field, cell)? || field.people.people(cell)? <= 0.0 {
            continue;
        }
        let mut best = 0.0;
        let mut chosen = None;
        let (found, route) = destinations(field, work, guide, cell)?;
        for destination in found {
            let scored = score(cell, destination.cell, destination.passed)?;
            if scored > best {
                best = scored;
                chosen = Some(destination);
            }
        }
        if let Some(chosen) = chosen {
            let share =
                work.facts.mobility * moving.get(cell)? * going(cell, chosen.cell, chosen.passed)?;
            let residents = field.people.people(cell)? * km2(field, cell);
            leaving.request(cell, chosen.cell, share, residents, &mut arriving)?;
            if chosen.along > 0 {
                leaving.journeys.push(Journey {
                    from: cell,
                    residents,
                    through: route[..chosen.along].to_vec(),
                    crossed: chosen.crossed,
                });
            }
        }
    }
    Ok(arriving)
}
/// Moves the admitted share of each cell's people, and wears the cells far journeys pass
/// through into ways: a move's ends are worn by the move itself.
fn move_people(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    owner: &operations::Operations<Field>,
    leaving: &Leaving,
) -> ExecutionResult<()> {
    let years = work.facts.years / work.facts.sweeps as f64;
    let field = context.state();
    let mut worn = working(field);
    let mut moved = 0.0;
    for cell in 0..field.mesh.len() {
        if leaving.targets.get(cell)? >= 0 {
            moved += leaving.share.get(cell)? * field.people.people(cell)? * km2(field, cell);
        }
    }
    for journey in &leaving.journeys {
        let travellers = journey.residents * leaving.share.get(journey.from)?;
        for &cell in &journey.through {
            worn.set(cell, worn.get(cell)? + travellers * years)?;
        }
    }
    trace_journeys(leaving, moved)?;
    context.run(
        &owner.move_layer,
        &Move {
            kind: LayerId::Population,
            targets: leaving.targets.read_only(),
            share: leaving.share.read_only(),
            years,
        },
    )?;
    context.run(&owner.travel, &worn.read_only())
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
    // Spare food felt over the travel reach guides people across water to empty country.
    let mut room = working(field);
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            room.set(
                cell,
                (fed(cell)? - field.people.people(cell)?).max(0.0) * km2(field, cell),
            )?;
        }
    }
    let mut room_felt = working(field);
    work.reach(field, &room, &mut room_felt)?;
    let arriving = choose(
        context,
        &Routes {
            work,
            guide: &room_felt,
        },
        q,
        leaving,
        |_, to, passed| {
            Ok((fed(to)? - field.people.people(to)?).max(0.0) * km2(field, to) * passed)
        },
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
    leaving.admit(&arriving, |to| {
        Ok((fed(to)? - field.people.people(to)?).max(0.0) * km2(field, to))
    })?;
    move_people(context, work, owner, leaving)
}
fn drain(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
    leaving: &mut Leaving,
) -> ExecutionResult<()> {
    let draw = context.query(&q.draw)?.values();
    let field = context.state();
    let mut crowd = working(field);
    let mut drawing = working(field);
    for cell in 0..field.mesh.len() {
        if habitable(field, cell)? {
            crowd.set(cell, field.people.people(cell)? * km2(field, cell))?;
            drawing.set(cell, draw.get(cell)? * km2(field, cell))?;
        }
    }
    trace_draw(field, &draw)?;
    let pull = concentrated_pull(field, work, &drawing)?;
    let support = context.query(&q.support)?.values();
    let spare = |cell| {
        Ok::<_, io::Error>(
            (support.get(cell)? + work.imports.get(cell)? - field.people.people(cell)?).max(0.0)
                * km2(field, cell),
        )
    };
    let arriving = choose(
        context,
        &Routes { work, guide: &pull },
        q,
        leaving,
        |from, to, passed| {
            Ok((pull.get(to)? - pull.get(from)?).max(0.0)
                * passed
                * supported_share(1.0, spare(to)?, crowd.get(from)?))
        },
        |from, to, passed| {
            let rise = 1.0 - pull.get(from)? / pull.get(to)?;
            let of_range = ranges_of(passed);
            Ok(if rise > 0.0 {
                let willing = (rise / of_range.max(1e-9)).min(1.0);
                supported_share(willing, spare(to)?, crowd.get(from)?)
            } else {
                0.0
            })
        },
    )?;
    leaving.admit(&arriving, spare)?;
    move_people(context, work, owner, leaving)
}

/// How much more than its size a cell pulls: its draw against the country around it, raised
/// to the concentration exponent. A town above its country outdraws a crowd of the same size
/// spread thin; country no denser than its surroundings pulls in proportion.
pub fn concentration_weight(here: f64, around: f64) -> f64 {
    if here <= 0.0 || around <= 0.0 {
        return 1.0;
    }
    (here / around).max(1.0).powf(CONCENTRATION)
}
/// How much the places raise people's pull, written to the server log when
/// `ATLAS_TRACE_PEOPLE` is set: the people-weighted mean of draw over people, its largest
/// value, and the people living where places raise it by a tenth or more.
fn trace_draw(field: &Field, draw: &crate::storage::ReadBand<f64>) -> io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none() {
        return Ok(());
    }
    let (mut people, mut weighted, mut most, mut raised) = (0.0, 0.0, 0.0f64, 0.0);
    for cell in 0..field.mesh.len() {
        let living = field.people.people(cell)? * km2(field, cell);
        if living <= 0.0 {
            continue;
        }
        let ratio = draw.get(cell)? * km2(field, cell) / living;
        people += living;
        weighted += living * ratio;
        most = most.max(ratio);
        if ratio >= 1.1 {
            raised += living;
        }
    }
    eprintln!(
        "{}",
        serde_json::json!({"event": "people.draw", "details": {
            "people": people.round(),
            "meanDrawOverPeople": (weighted / people.max(1.0) * 1000.0).round() / 1000.0,
            "largest": (most * 1000.0).round() / 1000.0,
            "peopleWhereRaised": raised.round(),
        }})
    );
    Ok(())
}
/// The pull felt in each cell: every cell's draw, weighted by its concentration above the
/// country within the travel reach, spread back over that reach.
fn concentrated_pull(field: &Field, work: &Work, drawing: &Band<f64>) -> io::Result<Band<f64>> {
    let mut around = working(field);
    work.reach(field, drawing, &mut around)?;
    let mut weighted = working(field);
    for cell in 0..field.mesh.len() {
        let mass = drawing.get(cell)?;
        let land = work.land.get(cell)?;
        if mass <= 0.0 || land <= 0.0 {
            continue;
        }
        let here = mass / km2(field, cell);
        weighted.set(
            cell,
            mass * concentration_weight(here, around.get(cell)? / land),
        )?;
    }
    let mut pull = working(field);
    work.reach(field, &weighted, &mut pull)?;
    Ok(pull)
}
/// Remaining market supply constrains the arriving group. Existing residents'
/// food demand has already been deducted by the feeding process.
fn supported_share(willing: f64, spare: f64, source_people: f64) -> f64 {
    if source_people > 0.0 {
        willing.min(spare / source_people)
    } else {
        0.0
    }
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
                journeys: Vec::new(),
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

#[cfg(test)]
mod tests {
    use super::supported_share;

    #[test]
    fn groups_compete_for_food_at_their_shared_destination() {
        use crate::{
            field::tests::MemoryFile,
            storage::{BlockCache, BlockScratch, Coverage},
        };
        let cache = BlockCache::new(1_000_000, BlockScratch::new(MemoryFile::default()));
        let mut fields = Coverage::samples(4, cache);
        let mut leaving = super::Leaving {
            targets: fields.allocate(-1),
            share: fields.allocate(0.0),
            journeys: Vec::new(),
        };
        let mut arrivals = fields.allocate(0.0);
        leaving.request(0, 3, 0.5, 600.0, &mut arrivals).unwrap();
        leaving.request(1, 3, 0.5, 200.0, &mut arrivals).unwrap();
        leaving.request(2, 0, 0.5, 200.0, &mut arrivals).unwrap();
        leaving.admit(&arrivals, |_| Ok(100.0)).unwrap();
        assert_eq!(600.0 * leaving.share.get(0).unwrap(), 75.0);
        assert_eq!(200.0 * leaving.share.get(1).unwrap(), 25.0);
        assert_eq!(200.0 * leaving.share.get(2).unwrap(), 100.0);
    }

    #[test]
    fn a_town_above_its_country_pulls_more_than_its_size() {
        use super::concentration_weight;
        assert_eq!(concentration_weight(50.0, 50.0), 1.0);
        assert_eq!(concentration_weight(20.0, 50.0), 1.0);
        assert!(concentration_weight(5_000.0, 50.0) > concentration_weight(500.0, 50.0));
        assert!(concentration_weight(500.0, 50.0) > 1.0);
        assert_eq!(concentration_weight(0.0, 50.0), 1.0);
    }

    #[test]
    fn migration_uses_remaining_food_and_the_size_of_the_arriving_group() {
        assert_eq!(supported_share(0.5, 10_000.0, 2_000.0), 0.5);
        assert_eq!(supported_share(0.5, 100.0, 2_000.0), 0.05);
        assert_eq!(supported_share(0.5, 0.0, 2_000.0), 0.0);
        assert_eq!(supported_share(0.5, 100.0, 0.0), 0.0);
    }
}
