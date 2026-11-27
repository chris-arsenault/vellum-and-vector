//! Collective investment compares the protected population and cost of alternative enclosures.
use super::{
    fields::{neighborhood, policy, position},
    geometry::{pos, xy},
    landscape::contour,
    Urban,
};
use crate::{
    atlas::{regional::city::captured_settlement, state::State},
    field::{people::work::habitable, refinement::courses::cell_at, shared::Scalar},
    town::{
        geometry::distance,
        walls::{enclosure_value, Section, Wall},
    },
};
use atlas_map::{
    regions::{boundary_lines, parts},
    Geometry,
};
use std::io;

fn proposal(
    state: &State,
    u: &Urban,
    shape: Geometry,
    positions: &[atlas_map::Position],
    old: &[Wall],
    city_area: f64,
) -> io::Result<Option<(f64, Wall)>> {
    let mesh = state.field().mesh();
    let Geometry::Polygon { coordinates } = shape else {
        return Ok(None);
    };
    let Some(exterior) = coordinates.into_iter().next() else {
        return Ok(None);
    };
    let envelope = Geometry::Polygon {
        coordinates: vec![exterior.clone()],
    };
    let area = state.spatial.area(&envelope).map_err(io::Error::other)?;
    let covered = state
        .spatial
        .covers_points(&envelope, positions)
        .map_err(io::Error::other)?;
    let mut population = 0.;
    let mut new_population = 0.;
    let mut inside = Vec::new();
    for (c, _) in covered.iter().enumerate().filter(|(_, b)| **b) {
        inside.push(c as u32);
        let people = u.fields.claims[c].people * mesh.area(c) / 1e6;
        population += people;
        if old.iter().all(|w| !w.encloses(c)) {
            new_population += people;
        }
    }
    if new_population <= 0. || new_population < 0.5 * population {
        return Ok(None);
    }
    let deviation = mesh.spacing().max(city_area.sqrt() * 0.005);
    let trace = state
        .spatial
        .resample_trace(
            &Geometry::LineString {
                coordinates: exterior,
            },
            deviation,
            Some(mesh.spacing() * 2.),
        )
        .map_err(io::Error::other)?;
    let mut sections = Vec::new();
    let mut cost = 0.;
    let slope = state.field().shared().scalar(Scalar::Slope);
    for ring in boundary_lines(&trace) {
        for pair in ring.windows(2) {
            let [a, b] = [xy(pair[0]), xy(pair[1])];
            let mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
            let Some(c) = cell_at(mesh, mid) else {
                continue;
            };
            if !habitable(state.field(), c)? || slope.get(c)? > 0.4 {
                continue;
            }
            let x = u.fields.claims[c];
            let length = distance(a, b);
            if length <= 0. {
                continue;
            }
            let effort = length * (1. + x.built + u.fields.access[c] * x.trade.ln_1p().max(0.));
            sections.push(Section {
                ends: [a, b],
                cell: c,
                cost: effort,
                built: 0.,
                disused: 0.,
                repaired: 0.,
            });
            cost += effort;
        }
    }
    if sections.is_empty() {
        return Ok(None);
    }
    let value = enclosure_value(area / city_area, new_population, cost);
    let town = captured_settlement(state)?;
    let era = town
        .as_ref()
        .and_then(|f| f.attributes.get("history"))
        .and_then(|v| v.as_array())
        .and_then(|h| {
            h.iter()
                .find(|e| e["townsfolk"].as_f64().is_some_and(|p| p >= population))
        })
        .and_then(|e| e["era"].as_str())
        .map(str::to_owned);
    Ok(Some((
        value,
        Wall {
            round: state.regional.as_ref().unwrap().round,
            inside,
            area,
            sections,
            era,
            ..Default::default()
        },
    )))
}

pub(super) fn invest(state: &State, u: &Urban) -> io::Result<Vec<Wall>> {
    let r = state.regional.as_ref().unwrap();
    let mut walls = r.city.walls.clone();
    let p = policy(state)?;
    let town = captured_settlement(state)?;
    let contested = town.as_ref().is_some_and(|f| {
        f.attributes
            .get("contestedBy")
            .is_some_and(|v| !v.is_null())
    });
    // A site that is guarded, contested or a realm's seat sponsors walls, and so does a
    // civic order that defends itself.
    let civic = p.civic;
    let sponsor = p.site.guarded
        || p.enclosed_seat().is_some()
        || p.site.seat
        || contested
        || civic.is_some_and(crate::town::templates::civic::Civic::defends);
    if !sponsor {
        return Ok(walls);
    }
    let mesh = state.field().mesh();
    let mut occupied = Vec::with_capacity(mesh.len());
    let mut supporters = 0.;
    let mut capital = 0.;
    let standing = state.field().people().view(crate::human::HumanField::Layer(
        crate::human::catalogue::LayerId::Standing,
    ));
    for (c, x) in u.fields.claims.iter().enumerate() {
        let area_km = mesh.area(c) / 1e6;
        let share = u.fields.stencil[c];
        supporters += x.people * share * area_km;
        capital += standing.get(c)?.max(0.) * share * area_km;
        occupied.push(
            share
                * (x.people.max(0.) / 500.).ln_1p()
                * (0.45
                    + x.built.sqrt()
                    + 0.35 * u.fields.developed[c]
                    + 0.25 * u.fields.civic[c]
                    + 0.25 * u.fields.access[c]),
        );
    }
    // Each spatial pass can allocate part of the available standing stock. Earlier work
    // stays charged, even when the same sponsor reconsiders the same project next round.
    let capacity =
        capital / (crate::human::catalogue::FULL_STANDING_PER_BUILT_KM2 * 8. / 1e6) * 0.15;
    let spent: f64 = walls.iter().map(Wall::funded).sum();
    let budget = (capacity - spent).max(0.).min(supporters * 0.12);
    let citadel = civic.map_or(1., crate::town::templates::civic::Civic::citadel);
    choose_enclosure(state, u, &mut walls, &occupied, (budget, citadel))?;
    fund_sections(u, r, &mut walls, mesh, supporters, budget);
    Ok(walls)
}

fn fund_sections(
    u: &Urban,
    r: &crate::atlas::state::Regional,
    walls: &mut [Wall],
    mesh: &crate::lattice::TriangularLattice,
    supporters: f64,
    mut budget: f64,
) {
    for w in walls {
        assess_disuse(u, r.round, w, mesh, supporters);
        let mut bids = crate::hpc::KeyedHeap::new(
            [crate::hpc::Direction::Descending],
            crate::hpc::Direction::Ascending,
        );
        let benefits: Vec<_> = w
            .sections
            .iter()
            .map(|s| {
                let x = u.fields.claims[s.cell];
                (1. + u.fields.access[s.cell] + x.built) / (1. + x.ruin)
            })
            .collect();
        let n = w.sections.len();
        for (i, s) in w.sections.iter().enumerate() {
            if s.built < s.cost || s.repaired < s.disused {
                let adjacent =
                    w.sections[(i + n - 1) % n].built > 0. || w.sections[(i + 1) % n].built > 0.;
                bids.push(i as u32, [benefits[i] * (1. + 2. * f64::from(adjacent))]);
            }
        }
        while let Some((i, _)) = bids.pop() {
            let i = i as usize;
            let s = &mut w.sections[i];
            if s.built >= s.cost && s.repaired >= s.disused {
                continue;
            }
            let repair = budget.min((s.disused - s.repaired).max(0.));
            s.repaired += repair;
            budget -= repair;
            let add = budget.min(s.cost - s.built);
            s.built += add;
            budget -= add;
            if budget <= 0. {
                break;
            }
            for j in [(i + n - 1) % n, (i + 1) % n] {
                if w.sections[j].built < w.sections[j].cost {
                    bids.push(j as u32, [3. * benefits[j]]);
                }
            }
        }
        w.lines = w.sections.iter().filter_map(Section::standing).collect();
    }
}

fn assess_disuse(
    u: &Urban,
    round: usize,
    w: &mut Wall,
    mesh: &crate::lattice::TriangularLattice,
    supporters: f64,
) {
    let residents: f64 = w
        .inside
        .iter()
        .map(|&c| u.fields.claims[c as usize].people * mesh.area(c as usize) / 1e6)
        .sum();
    w.outgrown |= w.round < round && residents < 0.45 * supporters;
    // Resolve the inherited present condition once from local evidence. Repeated
    // spatial passes neither manufacture extra years of decay nor refund old work.
    if w.outgrown {
        for s in &mut w.sections {
            let x = u.fields.claims[s.cell];
            let loss = (x.ruin - x.built).max(0.) / (0.01 + x.ruin + x.built);
            s.disused = s.disused.max(s.built * loss);
        }
    }
}

/// The share of a circuit that must stand before its sponsor stops reconsidering its line.
const WELL_BEGUN: f64 = 0.2;
/// The line a sponsor may still redraw this round: its newest circuit, if that is
/// unfinished and not yet well begun. The city gathers and shifts between rounds, and a
/// line drawn before it gathered should not bind it.
fn redrawn(walls: &mut Vec<Wall>) -> Option<Wall> {
    let unsettled = walls.last().is_some_and(|wall| {
        wall.sections.iter().any(|s| s.built < s.cost) && wall.standing_share() < WELL_BEGUN
    });
    if unsettled {
        walls.pop()
    } else {
        None
    }
}
/// The shares of occupied ground whose pressure contours a sponsor considers as rings.
/// A citadel above one draws every ring in round more crowded ground.
fn ring_shares(citadel: f64) -> [f64; 3] {
    let usual = [0.32, 0.56, 0.76];
    if citadel <= 1. {
        return usual;
    }
    usual.map(|share| 1. - (1. - share) / citadel)
}
fn choose_enclosure(
    state: &State,
    u: &Urban,
    walls: &mut Vec<Wall>,
    occupied: &[f64],
    (budget, citadel): (f64, f64),
) -> io::Result<()> {
    let mesh = state.field().mesh();
    let area = state
        .spatial
        .area(state.scope.settled_outline())
        .map_err(io::Error::other)?;
    let positions: Vec<_> = (0..mesh.len()).map(|c| pos(position(mesh, c))).collect();
    let earlier = redrawn(walls);
    if budget > 0.
        && walls
            .iter()
            .all(|w| w.sections.iter().all(|s| s.built >= s.cost))
    {
        let reach = (area.sqrt() * 0.055).max(2. * mesh.spacing());
        let pressure: Vec<_> = (0..mesh.len())
            .map(|c| neighborhood(mesh, [occupied], c, reach)[0])
            .collect();
        let values: Vec<_> = pressure
            .iter()
            .zip(&u.fields.stencil)
            .filter(|(_, s)| **s > 0.5)
            .map(|(v, _)| *v)
            .collect();
        let order = crate::hpc::radix_order(
            &[crate::hpc::NumericKey::Float(&values)],
            crate::hpc::Direction::Ascending,
        )
        .map_err(io::Error::other)?;
        let mut best = None;
        for fraction in ring_shares(citadel) {
            if values.is_empty() {
                break;
            }
            let level = values[order[((values.len() - 1) as f64 * fraction) as usize]];
            let Some(shape) = contour(state, &pressure, level.max(f64::EPSILON))? else {
                continue;
            };
            for poly in parts(&shape) {
                if let Some((value, wall)) = proposal(state, u, poly, &positions, walls, area)? {
                    if value > 0.12 && best.as_ref().is_none_or(|(v, _)| value > *v) {
                        best = Some((value, wall));
                    }
                }
            }
        }
        // The line this round's city calls for replaces one barely begun; with no better
        // line to draw, the earlier one stands.
        if let Some(wall) = best.map(|(_, wall)| wall).or(earlier) {
            walls.push(wall);
        }
    } else if let Some(wall) = earlier {
        walls.push(wall);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn circuit(built: [f64; 4]) -> Wall {
        Wall {
            inside: vec![0],
            sections: built
                .map(|built| Section {
                    ends: [[0., 0.], [100., 0.]],
                    cell: 0,
                    cost: 100.,
                    built,
                    disused: 0.,
                    repaired: 0.,
                })
                .to_vec(),
            ..Default::default()
        }
    }

    #[test]
    fn a_sponsor_redraws_a_line_barely_begun_and_keeps_one_well_begun() {
        // A finished old wall and a new line with a tenth of its work done: the new line
        // may be redrawn, the old wall stays.
        let mut walls = vec![circuit([100.; 4]), circuit([40., 0., 0., 0.])];
        assert!(redrawn(&mut walls).is_some());
        assert_eq!(walls.len(), 1);
        // A line a third built binds its sponsor.
        let mut walls = vec![circuit([100., 35., 0., 0.])];
        assert!(redrawn(&mut walls).is_none());
        assert_eq!(walls.len(), 1);
        // A finished wall is never redrawn, and a city with none has none to redraw.
        assert!(redrawn(&mut vec![circuit([100.; 4])]).is_none());
        assert!(redrawn(&mut Vec::new()).is_none());
    }

    #[test]
    fn a_citadel_draws_its_rings_round_more_crowded_ground() {
        assert_eq!(ring_shares(1.), [0.32, 0.56, 0.76]);
        // Twice the citadel halves the ground left outside each ring's level.
        let tight = ring_shares(2.);
        assert!((tight[0] - 0.66).abs() < 1e-12 && (tight[2] - 0.88).abs() < 1e-12);
        assert!(tight
            .iter()
            .zip(ring_shares(1.))
            .all(|(tight, usual)| *tight > usual));
        // An order that builds no citadel leaves the rings as they were.
        assert_eq!(ring_shares(0.5), ring_shares(1.));
    }
}
