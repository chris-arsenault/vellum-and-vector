use super::{
    canyon::length,
    capture::{on_river, successor, water_at},
    measurement::distance,
};
use crate::{
    field::Field,
    hpc::{radix_order, Direction, NumericKey, SmallIntSet},
    lattice::{sampling::Sampler, Membership},
    metric::search::physical_distance,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
    spatial::{SpatialIndex, SpatialKernel},
    storage::Band,
};
use atlas_map::{Bounds, Geometry, Position};
use std::io;
pub struct Terrain<'a> {
    pub field: &'a Field,
    pub sea: Band<f64>,
    pub offshore: Band<f64>,
    pub rivers: Vec<usize>,
    river_index: Box<dyn SpatialIndex + 'a>,
}
impl<'a> Terrain<'a> {
    pub fn new(field: &'a Field, kernel: &'a dyn SpatialKernel) -> io::Result<Self> {
        let sea = distance_to(field, 1)?;
        let offshore = distance_to(field, 0)?;
        let mut cells = Vec::new();
        let mut flows = Vec::new();
        let water = field.water();
        for cell in 0..field.mesh.len() {
            if field.mesh.membership(cell) == Membership::Content
                && water.column.kind.get(cell)? == 0
                && on_river(field, cell)?
                && height(field, cell)? > length(field, 0.00000125)?
            {
                cells.push(cell);
                flows.push(water_at(field, cell)?);
            }
        }
        let ordered = radix_order(&[NumericKey::Float(&flows)], Direction::Descending)
            .map_err(io::Error::other)?;
        let rivers = ordered.into_iter().map(|at| cells[at]).collect::<Vec<_>>();
        let points = rivers
            .iter()
            .map(|&cell| {
                let p = field.mesh.position(cell);
                Geometry::Point {
                    coordinates: Position::xy(p[0], p[1]),
                }
            })
            .collect::<Vec<_>>();
        let river_index = kernel.index(&points).map_err(io::Error::other)?;
        Ok(Self {
            field,
            sea,
            offshore,
            rivers,
            river_index,
        })
    }
    pub fn river_near(&self, cell: usize, reach: f64) -> io::Result<Option<usize>> {
        let p = self.field.mesh.position(cell);
        let shifts = self
            .field
            .mesh
            .periodic_width()
            .map_or(vec![0.0], |width| vec![-width, 0.0, width]);
        let mut best = None;
        for shift in shifts {
            for at in self
                .river_index
                .query(Bounds(
                    p[0] + shift - reach,
                    p[1] - reach,
                    p[0] + shift + reach,
                    p[1] + reach,
                ))
                .map_err(io::Error::other)?
            {
                if best.is_none_or(|old| at < old)
                    && distance(self.field, self.rivers[at], p) <= reach
                {
                    best = Some(at);
                }
            }
        }
        Ok(best.map(|at| self.rivers[at]))
    }
    pub fn downhill(&self, cell: usize, span: f64) -> io::Result<([f64; 2], f64)> {
        let field = self.field;
        let mut at = Sampler::new(&field.mesh);
        let elevation = field.ground().view(G::Elevation);
        let here = elevation.get(cell)?;
        let p = field.mesh.position(cell);
        let mut best = [1.0, 0.0];
        let mut drop = 0.0;
        for k in 0..8 {
            let angle = k as f64 * std::f64::consts::PI / 4.0;
            let q = field
                .mesh
                .point(p[0] + angle.cos() * span, p[1] + angle.sin() * span);
            let fall = MapScale::metres(
                here - at.sample(q, |cell| elevation.get(cell))?,
                LengthUnit::Native,
            );
            if fall > drop {
                drop = fall;
                best = [angle.cos(), angle.sin()];
            }
        }
        Ok((best, drop))
    }
    pub fn land_path(
        &self,
        from: [f64; 2],
        direction: [f64; 2],
        length: f64,
    ) -> io::Result<Vec<[f64; 2]>> {
        let point = |span| {
            self.field
                .mesh
                .point(from[0] + direction[0] * span, from[1] + direction[1] * span)
        };
        let sea = |p: [f64; 2]| -> io::Result<bool> {
            match self.field.mesh.cell_at(p[0], p[1]) {
                Some(cell) => Ok(self.field.water().column.kind.get(cell)? != 0),
                None => Ok(true),
            }
        };
        let mut span = length;
        while span > length / 4.0 && (sea(point(span))? || sea(point(span / 2.0))?) {
            span *= 0.8;
        }
        Ok(vec![from, point(span / 2.0), point(span)])
    }
}
fn distance_to(field: &Field, kind: u8) -> io::Result<Band<f64>> {
    let mut values = field
        .coverage
        .borrow_mut()
        .scratch(field.mesh.len(), f64::INFINITY);
    let mut seeds = Vec::new();
    let water = field.water();
    for cell in 0..field.mesh.len() {
        if water.column.kind.get(cell)? == kind {
            values.set(cell, 0.0)?;
            seeds.push(cell);
        }
    }
    physical_distance(
        &field.mesh,
        seeds,
        &mut values,
        f64::INFINITY,
        |_, _| Ok(()),
    )?;
    Ok(values)
}
pub fn height(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(MapScale::metres(
        field.ground().view(G::Elevation).get(cell)? - field.water().effective_sea_level,
        LengthUnit::Native,
    ))
}
pub fn within(field: &Field, center: usize, radius: f64) -> Vec<usize> {
    let at = field.mesh.position(center);
    let mut cells = vec![center];
    let mut seen = SmallIntSet::default();
    seen.add(center as i32);
    let mut head = 0;
    while head < cells.len() {
        let cell = cells[head];
        head += 1;
        for edge in 0..3 {
            let Some(other) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if seen.has(other as i32) || distance(field, other, at) > radius {
                continue;
            }
            seen.add(other as i32);
            cells.push(other);
        }
    }
    cells
}
pub fn relief(field: &Field, cells: &[usize]) -> io::Result<f64> {
    let mut low = f64::INFINITY;
    let mut high = f64::NEG_INFINITY;
    let elevation = field.ground().view(G::Elevation);
    for &cell in cells {
        let value = elevation.get(cell)?;
        low = low.min(value);
        high = high.max(value);
    }
    Ok(MapScale::metres(high - low, LengthUnit::Native))
}
pub fn base_height(field: &Field, cells: &[usize]) -> io::Result<f64> {
    let mut sum = 0.0;
    for &cell in cells {
        sum += height(field, cell)?;
    }
    Ok(sum / cells.len().max(1) as f64)
}
pub fn step_down(field: &Field, cell: usize) -> io::Result<f64> {
    let Some(target) = successor(field, cell)? else {
        return Ok(0.0);
    };
    let elevation = field.ground().view(G::Elevation);
    Ok(MapScale::metres(
        elevation.get(cell)? - elevation.get(target)?,
        LengthUnit::Native,
    )
    .max(0.0))
}
pub fn reaches_sea(field: &Field, cell: usize, steps: usize) -> io::Result<bool> {
    let mut at = cell;
    for _ in 0..steps {
        let Some(next) = successor(field, at)? else {
            break;
        };
        at = next;
        if field.water().column.kind.get(at)? == 1 {
            return Ok(true);
        }
    }
    Ok(false)
}
