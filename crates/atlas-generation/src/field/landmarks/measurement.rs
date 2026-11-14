use crate::{
    field::Field, lattice::sampling::Sampler, rock::ground::GroundField as G, storage::ReadBand,
};
use std::io;
pub(super) fn distance(field: &Field, cell: usize, point: [f64; 2]) -> f64 {
    let [x, y] = field.mesh.position(cell);
    field.mesh.delta_x(x - point[0]).hypot(y - point[1])
}
pub(super) struct Height<'a> {
    field: &'a Field,
    sampler: Sampler<'a>,
    elevation: ReadBand<f64>,
}
impl<'a> Height<'a> {
    pub fn new(field: &'a Field) -> Self {
        Self {
            field,
            sampler: Sampler::new(&field.mesh),
            elevation: field.ground().view(G::Elevation),
        }
    }
    pub fn at(&mut self, [x, y]: [f64; 2]) -> io::Result<f64> {
        let point = self.field.mesh.point(x, y);
        if self.field.mesh.cell_at(point[0], point[1]).is_none() {
            return Ok(f64::NAN);
        }
        self.sampler.sample(point, |i| self.elevation.get(i))
    }
    pub fn ring(&mut self, [x, y]: [f64; 2], radius: f64) -> io::Result<f64> {
        let mut values = [0.0; 16];
        for (direction, value) in values.iter_mut().enumerate() {
            let angle = direction as f64 * std::f64::consts::PI / 8.0;
            *value = self.at([x + angle.cos() * radius, y + angle.sin() * radius])?;
        }
        Ok(mean(&values))
    }
}
pub(super) fn mean(values: &[f64]) -> f64 {
    let mut sum = 0.0;
    let mut count = 0;
    for &value in values {
        if value.is_finite() {
            sum += value;
            count += 1;
        }
    }
    if count > 0 {
        sum / f64::from(count)
    } else {
        f64::NAN
    }
}
