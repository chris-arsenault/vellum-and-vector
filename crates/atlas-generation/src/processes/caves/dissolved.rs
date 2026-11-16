//! Dissolved caves: groundwater gathers along its own routing, and where enough of it passes
//! through soluble rock the flow has opened a branching passage that falls toward its spring.
use super::{
    network,
    settings::{CONDUIT_FROM, CONDUIT_GRADIENT, MOUTH_DEPTH, WIDTH_PER_ROOT_CATCHMENT},
    Cave, Cell, Form, Magic, Opening,
};

struct Network {
    targets: Vec<Option<usize>>,
    kept: Vec<bool>,
    inflows: Vec<usize>,
    width: Vec<f64>,
    depth: Vec<f64>,
    /// Surface water from ground that does not dissolve sinks into the soluble rock here.
    fed: Vec<bool>,
}
fn stream_sinks(cells: &[Cell], member: &[bool]) -> Vec<bool> {
    let mut fed = vec![false; cells.len()];
    for (cell, here) in cells.iter().enumerate() {
        if let Some(next) = here.downhill.filter(|&next| !member[cell] && member[next]) {
            fed[next] = true;
        }
    }
    fed
}
fn host_top(cell: &Cell) -> (f64, f64) {
    cell.host
        .map_or((0.0, 0.0), |h| (h.top, h.top + h.thickness))
}
/// Passage floors fall toward the outlet, where the passage meets the ground, and stay within
/// the soluble bed: a passage sits on the insoluble bed beneath it rather than cutting it.
pub fn depths(
    cells: &[Cell],
    targets: &[Option<usize>],
    kept: &[bool],
    order: &[usize],
) -> Vec<f64> {
    let mut depth = vec![0.0; cells.len()];
    for &cell in order.iter().rev().filter(|&&c| kept[c]) {
        let here = &cells[cell];
        let floor = match targets[cell].filter(|&next| kept[next]) {
            Some(next) => {
                let [x, y] = here.position;
                let [nx, ny] = cells[next].position;
                let below = cells[next].ground - depth[next];
                (below + CONDUIT_GRADIENT * (nx - x).hypot(ny - y)).min(here.ground)
            }
            None => here.ground,
        };
        let (top, bottom) = host_top(here);
        depth[cell] = (here.ground - floor).clamp(top, bottom.max(top));
    }
    depth
}
fn network(cells: &[Cell]) -> (Network, Vec<bool>) {
    let targets: Vec<_> = cells.iter().map(|c| c.groundwater.or(c.downhill)).collect();
    let supply: Vec<_> = cells
        .iter()
        .map(|c| if c.recharges { c.area } else { 0.0 })
        .collect();
    let (order, catchment) = network::accumulate(&targets, &supply);
    let member: Vec<bool> = cells
        .iter()
        .map(|c| c.host.is_some_and(|h| h.form == Form::Dissolved))
        .collect();
    let kept: Vec<bool> = (0..cells.len())
        .map(|c| member[c] && catchment[c] >= CONDUIT_FROM)
        .collect();
    let depth = depths(cells, &targets, &kept, &order);
    let inflows = network::kept_inflows(&targets, &kept);
    let width = catchment
        .iter()
        .map(|area| WIDTH_PER_ROOT_CATCHMENT * area.sqrt())
        .collect();
    let built = Network {
        targets,
        kept,
        inflows,
        width,
        depth,
        fed: stream_sinks(cells, &member),
    };
    (built, member)
}
/// A passage close under the ground opens at a mouth; a deeper one only where the ground has
/// fallen into it, a sinkhole with a shaft down.
fn opening(depth: f64) -> Opening {
    if depth <= MOUTH_DEPTH {
        Opening::Mouth
    } else {
        Opening::Sinkhole
    }
}
/// A branch head opens near the surface or where a stream sinks into it; the outlet opens
/// where the passage reaches its spring; Greenwood's sinkhole ground opens wherever it lies.
fn openings(cave: &mut Cave, cells: &[Cell], net: &Network, run: &[usize], passage: usize) {
    let (first, last) = (run[0], run[run.len() - 1]);
    let head = net.inflows[first] == 0;
    if head && (net.depth[first] <= MOUTH_DEPTH || net.fed[first]) {
        cave.open(
            opening(net.depth[first]),
            &cells[first],
            net.depth[first],
            passage,
        );
    }
    let outlet = net.targets[last].is_none_or(|next| !net.kept[next]);
    if outlet && net.depth[last] <= MOUTH_DEPTH {
        cave.open(Opening::Mouth, &cells[last], net.depth[last], passage);
    }
    let greenwood = run[1..run.len() - 1].iter().find(|&&c| {
        cells[c]
            .host
            .is_some_and(|h| h.magic == Some(Magic::Greenwood))
    });
    if let Some(&cell) = greenwood {
        cave.open(Opening::Sinkhole, &cells[cell], net.depth[cell], passage);
    }
}
/// One cave per connected body of dissolved rock that holds a passage.
pub fn caves(cells: &[Cell]) -> Vec<Cave> {
    let (net, member) = network(cells);
    let neighbours: Vec<_> = cells.iter().map(|c| c.neighbours).collect();
    let groups = network::components(&neighbours, &member);
    let mut body = vec![usize::MAX; cells.len()];
    for (index, group) in groups.iter().enumerate() {
        for &cell in group {
            body[cell] = index;
        }
    }
    let mut caves: Vec<Option<Cave>> = vec![None; groups.len()];
    let mut shallowest: Vec<Option<(usize, usize)>> = vec![None; groups.len()];
    let at = |cell: usize| (net.width[cell], net.depth[cell]);
    for run in network::branches(&net.targets, &net.kept) {
        let index = body[run[0]];
        let cave = caves[index].get_or_insert_with(|| Cave::new(Form::Dissolved));
        let passage = cave.add(cells, &run, at);
        if net.inflows[run[0]] >= 2 {
            let (width, depth) = at(run[0]);
            cave.chamber(cells[run[0]].position, width, depth, passage);
        }
        cave.fracture_chambers(cells, &run, passage, at);
        openings(cave, cells, &net, &run, passage);
        for &cell in run.iter().filter(|&&c| cells[c].opens) {
            let known = shallowest[index].is_some_and(|(c, _)| net.depth[c] <= net.depth[cell]);
            if !known {
                shallowest[index] = Some((cell, passage));
            }
        }
    }
    // A cave the ground has opened nowhere else is entered where it lies shallowest.
    for (cave, shallow) in caves.iter_mut().zip(shallowest) {
        if let (Some(cave), Some((cell, passage))) = (cave, shallow) {
            if cave.entrances.is_empty() {
                let depth = net.depth[cell];
                cave.open(opening(depth), &cells[cell], depth, passage);
            }
        }
    }
    caves.into_iter().flatten().collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::processes::caves::Host;

    fn limestone(top: f64) -> Option<Host> {
        Some(Host {
            form: Form::Dissolved,
            magic: None,
            top,
            thickness: 60.0,
            openness: 0.9,
        })
    }
    /// A valley side: cells 0..5 west to east, 100 m apart, falling 10 m each toward a spring
    /// at cell 4; cell 5, with a larger catchment, drains into 3 as a side branch.
    fn hillside() -> Vec<Cell> {
        let line = |at: usize, next: Option<usize>, x: f64, y: f64| Cell {
            position: [x, y],
            area: if at == 5 { 30_000.0 } else { 10_000.0 },
            neighbours: match at {
                0 => [Some(1), None, None],
                3 => [Some(2), Some(4), Some(5)],
                4 => [Some(3), None, None],
                5 => [Some(3), None, None],
                _ => [Some(at - 1), Some(at + 1), None],
            },
            host: limestone(0.0),
            groundwater: next,
            downhill: None,
            ground: 100.0 - 10.0 * x / 100.0 + if at == 5 { 20.0 } else { 0.0 },
            recharges: true,
            fracture: 0.1,
            opens: true,
        };
        let mut cells: Vec<Cell> = (0..5)
            .map(|at| line(at, (at < 4).then_some(at + 1), at as f64 * 100.0, 0.0))
            .collect();
        cells.push(line(5, Some(3), 300.0, 100.0));
        cells
    }
    #[test]
    fn passage_floors_fall_to_the_spring_and_open_there() {
        let cells = hillside();
        let targets: Vec<_> = cells.iter().map(|c| c.groundwater).collect();
        let (order, _) = network::accumulate(&targets, &[1.0; 6]);
        let depth = depths(&cells, &targets, &[true; 6], &order);
        assert_eq!(depth[4], 0.0);
        assert!(depth[0] > depth[2] && depth[2] > depth[4]);
        let cave = &caves(&cells)[0];
        let mouths: Vec<_> = cave
            .entrances
            .iter()
            .filter(|e| e.opening == Opening::Mouth)
            .collect();
        assert_eq!(mouths.len(), 1);
        assert_eq!(mouths[0].position, [400.0, 0.0]);
    }
    #[test]
    fn small_catchments_dissolve_nothing_and_confluences_open_chambers() {
        let cave = &caves(&hillside())[0];
        assert!(cave
            .passages
            .iter()
            .all(|p| p.vertices[0].position != [0.0, 0.0]));
        assert_eq!(cave.chambers.len(), 1);
        assert!(cave.entrances.iter().all(|e| e.opening == Opening::Mouth));
    }
    #[test]
    fn a_stream_off_insoluble_ground_sinks_into_the_head_of_a_passage() {
        let mut cells = hillside();
        cells[0].host = None;
        cells[0].downhill = Some(1);
        let cave = &caves(&cells)[0];
        let sinkholes: Vec<_> = cave
            .entrances
            .iter()
            .filter(|e| e.opening == Opening::Sinkhole)
            .collect();
        assert_eq!(sinkholes.len(), 1);
        assert_eq!(sinkholes[0].position, [100.0, 0.0]);
        assert!(sinkholes[0].depth > MOUTH_DEPTH);
    }
    #[test]
    fn a_passage_stays_within_its_soluble_bed() {
        let mut cells = hillside();
        for cell in &mut cells {
            cell.host = limestone(15.0);
        }
        let cave = &caves(&cells)[0];
        assert!(cave
            .passages
            .iter()
            .flat_map(|p| &p.vertices)
            .all(|v| v.depth >= 15.0));
        assert_eq!(cave.entrances.len(), 1);
        assert_eq!(cave.entrances[0].opening, Opening::Sinkhole);
        assert_eq!(cave.entrances[0].depth, 15.0);
    }
}
