//! Re-evaluation replaces a contribution by its desired minus actually applied change.
use super::{
    shared::{CellCode, Flag, FloatField, Scalar},
    Field,
};
use crate::{
    rock::ground::GroundField,
    storage::{Band, Coverage},
};
use std::io;

/// Water and retained ground material are deliberately absent: their owners accept operations.
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Medium {
    Shared(Scalar),
    Code(CellCode),
    Float(FloatField),
    Flag(Flag),
    SoilDepth,
}
#[derive(Clone, Copy, Default)]
pub struct Bounds {
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
}
impl Bounds {
    fn apply(self, value: f64) -> f64 {
        let value = self.minimum.map_or(value, |minimum| value.max(minimum));
        self.maximum.map_or(value, |maximum| value.min(maximum))
    }
}
impl Medium {
    pub fn bounds(self) -> Bounds {
        use Scalar::*;
        let minimum = match self {
            Self::SoilDepth
            | Self::Shared(
                FractureConductance
                | Moisture
                | IceThickness
                | ExternalCoastalForcing
                | BroadleafCover
                | ConiferCover
                | GrassCover
                | WetlandCover
                | TreeCover
                | BroadleafSaplings
                | AquaticProductivity,
            ) => Some(0.0),
            _ => None,
        };
        let maximum = match self {
            Self::Shared(FractureConductance | ExternalCoastalForcing | Moisture) => Some(1000.0),
            Self::Shared(BroadleafCover | ConiferCover | GrassCover) => Some(1.0),
            _ => None,
        };
        Bounds { minimum, maximum }
    }
    pub fn read(self, field: &Field, cell: usize) -> io::Result<f64> {
        match self {
            Self::Shared(name) => field.shared.scalar(name).get(cell),
            Self::Code(name) => field.shared.code(name).get(cell).map(f64::from),
            Self::Float(name) => field.shared.float(name).get(cell).map(f64::from),
            Self::Flag(name) => field.shared.flag(name).get(cell).map(f64::from),
            Self::SoilDepth => field.ground.borrow().view(GroundField::SoilDepth).get(cell),
        }
    }
    pub fn write(self, field: &mut Field, cell: usize, value: f64) -> io::Result<()> {
        match self {
            Self::Shared(name) => field.shared.scalar_mut(name).set(cell, value),
            Self::Code(name) => field.shared.code_mut(name).set(cell, value as i32),
            Self::Float(name) => field.shared.float_mut(name).set(cell, value as f32),
            Self::Flag(name) => field.shared.flag_mut(name).set(cell, value as u8),
            Self::SoilDepth => field.ground.borrow_mut().soil_depth(cell, value),
        }
    }
}
struct Contribution {
    medium: Medium,
    desired: Band<f64>,
    applied: Option<Band<f64>>,
}
#[derive(Default)]
pub struct Contributions {
    entries: Vec<Contribution>,
}
impl Contributions {
    pub(crate) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let mut count = self.entries.len();
        archive.value("contributions", &mut count)?;
        if archive.loading() {
            self.entries = (0..count)
                .map(|_| Contribution {
                    medium: Medium::SoilDepth,
                    desired: coverage.allocate(0.0),
                    applied: None,
                })
                .collect();
        }
        for entry in &mut self.entries {
            archive.value("medium", &mut entry.medium)?;
            archive.band("desired", &mut entry.desired)?;
            archive.optional_band("applied", &mut entry.applied, coverage)?;
        }
        Ok(())
    }
    pub fn begin(&mut self) -> io::Result<()> {
        for entry in &mut self.entries {
            for cell in 0..entry.desired.len() {
                entry.desired.set(cell, 0.0)?;
            }
        }
        Ok(())
    }
    pub fn forget(&mut self, medium: Medium) {
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.medium == medium) {
            entry.applied = None;
        }
    }
    pub fn add(
        &mut self,
        medium: Medium,
        cell: usize,
        amount: f64,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        if amount == 0.0 {
            return Ok(());
        }
        let at = self
            .entries
            .iter()
            .position(|entry| entry.medium == medium)
            .unwrap_or_else(|| {
                self.entries.push(Contribution {
                    medium,
                    desired: coverage.allocate(0.0),
                    applied: None,
                });
                self.entries.len() - 1
            });
        let band = &mut self.entries[at].desired;
        band.set(cell, band.get(cell)? + amount)
    }
    pub fn applied_to(&self, medium: Medium, cell: usize) -> io::Result<f64> {
        match self
            .entries
            .iter()
            .find(|entry| entry.medium == medium)
            .and_then(|entry| entry.applied.as_ref())
        {
            Some(band) => band.get(cell),
            None => Ok(0.0),
        }
    }
    pub fn commit(
        &mut self,
        field: &mut Field,
        bounds: impl Fn(Medium) -> Bounds,
    ) -> io::Result<Vec<(Medium, f64)>> {
        let mut changed = Vec::new();
        for entry in &mut self.entries {
            let previous = entry
                .applied
                .get_or_insert_with(|| field.coverage.get_mut().allocate(0.0));
            let limit = bounds(entry.medium);
            let mut largest = 0.0f64;
            for cell in 0..entry.desired.len() {
                let delta = entry.desired.get(cell)? - previous.get(cell)?;
                if delta == 0.0 {
                    continue;
                }
                largest = largest.max(delta.abs());
                let before = entry.medium.read(field, cell)?;
                let next = limit.apply(before + delta);
                let next = if matches!(entry.medium, Medium::Code(_)) {
                    (next + 0.5).floor()
                } else {
                    next
                };
                entry.medium.write(field, cell, next)?;
                previous.set(
                    cell,
                    previous.get(cell)? + entry.medium.read(field, cell)? - before,
                )?;
            }
            if largest > 0.0 {
                changed.push((entry.medium, largest));
            }
        }
        Ok(changed)
    }
}
