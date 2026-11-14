use super::{super::Field, base::Adjacency};
use crate::{
    climate::LatitudeFrame,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
};
use std::io;
pub struct Media {
    pub insolation: Vec<f64>,
    pub pooling: Vec<f64>,
}
impl Field {
    pub fn regional_slopes(&self) -> io::Result<()> {
        self.measure_slopes()
    }
}
pub fn gradients(field: &Field) -> io::Result<(Vec<f64>, Vec<f64>)> {
    let height = field.ground().view(GroundField::Elevation);
    let mut gx = Vec::with_capacity(field.mesh.len());
    let mut gy = Vec::with_capacity(field.mesh.len());
    for cell in 0..field.mesh.len() {
        let [x, y] = field.mesh.gradient(cell, &|i| {
            Ok(MapScale::metres(height.get(i)?, LengthUnit::Native))
        })?;
        gx.push(x);
        gy.push(y);
    }
    Ok((gx, gy))
}
impl Media {
    pub fn derive(field: &Field, parent_span: f64, latitude: &LatitudeFrame) -> io::Result<Self> {
        let height = field.ground().view(GroundField::Elevation);
        let water = field.water().column.kind;
        let (gx, gy) = gradients(field)?;
        let mut surrounding = (0..field.mesh.len())
            .map(|i| Ok(MapScale::metres(height.get(i)?, LengthUnit::Native)))
            .collect::<io::Result<Vec<_>>>()?;
        Adjacency::new(&field.mesh).smooth(&mut surrounding, parent_span * 0.5, None);
        let depth = field
            .scale
            .resolve(RelativeMeasure::length(0.000015).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let mut result = Self {
            insolation: vec![0.0; field.mesh.len()],
            pooling: vec![0.0; field.mesh.len()],
        };
        for cell in 0..field.mesh.len() {
            let g = gx[cell].hypot(gy[cell]);
            if g > 0.0 {
                let lat =
                    latitude.latitude_at_y(field.mesh.position(cell)[1] + field.mesh.origin()[1]);
                let facing = lat.signum() * gy[cell] / g;
                result.insolation[cell] =
                    facing * (g / 0.3).clamp(0.0, 1.0) * lat.abs().to_radians().sin();
            }
            let below = surrounding[cell] - MapScale::metres(height.get(cell)?, LengthUnit::Native);
            if water.get(cell)? != 1 {
                result.pooling[cell] =
                    (below / depth).clamp(0.0, 1.0) * (1.0 - g / 0.05).clamp(0.0, 1.0);
            }
        }
        Ok(result)
    }
}
