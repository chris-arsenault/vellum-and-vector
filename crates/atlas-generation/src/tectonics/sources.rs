use crate::{chance::Scatter, lattice::TriangularLattice};

#[derive(Clone, Copy)]
pub struct Candidate {
    pub id: usize,
    pub position: [f64; 2],
    pub priority: f64,
}
/// The scatter every rule that throws sources over the world draws from: plate seeds,
/// plumes, fracture roots and impacts.
pub fn scatter(seed: i32) -> Scatter {
    Scatter::new(seed, [0x1b73, 0x2db9, 0x4a91])
}
pub fn world_candidates(mesh: &TriangularLattice, seed: i32, count: usize) -> Vec<Candidate> {
    let (scatter, bounds) = (scatter(seed), mesh.bounds());
    (0..count)
        .map(|id| Candidate {
            id,
            position: scatter.position(id, bounds),
            priority: scatter.rank(id),
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
    (0..mesh.len()).map(|cell| mesh.area(cell)).sum()
}
