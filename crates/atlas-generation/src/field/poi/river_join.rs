//! Join the water owner's mapped reaches, retaining its course identities and frame gaps.
use crate::hpc::{BitSet, Direction, MultiKeyHeap};
// hpc-exempt: lookup of named course identities; reach membership is dense indexed storage.
use std::collections::BTreeMap;

pub struct ReachOnMap<'a> {
    pub downstream: Option<usize>,
    pub in_frame: bool,
    pub course: Option<&'a str>,
}
pub struct JoinedRiver {
    pub river_id: String,
    pub parts: Vec<Vec<usize>>,
}
fn reaches_below(reaches: &[ReachOnMap<'_>], from: usize) -> usize {
    let mut count = 0;
    let mut current = reaches[from].downstream;
    while let Some(at) = current.filter(|&at| at != from && count < reaches.len()) {
        count += 1;
        current = reaches.get(at).and_then(|reach| reach.downstream);
    }
    count
}
fn parts_of(
    reaches: &[ReachOnMap<'_>],
    courses: &[Option<usize>],
    members: &[usize],
) -> Vec<Vec<usize>> {
    let course = courses[members[0]];
    let next = |at: usize| {
        reaches[at]
            .downstream
            .filter(|&next| next != at && courses.get(next).copied().flatten() == course)
    };
    let mut fed = BitSet::new(reaches.len());
    let mut taken = BitSet::new(reaches.len());
    for &at in members {
        if let Some(next) = next(at) {
            fed.add(next);
        }
    }
    let mut parts = Vec::new();
    let mut ranked = MultiKeyHeap::new(
        [Direction::Descending, Direction::Ascending],
        Direction::Ascending,
    );
    for &head in members.iter().filter(|&&at| !fed.has(at)) {
        let mut part = Vec::new();
        let mut current = Some(head);
        while let Some(at) = current.filter(|&at| !taken.has(at)) {
            taken.add(at);
            part.push(at);
            current = next(at);
        }
        ranked.push(
            parts.len() as u32,
            [reaches_below(reaches, head) as f64, head as f64],
        );
        parts.push(part);
    }
    let mut result = Vec::with_capacity(parts.len());
    while let Some((at, _)) = ranked.pop() {
        result.push(std::mem::take(&mut parts[at as usize]));
    }
    result
}
pub fn join(reaches: &[ReachOnMap<'_>]) -> Vec<JoinedRiver> {
    // hpc-exempt: named course index, preserving first appearance separately.
    let mut indices = BTreeMap::new();
    let mut courses = vec![None; reaches.len()];
    let mut groups: Vec<(&str, Vec<usize>)> = Vec::new();
    for (at, reach) in reaches
        .iter()
        .enumerate()
        .filter(|(_, reach)| reach.in_frame)
    {
        let Some(id) = reach.course else {
            continue;
        };
        let index = *indices.entry(id).or_insert_with(|| {
            groups.push((id, Vec::new()));
            groups.len() - 1
        });
        courses[at] = Some(index);
        groups[index].1.push(at);
    }
    groups
        .into_iter()
        .map(|(id, members)| JoinedRiver {
            river_id: id.into(),
            parts: parts_of(reaches, &courses, &members),
        })
        .collect()
}
