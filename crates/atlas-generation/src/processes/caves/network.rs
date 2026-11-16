//! Graph steps on explicit cell graphs: flow accumulation, branch runs, downhill stems,
//! connected components and the long spine of a component.
use std::collections::VecDeque;

pub type Neighbours = [Option<usize>; 3];

/// Cells in an order that visits every cell after all cells draining into it, with each
/// cell's upstream total of `supply` along `targets`. Cells caught in a loop are left out.
pub fn accumulate(targets: &[Option<usize>], supply: &[f64]) -> (Vec<usize>, Vec<f64>) {
    let mut inflows = vec![0usize; targets.len()];
    for target in targets.iter().flatten() {
        inflows[*target] += 1;
    }
    let mut ready: Vec<usize> = (0..targets.len()).filter(|&c| inflows[c] == 0).collect();
    let mut totals = supply.to_vec();
    let mut order = Vec::with_capacity(targets.len());
    while let Some(cell) = ready.pop() {
        order.push(cell);
        if let Some(next) = targets[cell] {
            totals[next] += totals[cell];
            inflows[next] -= 1;
            if inflows[next] == 0 {
                ready.push(next);
            }
        }
    }
    (order, totals)
}
/// How many kept cells drain into each cell.
pub fn kept_inflows(targets: &[Option<usize>], kept: &[bool]) -> Vec<usize> {
    let mut inflows = vec![0; targets.len()];
    for (cell, target) in targets.iter().enumerate() {
        if let Some(next) = target.filter(|&next| kept[cell] && kept[next]) {
            inflows[next] += 1;
        }
    }
    inflows
}
/// The kept network as runs: each starts at a head or a confluence and follows the flow to the
/// next confluence or the network's outlet, which closes the run.
pub fn branches(targets: &[Option<usize>], kept: &[bool]) -> Vec<Vec<usize>> {
    let inflows = kept_inflows(targets, kept);
    let mut runs = Vec::new();
    for start in (0..targets.len()).filter(|&c| kept[c] && inflows[c] != 1) {
        let mut run = vec![start];
        let mut cell = start;
        while let Some(next) = targets[cell].filter(|&next| kept[next]) {
            run.push(next);
            if inflows[next] >= 2 || run.len() > targets.len() {
                break;
            }
            cell = next;
        }
        if run.len() > 1 {
            runs.push(run);
        }
    }
    runs
}
/// Following the flow from `start` while it stays among the members.
pub fn stem(start: usize, targets: &[Option<usize>], member: &[bool]) -> Vec<usize> {
    let mut run = vec![start];
    let mut cell = start;
    while let Some(next) = targets[cell].filter(|&next| member[next]) {
        if run.len() > targets.len() {
            break;
        }
        run.push(next);
        cell = next;
    }
    run
}
/// Connected groups of member cells.
pub fn components(neighbours: &[Neighbours], member: &[bool]) -> Vec<Vec<usize>> {
    let mut seen = vec![false; neighbours.len()];
    let mut groups = Vec::new();
    for start in 0..neighbours.len() {
        if !member[start] || seen[start] {
            continue;
        }
        seen[start] = true;
        let mut group = Vec::new();
        let mut queue = VecDeque::from([start]);
        while let Some(cell) = queue.pop_front() {
            group.push(cell);
            for next in neighbours[cell].into_iter().flatten() {
                if member[next] && !seen[next] {
                    seen[next] = true;
                    queue.push_back(next);
                }
            }
        }
        groups.push(group);
    }
    groups
}
/// Breadth-first distances in steps from `start` among the members, with each cell's parent.
fn reach(start: usize, neighbours: &[Neighbours], member: &[bool]) -> (usize, Vec<Option<usize>>) {
    let mut parent = vec![None; neighbours.len()];
    let mut seen = vec![false; neighbours.len()];
    seen[start] = true;
    let mut queue = VecDeque::from([start]);
    let mut last = start;
    while let Some(cell) = queue.pop_front() {
        last = cell;
        for next in neighbours[cell].into_iter().flatten() {
            if member[next] && !seen[next] {
                seen[next] = true;
                parent[next] = Some(cell);
                queue.push_back(next);
            }
        }
    }
    (last, parent)
}
/// The longest of the shortest paths through the component holding `start`: the line a
/// fracture-guided passage follows along its trace.
pub fn spine(start: usize, neighbours: &[Neighbours], member: &[bool]) -> Vec<usize> {
    let (end, _) = reach(start, neighbours, member);
    let (other, parent) = reach(end, neighbours, member);
    let mut path = vec![other];
    while let Some(previous) = parent[*path.last().unwrap()] {
        path.push(previous);
    }
    path
}
#[cfg(test)]
mod tests {
    use super::*;
    /// A tree: 0→2, 1→2, 2→3, 3→4, 5→4; 4 is the outlet.
    fn tree() -> Vec<Option<usize>> {
        vec![Some(2), Some(2), Some(3), Some(4), None, Some(4)]
    }
    #[test]
    fn accumulation_sums_everything_upstream_and_orders_upstream_first() {
        let (order, totals) = accumulate(&tree(), &[1.0; 6]);
        assert_eq!(totals, vec![1.0, 1.0, 3.0, 4.0, 6.0, 1.0]);
        let at = |cell| order.iter().position(|&c| c == cell).unwrap();
        assert!(at(0) < at(2) && at(2) < at(3) && at(3) < at(4) && at(5) < at(4));
    }
    #[test]
    fn a_loop_is_left_out_of_the_order() {
        let (order, _) = accumulate(&[Some(1), Some(0), None], &[1.0; 3]);
        assert_eq!(order, vec![2]);
    }
    #[test]
    fn branches_run_from_heads_and_confluences_to_the_next_confluence() {
        let kept = [true, true, true, true, true, false];
        let mut runs = branches(&tree(), &kept);
        runs.sort();
        assert_eq!(runs, vec![vec![0, 2], vec![1, 2], vec![2, 3, 4]]);
        let only = [false, false, true, true, true, false];
        assert_eq!(branches(&tree(), &only), vec![vec![2, 3, 4]]);
    }
    #[test]
    fn a_stem_stops_where_the_flow_leaves_the_members() {
        let member = [true, false, true, true, false, false];
        assert_eq!(stem(0, &tree(), &member), vec![0, 2, 3]);
    }
    /// A path 0-1-2-3 with a spur 1-4, and a separate cell 5.
    fn graph() -> Vec<Neighbours> {
        vec![
            [Some(1), None, None],
            [Some(0), Some(2), Some(4)],
            [Some(1), Some(3), None],
            [Some(2), None, None],
            [Some(1), None, None],
            [None, None, None],
        ]
    }
    #[test]
    fn components_group_connected_members() {
        let groups = components(&graph(), &[true; 6]);
        assert_eq!(groups, vec![vec![0, 1, 2, 4, 3], vec![5]]);
        let groups = components(&graph(), &[true, true, false, true, true, true]);
        assert_eq!(groups.len(), 3);
    }
    #[test]
    fn the_spine_is_the_longest_path_through_the_component() {
        assert_eq!(spine(4, &graph(), &[true; 6]), vec![4, 1, 2, 3]);
        assert_eq!(spine(5, &graph(), &[true; 6]), vec![5]);
    }
}
