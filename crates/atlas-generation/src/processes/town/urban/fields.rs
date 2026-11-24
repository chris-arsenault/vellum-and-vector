//! City layout on the regional triangular lattice. Each band describes the current
//! spatial proposal; it survives a development round and its checkpoint.
use crate::{atlas::state::State, lattice::TriangularLattice};
use serde::{Deserialize, Serialize};

// owner-direction(2026-11-24): City processes interact across rounds by reading and writing shared numeric fields.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(super) struct CityFields {
    #[serde(default)]
    pub stencil: Vec<f64>,
    #[serde(default)]
    pub program: Vec<usize>,
    pub access: Vec<f64>,
    pub claims: Vec<Claims>,
    pub developed: Vec<f64>,
    pub civic: Vec<f64>,
    pub sponsor: Vec<Option<usize>>,
    pub inside: Vec<bool>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub(super) struct Claims {
    pub home: f64,
    pub work: f64,
    #[serde(default)]
    pub trade: f64,
    pub investment: f64,
    pub crowd: f64,
    pub farm: f64,
    pub ruin: f64,
    pub people: f64,
    pub built: f64,
    pub reserved: bool,
}

pub(super) fn position(mesh: &TriangularLattice, c: usize) -> [f64; 2] {
    let [ox, oy] = mesh.origin();
    let [x, y] = mesh.position(c);
    [ox + x, oy + y]
}

/// Read both local and surrounding occupation so adjacent sites compete for the same ground.
pub(super) fn neighborhood<const N: usize>(
    mesh: &TriangularLattice,
    bands: [&[f64]; N],
    cell: usize,
    reach: f64,
) -> [f64; N] {
    let mut sums = [0.; N];
    let mut mass = 0.;
    for neighbor in mesh.cells_within(mesh.position(cell), reach) {
        let weight = (1. - (mesh.physical_distance(cell, neighbor) / reach).powi(2))
            .max(0.)
            .powi(2);
        for (sum, band) in sums.iter_mut().zip(bands) {
            *sum += weight * band[neighbor];
        }
        mass += weight;
    }
    sums.map(|sum| sum / mass.max(f64::EPSILON))
}

pub(super) fn policy(state: &State) -> std::io::Result<&crate::town::templates::Selection> {
    state
        .regional
        .as_ref()
        .and_then(|r| r.city.template.as_ref())
        .ok_or_else(|| {
            std::io::Error::other("City development requires the inherited founding policy")
        })
}
