use crate::{lattice::TriangularLattice, noise::hash_unit};

#[derive(Clone, Copy)]
pub struct Candidate {
    pub id: usize,
    pub position: [f64; 2],
    pub priority: f64,
}
pub fn world_candidates(mesh: &TriangularLattice, seed: i32, count: usize) -> Vec<Candidate> {
    let b = mesh.bounds();
    (0..count)
        .map(|id| Candidate {
            id,
            position: [
                b.0 + (b.2 - b.0) * hash_unit(seed ^ 0x1b73, id as f64, 0.0),
                b.1 + (b.3 - b.1) * hash_unit(seed ^ 0x2db9, id as f64, 1.0),
            ],
            priority: hash_unit(seed ^ 0x4a91, id as f64, 2.0),
        })
        .collect()
}
pub fn area_budget(budget: f64, area: f64, reference_area: f64) -> usize {
    if budget <= 0.0 || area <= 0.0 {
        0
    } else {
        (budget * area / reference_area).round().max(1.0) as usize
    }
}
pub fn medium_area(mesh: &TriangularLattice) -> f64 {
    (0..mesh.len()).map(|cell| mesh.content_area(cell)).sum()
}
