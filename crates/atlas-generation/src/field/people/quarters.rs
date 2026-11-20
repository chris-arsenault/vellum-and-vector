//! What a city map's hot-spot towns do to its people layers, after each round's town steps.
//! The towns' blocks house people, cover ground with buildings and carry thoroughfares. The
//! people layers take that up through the people owner, so the next round's refinement and
//! growth start from the city the towns built: people move toward blocks that house more
//! people than live there, built ground rises to the blocks' cover, and thoroughfares become
//! maintained ways.

/// Years of city life one pass stands for: how long its thoroughfares have been kept.
const QUARTER_YEARS: f64 = 10.;
/// The largest share of a cell's people that moves toward housing in one pass.
const MOVING: f64 = 0.4;

/// What the towns built, cell by cell.
pub struct Quarters {
    /// People the towns' blocks house at each cell.
    pub housed: Vec<f64>,
    /// Share of each cell the towns' blocks build up, as built ground counts it.
    pub covered: Vec<f64>,
    /// Cells the towns' thoroughfares cross.
    pub ways: Vec<usize>,
    /// How many lattice steps people move toward housing in one pass.
    pub reach: usize,
}

/// Bring the people layers to the towns' blocks through the people owner.
pub fn operation(
    owner: std::rc::Rc<crate::human::operations::Operations<crate::field::Field>>,
) -> crate::execution::Command<crate::field::Field, Quarters> {
    use crate::human::{
        catalogue::LayerId,
        operations::{Convert, Keep, Lay, Move},
        HumanField,
    };
    crate::execution::Command::with_inputs(
        "human.city.quarters",
        crate::execution::CommandKind::Event,
        vec![],
        move |context, quarters: &Quarters| {
            let field = context.state();
            let mesh = &field.mesh;
            let n = mesh.len();
            let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
            let farmed = field.people.view(HumanField::Layer(LayerId::Farmland));
            let grazed = field.people.view(HumanField::Layer(LayerId::Pasture));
            let mut people = Vec::with_capacity(n);
            // Blocks are built over fields and pasture first, then over open ground.
            let mut over_fields = super::work::working(field);
            let mut over_pasture = super::work::working(field);
            let mut over_open = super::work::working(field);
            for cell in 0..n {
                let area = super::work::km2(field, cell);
                people.push(field.people.people(cell)? * area);
                let cover = quarters.covered.get(cell).copied().unwrap_or(0.);
                let mut need = (cover - built.get(cell)?).max(0.);
                let fields = need.min(farmed.get(cell)?.max(0.));
                need -= fields;
                let pasture = need.min(grazed.get(cell)?.max(0.));
                over_fields.set(cell, fields)?;
                over_pasture.set(cell, pasture)?;
                over_open.set(cell, need - pasture)?;
            }
            let neighbours = |cell| [0, 1, 2].map(|edge| mesh.neighbor(cell, edge));
            let moved = toward(&people, &quarters.housed, quarters.reach, neighbours);
            let mut targets = field.coverage.borrow_mut().scratch(n, -1i32);
            let mut share = super::work::working(field);
            for (cell, (target, part)) in moved.into_iter().enumerate() {
                targets.set(cell, target)?;
                share.set(cell, part)?;
            }
            context.run(
                &owner.move_layer,
                &Move {
                    kind: LayerId::Population,
                    targets: targets.read_only(),
                    share: share.read_only(),
                    years: QUARTER_YEARS,
                },
            )?;
            for (from, amount) in [
                (LayerId::Farmland, over_fields),
                (LayerId::Pasture, over_pasture),
            ] {
                context.run(
                    &owner.convert,
                    &Convert {
                        from,
                        to: LayerId::BuiltUp,
                        amount: amount.read_only(),
                    },
                )?;
            }
            context.run(
                &owner.lay,
                &Lay {
                    kind: LayerId::BuiltUp,
                    amount: over_open.read_only(),
                },
            )?;
            context.run(
                &owner.keep,
                &Keep {
                    cells: quarters.ways.clone(),
                    years: QUARTER_YEARS,
                },
            )
        },
    )
}

/// Where each cell's people move, and what share of them: toward the cell within `reach`
/// steps whose housing most exceeds the people living there, nearer cells first among equals.
/// Housing is taken up as people are sent, so no block is sent more people than it houses and
/// no cell sends away more than lives there beyond its own housing.
pub fn toward(
    people: &[f64],
    housed: &[f64],
    reach: usize,
    neighbours: impl Fn(usize) -> [Option<usize>; 3],
) -> Vec<(i32, f64)> {
    let n = people.len();
    let mut room: Vec<f64> = (0..n)
        .map(|c| (housed.get(c).copied().unwrap_or(0.) - people[c]).max(0.))
        .collect();
    let mut seen = vec![usize::MAX; n];
    let mut frontier = Vec::new();
    let mut next = Vec::new();
    let mut moves = vec![(-1, 0.); n];
    for cell in 0..n {
        let spare = people[cell] - housed.get(cell).copied().unwrap_or(0.);
        if spare <= 0. {
            continue;
        }
        // A breadth-first walk to `reach` steps; the best room is the largest, nearest first.
        frontier.clear();
        frontier.push(cell);
        seen[cell] = cell;
        let mut best: Option<(usize, f64)> = None;
        for step in 1..=reach {
            next.clear();
            for &at in &frontier {
                for to in neighbours(at).into_iter().flatten() {
                    if seen[to] == cell {
                        continue;
                    }
                    seen[to] = cell;
                    next.push(to);
                    let pull = room[to] / step as f64;
                    if room[to] > 0. && best.is_none_or(|(_, b)| pull > b) {
                        best = Some((to, pull));
                    }
                }
            }
            std::mem::swap(&mut frontier, &mut next);
        }
        let Some((target, _)) = best else {
            continue;
        };
        let sent = spare.min(room[target]).min(MOVING * people[cell]);
        room[target] -= sent;
        moves[cell] = (target as i32, sent / people[cell]);
    }
    moves
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: usize) -> impl Fn(usize) -> [Option<usize>; 3] {
        move |cell| {
            [
                cell.checked_sub(1),
                (cell + 1 < n).then_some(cell + 1),
                None,
            ]
        }
    }

    #[test]
    fn people_move_into_blocks_that_house_more_than_live_there_and_no_further() {
        // A block at cell 5 houses 300 people where 100 live; the country round it holds 100
        // a cell.
        let people = vec![100.; 10];
        let mut housed = vec![0.; 10];
        housed[5] = 300.;
        let moves = toward(&people, &housed, 3, line(10));
        // Neighbours within reach send people to the block; the block sends none.
        assert_eq!(moves[5], (-1, 0.));
        assert_eq!(moves[4].0, 5);
        // Ground beyond reach keeps its people.
        assert_eq!(moves[0], (-1, 0.));
        // The block is sent no more than its 200 spare places.
        let sent: f64 = moves
            .iter()
            .enumerate()
            .filter(|(_, m)| m.0 == 5)
            .map(|(c, m)| m.1 * people[c])
            .sum();
        assert!(sent <= 200. + 1e-9 && sent > 0., "{sent}");
        // No cell sends away more than its moving share.
        assert!(moves.iter().all(|m| m.1 <= MOVING + 1e-12));
    }

    #[test]
    fn people_already_housed_stay_and_a_city_without_blocks_moves_no_one() {
        let people = vec![50., 200., 50.];
        let housed = vec![0., 400., 0.];
        // The block's own people are housed; its neighbours move toward it.
        let moves = toward(&people, &housed, 1, line(3));
        assert_eq!(moves[1], (-1, 0.));
        assert_eq!(moves[0].0, 1);
        assert!(toward(&people, &[0.; 3], 2, line(3))
            .iter()
            .all(|m| *m == (-1, 0.)));
    }
}
