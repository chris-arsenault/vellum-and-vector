//! City layout on the regional triangular lattice. Each band describes the current
//! spatial proposal; it survives a development round and its checkpoint.
use super::{geometry::pos, Element};
use crate::{
    atlas::state::State,
    field::{
        people::work::{habitable, working},
        refinement::courses::course_cells,
        shared::Scalar,
    },
    human::HumanField,
    metric::search::search,
};
use atlas_map::{regions::point, Geometry};
use serde::{Deserialize, Serialize};
use std::io;

pub(super) const RESIDENTS_PER_BUILT_KM2: f64 = 10_000.;

// owner-direction(2026-11-24): City processes interact across rounds by reading and writing shared numeric fields.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(super) struct CityFields {
    /// Walking access to the proposed principal network, 0 to 1.
    access: Vec<f64>,
    /// District service demand per km² on reachable ground.
    activity: Vec<f64>,
    /// Developed share supported on occupied frontage in the last layout.
    frontage: Vec<f64>,
}

impl CityFields {
    pub fn access(&self, c: usize) -> f64 {
        self.access.get(c).copied().unwrap_or_default()
    }
    pub fn activity(&self, c: usize) -> f64 {
        self.activity.get(c).copied().unwrap_or_default()
    }
    pub fn frontage(&self, c: usize) -> f64 {
        self.frontage.get(c).copied().unwrap_or_default()
    }

    /// Local trip origins and occupied frontages draw routes. Existing access
    /// meets part of the service demand in a district's catchment.
    pub fn route_demand(&self, c: usize, people: f64, built: f64) -> f64 {
        let local = (people.max(0.) + built.max(0.) * RESIDENTS_PER_BUILT_KM2) * 0.5;
        0.65 * local
            + 0.5 * self.frontage(c) * RESIDENTS_PER_BUILT_KM2
            + self.activity(c) * (1. - 0.65 * self.access(c))
    }

    /// Compute walking cost from the actual avenues and approaches across dry ground.
    pub fn record_routes(&mut self, state: &State, roads: &[Element]) -> io::Result<()> {
        let f = state.field();
        let mesh = f.mesh();
        let mut distance = working(f);
        let mut seeds = Vec::new();
        let slope = f.shared().scalar(Scalar::Slope);
        let kept = f.people().view(HumanField::KeptLine);
        let mut effort = Vec::with_capacity(mesh.len());
        for c in 0..mesh.len() {
            distance.set(c, f64::INFINITY)?;
            effort.push(if habitable(f, c)? {
                (1. + slope.get(c)?.max(0.) / 0.15) / (1. + kept.get(c)?.clamp(0., 1.))
            } else {
                f64::INFINITY
            });
        }
        for road in roads.iter().filter(|r| r.name != "Perimeter way") {
            for c in course_cells(mesh, &road.geometry, mesh.spacing(), 0.) {
                if effort[c].is_finite() && distance.get(c)? != 0. {
                    seeds.push(c);
                    distance.set(c, 0.)?;
                }
            }
        }
        search(
            mesh,
            seeds,
            &mut distance,
            f64::INFINITY,
            |_, _| Ok(()),
            |a, b, _| Ok(mesh.physical_distance(a, b) * (effort[a] + effort[b]) * 0.5),
        )?;
        self.access = (0..mesh.len())
            .map(|c| {
                let walking = distance.get(c)? / 350.;
                Ok(1. / (1. + walking * walking))
            })
            .collect::<io::Result<_>>()?;
        Ok(())
    }

    pub fn record_districts<'a>(
        &mut self,
        state: &State,
        zones: impl Iterator<Item = (&'a Geometry, f64)>,
    ) -> io::Result<()> {
        self.activity = on_ground(state, zones)?;
        for (activity, access) in self.activity.iter_mut().zip(&self.access) {
            *activity *= *access;
        }
        Ok(())
    }

    pub fn record_frontage(&mut self, state: &State, blocks: &[Element]) -> io::Result<()> {
        let zones = blocks.iter().map(|b| {
            (
                &b.geometry,
                b.attributes["builtShare"].as_f64().unwrap_or_default(),
            )
        });
        self.frontage = on_ground(state, zones)?;
        Ok(())
    }
}

/// Sample occupied polygons onto cell centres; holes and reservations keep zero.
fn on_ground<'a>(
    state: &State,
    zones: impl Iterator<Item = (&'a Geometry, f64)>,
) -> io::Result<Vec<f64>> {
    let kernel = state.spatial.as_ref();
    let mesh = state.field().mesh();
    let [ox, oy] = mesh.origin();
    let positions: Vec<_> = (0..mesh.len())
        .map(|c| {
            let [x, y] = mesh.position(c);
            pos([ox + x, oy + y])
        })
        .collect();
    let points: Vec<_> = positions.iter().copied().map(point).collect();
    let index = kernel.index(&points).map_err(io::Error::other)?;
    let mut values = vec![0.; mesh.len()];
    for (zone, value) in zones {
        let cells = index
            .query(kernel.bounds(zone).map_err(io::Error::other)?)
            .map_err(io::Error::other)?;
        let candidates: Vec<_> = cells.iter().map(|&c| positions[c]).collect();
        let inside = kernel
            .covers_points(zone, &candidates)
            .map_err(io::Error::other)?;
        for (cell, _) in cells.into_iter().zip(inside).filter(|(_, inside)| *inside) {
            values[cell] = value;
        }
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_route_demand_reads_frontage_and_remaining_service_need_at_each_cell() {
        let fields = CityFields {
            access: vec![1., 1., 1., 0.25],
            activity: vec![0., 0., 800., 800.],
            frontage: vec![0., 0.1, 0.1, 0.1],
        };
        let demand = |c| fields.route_demand(c, 600., 0.06);
        assert!(demand(1) > demand(0));
        assert!(demand(2) > demand(1));
        assert!(demand(3) > demand(2));
        assert_eq!(CityFields::default().route_demand(0, 600., 0.06), demand(0));
    }
}
