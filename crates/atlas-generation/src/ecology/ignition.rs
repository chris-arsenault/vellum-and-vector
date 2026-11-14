//! The child's cause-keyed ignitions, using shared spatial lookup for settlement rings.
use super::{environment::environment, groups::living_carbon, unit, Forcing, Habitat};
use crate::{
    field::shared::Scalar as S,
    hpc::IntPairIndex,
    lattice::Membership,
    noise::hash_unit,
    spatial::{SpatialIndex, SpatialKernel},
    storage::{Band, Coverage},
};
use atlas_map::{Bounds, Geometry, Position};
use std::io;
pub struct Causes<'a> {
    pub seed: i32,
    pub round: i32,
    pub seats: &'a [usize],
    pub seat_radius: f64,
}
pub fn causes(
    map: &Habitat<'_>,
    input: &Causes<'_>,
    kernel: &dyn SpatialKernel,
    coverage: &mut Coverage,
) -> io::Result<Band<u8>> {
    let seed = input.seed ^ input.round.wrapping_add(1).wrapping_mul(0x5a11);
    let mut ignite = coverage.scratch(map.mesh.len(), 0);
    let mut blocks = IntPairIndex::default();
    let mut keys = Vec::new();
    let mut cells = Vec::new();
    let mut risks = Vec::new();
    let span = map.length(0.0025)?;
    let origin = map.mesh.origin();
    for cell in 0..map.mesh.len() {
        if !burnable(map, cell)? {
            continue;
        }
        if map.get(S::ExternalHeatForcing, cell)? / 10.0 >= 3.0 {
            ignite.set(cell, 1)?;
        }
        let fuel = unit(living_carbon(map, cell)? / 5.0);
        if fuel <= 0.05 {
            continue;
        }
        let p = map.mesh.position(cell);
        let key =
            ((p[0] + origin[0]) / span).floor() * 4096.0 + ((p[1] + origin[1]) / span).floor();
        let bits = if key == 0.0 { 0 } else { key.to_bits() };
        let block = blocks.include((bits >> 32) as i32, bits as i32);
        let risk = environment(map, cell, &Forcing::default())?.drought * fuel;
        if block == cells.len() {
            keys.push(key);
            cells.push(cell);
            risks.push(risk);
        } else if risk > risks[block] {
            cells[block] = cell;
            risks[block] = risk;
        }
    }
    for block in 0..cells.len() {
        if risks[block] > 0.05 && hash_unit(seed, keys[block], 0.0) < 0.35 {
            ignite.set(cells[block], 1)?;
        }
    }
    seat_edges(map, input, kernel, seed, &mut ignite)?;
    Ok(ignite)
}
fn burnable(map: &Habitat<'_>, cell: usize) -> io::Result<bool> {
    Ok(map.mesh.membership(cell) == Membership::Content
        && map.water.column.kind.get(cell)? == 0
        && map.get(S::IceThickness, cell)? < map.length(2.5e-7)?)
}
fn seat_edges(
    map: &Habitat<'_>,
    input: &Causes<'_>,
    kernel: &dyn SpatialKernel,
    seed: i32,
    ignite: &mut Band<u8>,
) -> io::Result<()> {
    if input.seats.is_empty() {
        return Ok(());
    }
    let points = (0..map.mesh.len())
        .map(|cell| {
            let p = map.mesh.position(cell);
            Geometry::Point {
                coordinates: Position::xy(p[0], p[1]),
            }
        })
        .collect::<Vec<_>>();
    let index = kernel.index(&points).map_err(io::Error::other)?;
    let inner = input.seat_radius * map.scale.cells(1.0);
    let outer = (input.seat_radius + 1.0) * map.scale.cells(1.0);
    for &seat in input.seats {
        if hash_unit(seed ^ 0x3e7, seat as f64, 1.0) >= 0.2 {
            continue;
        }
        ring(map, index.as_ref(), seat, inner, outer, ignite)?;
    }
    Ok(())
}
fn ring(
    map: &Habitat<'_>,
    index: &dyn SpatialIndex,
    seat: usize,
    inner: f64,
    outer: f64,
    ignite: &mut Band<u8>,
) -> io::Result<()> {
    let p = map.mesh.position(seat);
    let shifts = map
        .mesh
        .periodic_width()
        .map_or(vec![0.0], |width| vec![-width, 0.0, width]);
    for shift in shifts {
        let bounds = Bounds(
            p[0] + shift - outer,
            p[1] - outer,
            p[0] + shift + outer,
            p[1] + outer,
        );
        for cell in index.query(bounds).map_err(io::Error::other)? {
            let q = map.mesh.position(cell);
            let distance = map.mesh.delta_x(q[0] - p[0]).hypot(q[1] - p[1]);
            if distance > inner && distance <= outer && burnable(map, cell)? {
                ignite.set(cell, 1)?;
            }
        }
    }
    Ok(())
}
