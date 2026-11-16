//! Caves that follow one line: a lava tube runs down the slope its flow took, and a fissure or
//! a thermal passage runs along the fracture trace that opened it.
use super::{
    network,
    settings::{
        FISSURE_FLOOR, FISSURE_WIDTH, MOUTH_DEPTH, OPEN_FROM, SHORTEST_PASSAGE, SKYLIGHT_SPACING,
        TUBE_ROOF, TUBE_WIDTH,
    },
    shape, Cave, Cell, Form, Opening,
};

fn members(cells: &[Cell], form: Form) -> Vec<bool> {
    cells
        .iter()
        .map(|c| c.host.is_some_and(|h| h.form == form))
        .collect()
}
fn bodies(cells: &[Cell], member: &[bool]) -> Vec<Vec<usize>> {
    let neighbours: Vec<_> = cells.iter().map(|c| c.neighbours).collect();
    network::components(&neighbours, member)
}
fn long_enough(cells: &[Cell], run: &[usize]) -> bool {
    let points: Vec<_> = run.iter().map(|&c| cells[c].position).collect();
    shape::length(&points) >= SHORTEST_PASSAGE
}
/// Each body of tube-holding ground keeps one tube, from its highest cell down its own flow.
pub fn tubes(cells: &[Cell]) -> Vec<Cave> {
    let member = members(cells, Form::LavaTube);
    let downhill: Vec<_> = cells.iter().map(|c| c.downhill).collect();
    let mut caves = Vec::new();
    for body in bodies(cells, &member) {
        let Some(&start) = body
            .iter()
            .max_by(|&&a, &&b| cells[a].ground.total_cmp(&cells[b].ground))
        else {
            continue;
        };
        let run = network::stem(start, &downhill, &member);
        if !long_enough(cells, &run) {
            continue;
        }
        let at = |cell: usize| {
            let top = cells[cell].host.map_or(0.0, |h| h.top);
            (TUBE_WIDTH, top + TUBE_ROOF)
        };
        let mut cave = Cave::new(Form::LavaTube);
        let passage = cave.add(cells, &run, at);
        let points: Vec<_> = run.iter().map(|&c| cells[c].position).collect();
        for index in shape::spaced(&points, SKYLIGHT_SPACING) {
            if index + 1 < run.len() {
                cave.open(
                    Opening::Skylight,
                    &cells[run[index]],
                    at(run[index]).1,
                    passage,
                );
            }
        }
        let end = run[run.len() - 1];
        cave.open(Opening::Mouth, &cells[end], at(end).1, passage);
        caves.push(cave);
    }
    caves
}
/// Each body of opened fractures keeps one passage along its longest trace.
pub fn fractured(cells: &[Cell], form: Form) -> Vec<Cave> {
    let member = members(cells, form);
    let neighbours: Vec<_> = cells.iter().map(|c| c.neighbours).collect();
    let mut caves = Vec::new();
    for body in bodies(cells, &member) {
        let run = network::spine(body[0], &neighbours, &member);
        if !long_enough(cells, &run) {
            continue;
        }
        let at = |cell: usize| {
            cells[cell]
                .host
                .map_or((FISSURE_WIDTH, FISSURE_FLOOR), |h| {
                    (
                        FISSURE_WIDTH * (h.openness / OPEN_FROM).max(1.0),
                        h.top + FISSURE_FLOOR.min(h.thickness),
                    )
                })
        };
        let mut cave = Cave::new(form);
        let passage = cave.add(cells, &run, at);
        cave.fracture_chambers(cells, &run, passage, at);
        for end in [run[0], run[run.len() - 1]] {
            if cells[end].host.is_some_and(|h| h.top <= MOUTH_DEPTH) {
                cave.open(Opening::Mouth, &cells[end], at(end).1, passage);
            }
        }
        caves.push(cave);
    }
    caves
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::processes::caves::{Host, Magic};

    /// Six cells in a row 20 m apart, falling eastward, each holding `form`.
    fn row(form: Form, fracture: [f64; 6]) -> Vec<Cell> {
        (0..6usize)
            .map(|at| Cell {
                position: [at as f64 * 20.0, 0.0],
                area: 200.0,
                neighbours: [at.checked_sub(1), (at < 5).then_some(at + 1), None],
                host: Some(Host {
                    form,
                    magic: (form == Form::Thermal).then_some(Magic::Fire),
                    top: 0.0,
                    thickness: 50.0,
                    openness: 0.9,
                }),
                groundwater: None,
                downhill: (at < 5).then_some(at + 1),
                ground: 50.0 - at as f64,
                recharges: true,
                fracture: fracture[at],
                opens: true,
            })
            .collect()
    }
    #[test]
    fn a_tube_runs_down_its_flow_and_opens_at_its_lower_end() {
        let caves = tubes(&row(Form::LavaTube, [0.0; 6]));
        assert_eq!(caves.len(), 1);
        let tube = &caves[0];
        assert_eq!(tube.passages[0].vertices[0].position, [0.0, 0.0]);
        assert_eq!(tube.passages[0].vertices[0].width, TUBE_WIDTH);
        let mouth = tube.entrances.last().unwrap();
        assert_eq!(
            (mouth.opening, mouth.position),
            (Opening::Mouth, [100.0, 0.0])
        );
    }
    #[test]
    fn a_fissure_follows_its_trace_widens_where_open_and_chambers_at_crossings() {
        let caves = fractured(
            &row(Form::Fissure, [0.5, 0.5, 0.9, 0.5, 0.5, 0.5]),
            Form::Fissure,
        );
        let fissure = &caves[0];
        assert_eq!(fissure.passages[0].vertices.len(), 10);
        assert!(fissure.passages[0].vertices[0].width > FISSURE_WIDTH);
        assert_eq!(fissure.chambers.len(), 1);
        assert_eq!(fissure.entrances.len(), 2);
    }
    #[test]
    fn short_traces_hold_no_cave_and_fire_marks_its_passages() {
        let mut cells = row(Form::Thermal, [0.5; 6]);
        assert_eq!(fractured(&cells, Form::Thermal)[0].magic, Some(Magic::Fire));
        cells.truncate(2);
        cells[1].neighbours = [Some(0), None, None];
        assert!(fractured(&cells, Form::Thermal).is_empty());
    }
}
