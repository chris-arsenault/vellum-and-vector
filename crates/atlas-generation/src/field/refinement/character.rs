use super::{
    super::{shared::Scalar, Field},
    base::Adjacency,
    topology::distance,
};
use crate::{
    hpc::SmallIntSet,
    lattice::Membership,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::ReadBand,
};
use std::io;
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Cone {
    pub cell: usize,
    pub radius: f64,
    pub height: f64,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Character {
    pub grain_x: Vec<f64>,
    pub grain_y: Vec<f64>,
    pub reworking: Vec<f64>,
    pub strain: Vec<f64>,
    pub cones: Vec<Cone>,
    pub inferred_grain: bool,
}
fn length(field: &Field, fraction: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
impl Character {
    pub fn derive(field: &Field, inherited: &ReadBand<f64>, parent_span: f64) -> io::Result<Self> {
        let n = field.mesh.len();
        let mut result = Self {
            grain_x: vec![0.0; n],
            grain_y: vec![0.0; n],
            reworking: vec![0.0; n],
            strain: vec![0.0; n],
            cones: Vec::new(),
            inferred_grain: false,
        };
        let ground = field.ground();
        let gx = ground.view(GroundField::StructuralGrainX);
        let gy = ground.view(GroundField::StructuralGrainY);
        let mut captured = false;
        for cell in 0..n {
            let x = gx.get(cell)? / 1000.0;
            let y = gy.get(cell)? / 1000.0;
            let coherence = x.hypot(y);
            if coherence < 0.05 {
                continue;
            }
            captured = true;
            let scale = coherence.min(1.0) / coherence;
            result.grain_x[cell] = x * scale;
            result.grain_y[cell] = y * scale;
        }
        if !captured {
            result.measure_grain(field, inherited, parent_span)?;
        }
        let full = length(field, 0.00001)?;
        for cell in 0..n {
            result.reworking[cell] = (MapScale::metres(
                field
                    .shared
                    .scalar(Scalar::CumulativeGlacialErosion)
                    .get(cell)?,
                LengthUnit::Native,
            ) / full)
                .clamp(0.0, 1.0);
            result.strain[cell] =
                (field.shared.scalar(Scalar::TectonicStrain).get(cell)? / 1000.0).clamp(0.0, 1.0);
        }
        result.inferred_grain = !captured;
        result.cones = cones(field, parent_span)?;
        Ok(result)
    }
    pub fn grain_at(&self, cell: usize) -> (f64, f64) {
        let x = self.grain_x[cell];
        let y = self.grain_y[cell];
        let coherence = x.hypot(y);
        (
            if coherence != 0.0 {
                y.atan2(x) / 2.0
            } else {
                0.0
            },
            coherence,
        )
    }
    fn measure_grain(
        &mut self,
        field: &Field,
        inherited: &ReadBand<f64>,
        parent_span: f64,
    ) -> io::Result<()> {
        let mut xx = vec![0.0; field.mesh.len()];
        let mut yy = xx.clone();
        let mut xy = xx.clone();
        for cell in 0..field.mesh.len() {
            let [x, y] = field.mesh.gradient(cell, &|i| {
                Ok(MapScale::metres(inherited.get(i)?, LengthUnit::Native))
            })?;
            xx[cell] = x * x;
            yy[cell] = y * y;
            xy[cell] = x * y;
        }
        let adjacency = Adjacency::new(&field.mesh);
        for values in [&mut xx, &mut yy, &mut xy] {
            adjacency.smooth(values, parent_span * 0.6, None);
        }
        for cell in 0..field.mesh.len() {
            let trace = xx[cell] + yy[cell];
            if trace <= 0.0 {
                continue;
            }
            let anisotropy = (xx[cell] - yy[cell]).hypot(2.0 * xy[cell]) / trace;
            let coherence = (anisotropy * (trace.sqrt() / 0.02).clamp(0.0, 1.0)).clamp(0.0, 1.0);
            if coherence < 0.05 {
                continue;
            }
            let phi = (2.0 * xy[cell]).atan2(xx[cell] - yy[cell]);
            self.grain_x[cell] = -phi.cos() * coherence;
            self.grain_y[cell] = -phi.sin() * coherence;
        }
        Ok(())
    }
}
fn cones(field: &Field, parent_span: f64) -> io::Result<Vec<Cone>> {
    let mut cones = Vec::new();
    let window = field.scale.supported(parent_span, 2.0);
    let construction = field.shared.scalar(Scalar::VolcanicConstructionHistory);
    let floor = length(field, 0.0000125)?;
    let basis = length(field, 0.000075)?;
    let water = field.water().column.kind;
    for cell in 0..field.mesh.len() {
        let value = MapScale::metres(construction.get(cell)?, LengthUnit::Native);
        if field.mesh.membership(cell) != Membership::Content
            || value < floor
            || water.get(cell)? == 1
        {
            continue;
        }
        if !local_maximum(field, &construction, cell, window)? {
            continue;
        }
        cones.push(Cone {
            cell,
            radius: field
                .scale
                .supported(parent_span * 0.5 * (value / basis).sqrt(), 2.5),
            height: value * 0.6,
        });
    }
    Ok(cones)
}
fn local_maximum(
    field: &Field,
    values: &ReadBand<f64>,
    center: usize,
    radius: f64,
) -> io::Result<bool> {
    let own = values.get(center)?;
    let mut seen = SmallIntSet::default();
    seen.add(center as i32);
    let mut head = 0;
    while head < seen.items().len() {
        let cell = seen.items()[head] as usize;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if seen.has(next as i32) || distance(&field.mesh, center, next) > radius {
                continue;
            }
            seen.add(next as i32);
            let other = values.get(next)?;
            if other > own || (other == own && next < center) {
                return Ok(false);
            }
        }
        head += 1;
    }
    Ok(true)
}
