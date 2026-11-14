use super::{
    placement::rock_column,
    query::{material_fact, Fact},
    Ground, GroundField as F,
};
use crate::{
    rock::columns::Column,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::removal::Facet,
    storage::{Coverage, ReadBand},
};
use std::io;
pub fn deform_fabric(x: f64, y: f64, f: [f64; 4]) -> [f64; 2] {
    let coherence = x.hypot(y);
    if coherence <= 0.0 {
        return [0.0; 2];
    }
    let angle = y.atan2(x) / 2.0;
    let tx = f[0] * angle.cos() + f[1] * angle.sin();
    let ty = f[2] * angle.cos() + f[3] * angle.sin();
    let length = tx.hypot(ty);
    if length > 1e-12 {
        [
            coherence * (tx * tx - ty * ty) / length.powi(2),
            coherence * 2.0 * tx * ty / length.powi(2),
        ]
    } else {
        [0.0; 2]
    }
}
pub fn deform_slope(x: f64, y: f64, f: [f64; 4]) -> [f64; 2] {
    let determinant = f[0] * f[3] - f[1] * f[2];
    if determinant.abs() <= 1e-12 {
        [x, y]
    } else {
        [
            (f[3] * x - f[2] * y) / determinant,
            (f[0] * y - f[1] * x) / determinant,
        ]
    }
}
impl Ground {
    pub fn transform(&mut self, cell: usize, f: [f64; 4]) -> io::Result<()> {
        for column in Column::ALL {
            for slot in 0..column.size() {
                let mut layer = self.columns.read_raw_layer(cell, column, slot)?;
                [layer.grain_x, layer.grain_y] = deform_fabric(layer.grain_x, layer.grain_y, f);
                [layer.bed_slope_x, layer.bed_slope_y] =
                    deform_slope(layer.bed_slope_x, layer.bed_slope_y, f);
                self.columns.set_layer(cell, column, slot, &layer)?;
            }
        }
        self.project(cell)
    }
    pub fn deform(
        &mut self,
        cell: usize,
        direction: [f64; 2],
        coherence: f64,
        movement: f64,
    ) -> io::Result<()> {
        let [x, y] = direction;
        let length = x.hypot(y);
        if length <= 0.0 || movement <= 0.0 {
            return Ok(());
        }
        let (ux, uy) = (x / length, y / length);
        let grain = [
            (ux * ux - uy * uy) * coherence * 1000.0,
            2.0 * ux * uy * coherence * 1000.0,
        ];
        let minimum = MapScale::native(
            self.scale
                .resolve(RelativeMeasure::length(0.00000025).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
                .value(),
        );
        for facet in Facet::ALL {
            if self.share(cell, facet)? <= 0.0 {
                continue;
            }
            let column = rock_column(facet);
            for slot in 0..column.size() {
                if self.columns.depth(cell, column, slot)? <= 0.0 {
                    continue;
                }
                let mut layer = self.columns.read_layer(cell, column, slot)?;
                let thickness = if slot == column.size() - 1 {
                    self.get(F::CrustThickness, cell)?
                } else {
                    layer.depth
                };
                let strain = movement / (movement + minimum.max(thickness));
                layer.grain_x += (grain[0] - layer.grain_x) * strain;
                layer.grain_y += (grain[1] - layer.grain_y) * strain;
                layer.damage =
                    (layer.damage + strain * material_fact(&layer, Fact::Jointing)).clamp(0.0, 1.0);
                layer.altered = self.epoch;
                self.columns.set_layer(cell, column, slot, &layer)?;
            }
        }
        self.project(cell)
    }
    fn tilt_beds(&mut self, cell: usize, [x, y]: [f64; 2]) -> io::Result<()> {
        if x == 0.0 && y == 0.0 {
            return Ok(());
        }
        for column in Column::ALL {
            let facet = if matches!(column, Column::Cut | Column::CutLoose) {
                Facet::Cut
            } else {
                Facet::Land
            };
            if self.share(cell, facet)? <= 0.0 {
                continue;
            }
            for slot in 0..column.size() {
                if self.columns.depth(cell, column, slot)? <= 0.0 {
                    continue;
                }
                let mut layer = self.columns.read_raw_layer(cell, column, slot)?;
                layer.bed_slope_x += x;
                layer.bed_slope_y += y;
                layer.altered = self.epoch;
                self.columns.set_layer(cell, column, slot, &layer)?;
            }
        }
        Ok(())
    }
    fn bend(&mut self, movement: &ReadBand<f64>) -> io::Result<()> {
        for cell in 0..self.mesh.len() {
            let gradient = self.mesh.gradient(cell, &|cell| {
                Ok(MapScale::metres(movement.get(cell)?, LengthUnit::Native))
            })?;
            self.tilt_beds(cell, gradient)?;
        }
        Ok(())
    }
    pub fn displace_field(&mut self, movement: &ReadBand<f64>, cause: &str) -> io::Result<()> {
        self.bend(movement)?;
        for cell in 0..self.mesh.len() {
            let amount = movement.get(cell)?;
            if amount != 0.0 {
                self.displace(cell, amount, cause)?;
            }
        }
        Ok(())
    }
    pub fn shift_field(&mut self, movement: &ReadBand<f64>, cause: &str) -> io::Result<()> {
        self.bend(movement)?;
        for cell in 0..self.mesh.len() {
            let change = movement.get(cell)?;
            if change == 0.0 {
                continue;
            }
            self.shift(cell, change, cause)?;
        }
        Ok(())
    }
    pub fn raise_field(
        &mut self,
        requested: &ReadBand<f64>,
        cause: &str,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let mut movement = coverage.scratch(self.mesh.len(), 0.0);
        for cell in 0..self.mesh.len() {
            movement.set(
                cell,
                self.raise(cell, requested.get(cell)?.max(0.0), cause)?,
            )?;
        }
        self.bend(&movement.read_only())
    }
    pub fn support_field(
        &mut self,
        support: &ReadBand<f64>,
        datum: Option<&ReadBand<f64>>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        if !self.support_initialized {
            for cell in 0..self.mesh.len() {
                self.set(F::CrustSupportElevation, cell, support.get(cell)?)?;
            }
            self.support_initialized = true;
            return Ok(());
        }
        let mut movement = coverage.scratch(self.mesh.len(), 0.0);
        for cell in 0..self.mesh.len() {
            let delta = support.get(cell)? + datum.map_or(Ok(0.0), |datum| datum.get(cell))?
                - self.get(F::CrustSupportElevation, cell)?;
            movement.set(cell, delta)?;
            self.add(F::CrustSupportElevation, cell, delta)?;
        }
        self.displace_field(&movement.read_only(), "support")
    }
    pub fn set_support_target(&mut self, cell: usize, elevation: f64) -> io::Result<()> {
        self.set(F::CrustSupportTarget, cell, elevation)
    }
}
