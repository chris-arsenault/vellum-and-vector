use super::{
    contract::Origin,
    kinds::Kind,
    sites::Sites,
    state::State,
    values::{Claim, Found, Moment, Place},
};
use crate::field::refinement::topology::distance;
// hpc-exempt: sparse discovered place claims, retaining declaration order separately.
use std::{collections::BTreeMap, io, rc::Rc};

#[derive(Default)]
pub struct Claims {
    values: Vec<Claim>,
    // hpc-exempt: one lookup per claimed place anchor.
    indices: BTreeMap<usize, usize>,
}
impl Claims {
    pub fn contains(&self, cell: usize) -> bool {
        self.indices.contains_key(&cell)
    }
    pub fn get(&self, cell: usize) -> Option<&Claim> {
        self.indices.get(&cell).map(|&at| &self.values[at])
    }
    pub fn values(&self) -> &[Claim] {
        &self.values
    }
    pub fn cells(&self) -> impl Iterator<Item = usize> + '_ {
        self.values.iter().map(|c| c.found.anchor)
    }
    fn insert(&mut self, claim: Claim) {
        if !self.contains(claim.found.anchor) {
            self.indices.insert(claim.found.anchor, self.values.len());
            self.values.push(claim);
        }
    }
}
pub fn reached(state: &impl State, moment: Moment) -> bool {
    match moment {
        Moment::Geography => true,
        Moment::Magic => state.magic().is_some(),
        Moment::Society => state.regional() || state.places_recorded(),
    }
}
pub fn spaced_among(
    state: &impl State,
    claimed: &Claims,
    candidates: &[usize],
    apart: f64,
    passes: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<Vec<Found>> {
    let field = state.field()?;
    let mut all: Vec<_> = claimed.cells().collect();
    all.extend_from_slice(candidates);
    let sites = Sites::new(state.spatial(), &field.mesh, all)?;
    let mut taken = crate::hpc::BitSet::new(field.mesh.len());
    for cell in claimed.cells() {
        taken.add(cell);
    }
    let mut found = Vec::new();
    for &cell in candidates {
        if !passes(cell)?
            || sites
                .around(&field.mesh, cell, apart)?
                .into_iter()
                .any(|other| taken.has(other) && distance(&field.mesh, cell, other) < apart)
        {
            continue;
        }
        if taken.add(cell) {
            found.push(Found {
                anchor: cell,
                cells: None,
                hosted_by: None,
            });
        }
    }
    Ok(found)
}
pub fn resolve<S>(
    state: &S,
    origins: &[Origin<S>],
    exists: impl Fn(Kind) -> bool,
) -> io::Result<Claims> {
    let mut claimed = Claims::default();
    for origin in origins {
        if !origin.reads.iter().all(|&kind| exists(kind)) {
            continue;
        }
        for found in (origin.finds)(state, &claimed)? {
            claimed.insert(Claim {
                found,
                origin: origin.id.clone(),
            });
        }
    }
    Ok(claimed)
}
pub fn claims<S: State>(
    state: &S,
    kind: Kind,
    origins: &[Origin<S>],
    exists: impl Fn(Kind) -> bool,
) -> io::Result<Rc<Claims>> {
    state.held().get(&format!("origins:{}", kind.as_str()), || {
        if state.physical().is_none() {
            Ok(Claims::default())
        } else {
            resolve(state, origins, exists)
        }
    })
}
pub fn places(kind: Kind, claims: &Claims) -> Vec<Place> {
    claims
        .values()
        .iter()
        .map(|claim| {
            let mut place = Place::at(
                kind,
                claim.found.anchor,
                claim
                    .found
                    .cells
                    .clone()
                    .unwrap_or_else(|| vec![claim.found.anchor]),
            );
            place.origin = Some(claim.origin.clone());
            place.hosted_by = claim.found.hosted_by.clone();
            place
        })
        .collect()
}
