use super::{height, ocean, read, Field, Settings};
use crate::{
    field::shared::Scalar as S, lattice::sampling::Sampler, metric::smoothing::smooth,
    storage::Band,
};
use std::io;
pub(super) struct Terrain<'a> {
    terrain: Band<f64>,
    gradient_x: Band<f64>,
    gradient_y: Band<f64>,
    height: Band<f64>,
    sample: Sampler<'a>,
}
impl<'a> Terrain<'a> {
    pub fn new(field: &'a Field, p: &Settings) -> io::Result<Self> {
        let mut coverage = field.coverage.borrow_mut();
        let mut heights = coverage.allocate(0.0);
        for cell in 0..field.mesh.len() {
            heights.set(cell, height(field, cell)?)?;
        }
        let terrain = smooth(
            &field.mesh,
            &mut coverage,
            &heights.read_only(),
            p.wind_terrain_length,
            None,
        )?;
        let mut gradient_x = coverage.allocate(0.0);
        let mut gradient_y = coverage.allocate(0.0);
        for cell in 0..field.mesh.len() {
            let [x, y] = field.mesh.gradient(cell, &|i| terrain.get(i))?;
            gradient_x.set(cell, x)?;
            gradient_y.set(cell, y)?;
        }
        Ok(Self {
            terrain,
            gradient_x,
            gradient_y,
            height: heights,
            sample: Sampler::new(&field.mesh),
        })
    }
    pub fn deflect(&self, p: &Settings, cell: usize, [x, y]: [f64; 2]) -> io::Result<[f64; 2]> {
        let gx = self.gradient_x.get(cell)?;
        let gy = self.gradient_y.get(cell)?;
        let slope = gx.hypot(gy);
        if slope == 0.0 {
            return Ok([x, y]);
        }
        let nx = gx / slope;
        let ny = gy / slope;
        let upslope = x * nx + y * ny;
        if upslope <= 0.0 {
            return Ok([x, y]);
        }
        let blocking = p.wind_blocking_maximum
            * (self.terrain.get(cell)? / p.wind_blocking_height).clamp(0.0, 1.0)
            * (slope / p.wind_blocking_slope).clamp(0.0, 1.0);
        let dx = x - blocking * upslope * nx;
        let dy = y - blocking * upslope * ny;
        let length = dx.hypot(dy);
        Ok(if length < 1e-6 {
            [-ny, nx]
        } else {
            [dx / length, dy / length]
        })
    }
    pub fn speed(
        &mut self,
        field: &Field,
        p: &Settings,
        cell: usize,
        belt: f64,
        barrier: f64,
    ) -> io::Result<f64> {
        let x = read(field, S::WindX, cell)? / 1000.0;
        let y = read(field, S::WindY, cell)? / 1000.0;
        let height = self.height.get(cell)?;
        let land = !ocean(field, cell)?;
        let exposure =
            ((height - self.terrain.get(cell)?) / p.wind_exposure_relief).clamp(0.0, 1.0);
        let shelter = (barrier / p.wind_shelter_height).clamp(0.0, 1.0);
        let [cx, cy] = field.mesh.position(cell);
        let reach = p.wind_gap_reach;
        let left = self
            .sample
            .sample([cx - y * reach, cy + x * reach], |i| self.height.get(i))?;
        let right = self
            .sample
            .sample([cx + y * reach, cy - x * reach], |i| self.height.get(i))?;
        let walls = left.min(right) - height;
        let gap = if land && walls.is_finite() {
            ((walls - p.wind_gap_relief) / p.wind_gap_relief).clamp(0.0, 1.0)
        } else {
            0.0
        };
        Ok(belt
            * if land { p.wind_land_roughness } else { 1.0 }
            * (1.0 + 0.5 * exposure)
            * (1.0 - 0.6 * shelter)
            * (1.0 + 0.5 * gap))
    }
}
