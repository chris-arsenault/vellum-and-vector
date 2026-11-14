//! Catalogue queries reuse the generator's landmark placement and siting algorithms.
use super::state::State;
use crate::{
    field::landmarks::{
        catalogue::{Kind, Landmark, Measures},
        path::Path,
        placement, siting,
        terrain::Terrain,
    },
    lattice::Membership,
    storage::Band,
};
use atlas_map::{Geometry, Position};
use std::{io, rc::Rc};

pub trait LandmarkState: State {
    fn landmarks(&self) -> &[Landmark];
}
pub struct Placed {
    pub landmark: Landmark,
    pub center: [f64; 2],
    pub path: Vec<[f64; 2]>,
}
pub fn landmarks_of(state: &impl LandmarkState, kind: Kind) -> io::Result<Rc<Vec<Placed>>> {
    state
        .held()
        .get(&format!("relief:landmarks:{}", kind.id()), || {
            let mut found = Vec::new();
            for landmark in state
                .landmarks()
                .iter()
                .filter(|landmark| landmark.kind == kind)
            {
                if let Some(placed) = placement::place(state.field()?, landmark, None)? {
                    found.push(Placed {
                        landmark: landmark.clone(),
                        center: placed.center,
                        path: placed.path,
                    });
                }
            }
            Ok(found)
        })
}
fn point_distance(state: &impl State, point: [f64; 2], cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let [x, y] = field.mesh.position(cell);
    let shifts = field
        .mesh
        .coordinate_width()
        .map_or(vec![0.0], |width| vec![-width, 0.0, width]);
    let images = Geometry::MultiPoint {
        coordinates: shifts
            .into_iter()
            .map(|shift| Position::xy(point[0] + shift, point[1]))
            .collect(),
    };
    state
        .spatial()
        .distance(
            &images,
            &Geometry::Point {
                coordinates: Position::xy(x, y),
            },
        )
        .map_err(io::Error::other)
}
/// The last overlapping record owns the cell, matching landmark iteration order.
pub fn ground(
    state: &impl LandmarkState,
    kind: Kind,
    reach: impl Fn(&Placed) -> f64,
) -> io::Result<Rc<Band<i32>>> {
    state
        .held()
        .get(&format!("relief:ground:{}", kind.id()), || {
            let field = state.field()?;
            let mut ground = field.coverage.borrow_mut().allocate(-1i32);
            for (at, placed) in landmarks_of(state, kind)?.iter().enumerate() {
                let path = Path::new(&field.mesh, &placed.path);
                let hits = if path.total > 0.0 {
                    Some(path.hits(field, state.spatial())?)
                } else {
                    None
                };
                let radius = reach(placed);
                for cell in 0..field.mesh.len() {
                    if field.mesh.membership(cell) != Membership::Content {
                        continue;
                    }
                    let distance = match &hits {
                        Some(hits) => hits.distance.get(cell)?,
                        None => point_distance(state, placed.center, cell)?,
                    };
                    if distance <= radius {
                        ground.set(cell, i32::try_from(at).map_err(io::Error::other)?)?;
                    }
                }
            }
            Ok(ground)
        })
}
fn scores(state: &impl State, kind: Kind) -> io::Result<Rc<Band<f64>>> {
    state
        .held()
        .get(&format!("relief:siting:{}", kind.id()), || {
            let field = state.field()?;
            let terrain = Terrain::new(field, state.spatial())?;
            let defaults: Measures = kind
                .parameters()
                .into_iter()
                .map(|p| (p.key.into(), p.default))
                .collect();
            let mut scores = field.coverage.borrow_mut().allocate(f64::NAN);
            for cell in 0..field.mesh.len() {
                if let Some(score) = siting::assess(&terrain, kind, cell, &defaults)? {
                    scores.set(cell, score)?;
                }
            }
            Ok(scores)
        })
}
pub fn admits(state: &impl State, kind: Kind, cell: usize) -> io::Result<bool> {
    Ok(!scores(state, kind)?.get(cell)?.is_nan())
}
pub fn suits(state: &impl State, kind: Kind, cell: usize) -> io::Result<f64> {
    let value = scores(state, kind)?.get(cell)?;
    Ok(if value > 0.0 {
        value / (value + 1.0)
    } else {
        0.0
    })
}
