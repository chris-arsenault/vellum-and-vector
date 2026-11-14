use super::{
    changes::{add, shift},
    measurement::{distance, Height},
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query, QueryValue},
    field::{
        shared::{CellCode as C, FloatField as F, Scalar as S},
        Field,
    },
    rock::{catalogue, ground::GroundField as G},
    scale::{LengthUnit, MapScale},
};
use std::io;

pub struct Mountain {
    pub center: [f64; 2],
    pub base_radius_km: f64,
    pub summit_metres: f64,
    pub prominence_metres: f64,
}
pub struct MountainWork {
    pub landmark_id: String,
    pub mountain: Mountain,
    pub epoch: i32,
    /// None emplaces; Some supplies the measured prominence shortfall for maintenance.
    pub prominence_shortfall: Option<f64>,
}
pub struct Measures {
    pub summit: f64,
    pub prominence: f64,
}
impl QueryValue for Measures {}
fn cells(field: &Field, input: &Mountain) -> Vec<(usize, f64)> {
    let radius = MapScale::metres(input.base_radius_km, LengthUnit::Kilometre);
    (0..field.mesh.len())
        .filter_map(|cell| {
            let d = distance(field, cell, input.center);
            (d <= radius).then_some((cell, d))
        })
        .collect()
}
fn volcanic_causes(
    field: &mut Field,
    cell: usize,
    d: f64,
    radius: f64,
    raise: f64,
    epoch: i32,
) -> io::Result<()> {
    let t = 1.0 - d / radius;
    let activity = (1000.0 * t).round();
    add(
        field,
        S::VolcanicConstructionHistory,
        cell,
        raise.round().max(0.0),
    )?;
    for (band, value) in [
        (S::VolcanicActivity, activity),
        (S::FractureConductance, (activity * 0.7).trunc()),
    ] {
        let band = field.shared.scalar_mut(band);
        band.set(cell, band.get(cell)?.max(value))?;
    }
    let uplift = field.shared.float_mut(F::Uplift);
    uplift.set(cell, uplift.get(cell)?.max(t.clamp(0.0, 1.0) as f32))?;
    let epochs = field.shared.code_mut(C::VolcanicLastActiveEpoch);
    epochs.set(cell, epochs.get(cell)?.max(epoch))?;
    let flags = field.shared.code_mut(C::FeatureFlags);
    flags.set(
        cell,
        flags.get(cell)? | if d <= radius / 3.0 { 1 << 8 } else { 1 << 10 },
    )
}
struct Construction {
    volcanic: bool,
    resistance: f64,
}
impl Construction {
    fn raise(
        &self,
        field: &mut Field,
        work: &MountainWork,
        height: f64,
        anchor: f64,
    ) -> io::Result<f64> {
        let radius = MapScale::metres(work.mountain.base_radius_km, LengthUnit::Kilometre);
        let shape = |d: f64| {
            if self.volcanic {
                (1.0 - d / radius).powi(2)
            } else {
                1.0 - (d / radius).powi(2)
            }
        };
        let reference = shape(anchor).max(1e-3);
        let ordinary = catalogue::CATALOGUE[catalogue::STRATA].facts.resistance;
        let mut applied: f64 = 0.0;
        for (cell, d) in cells(field, &work.mountain) {
            let t = 1.0 - d / radius;
            let profile = (shape(d) / reference).min(1.0);
            applied = applied.max(shift(field, cell, (height * profile).round())?);
            let resistance = ordinary
                + if self.volcanic {
                    (self.resistance - ordinary) * profile
                } else {
                    (catalogue::HARDEST_ROCK - ordinary) * t.sqrt()
                };
            field
                .ground
                .try_borrow_mut()
                .map_err(io::Error::other)?
                .harden_rock(
                    cell,
                    if self.volcanic { catalogue::BASALT } else { 8 },
                    resistance,
                )?;
            if self.volcanic {
                volcanic_causes(field, cell, d, radius, height * profile, work.epoch)?;
            }
        }
        Ok(applied)
    }
    fn apply(&self, field: &mut Field, work: &MountainWork) -> io::Result<f64> {
        let cells = cells(field, &work.mountain);
        if cells.is_empty() {
            return Ok(0.0);
        }
        let center = field
            .mesh
            .cell_at(work.mountain.center[0], work.mountain.center[1])
            .ok_or_else(|| io::Error::other("Mountain center is outside the mesh"))?;
        let center_height = field.ground().view(G::Elevation).get(center)?;
        let summit = field.water().base_sea_level + MapScale::native(work.mountain.summit_metres);
        let needed = if let Some(shortfall) = work.prominence_shortfall {
            (summit - center_height).max(MapScale::native(shortfall))
        } else {
            let base = Height::new(field).ring(
                work.mountain.center,
                MapScale::metres(work.mountain.base_radius_km, LengthUnit::Kilometre),
            )?;
            let from = if base.is_finite() {
                base.min(center_height)
            } else {
                center_height
            };
            (summit - from).max(MapScale::native(work.mountain.prominence_metres))
        };
        if needed <= 0.0 {
            return Ok(0.0);
        }
        let anchor = cells.iter().map(|(_, d)| *d).fold(f64::INFINITY, f64::min);
        let applied = self.raise(field, work, needed, anchor)?;
        if work.prominence_shortfall.is_some() {
            for (cell, _) in cells {
                add(field, S::LandmarkMaintenance, cell, applied)?;
            }
        }
        Ok(applied)
    }
}
impl Field {
    pub fn landmark_mountain(
        volcanic: bool,
        volcanic_resistance: f64,
    ) -> Command<Self, MountainWork> {
        let construction = Construction {
            volcanic,
            resistance: volcanic_resistance,
        };
        Command::with_inputs(
            "landmark-mountain",
            CommandKind::Event,
            vec![],
            move |scope, work| {
                let field = scope.state_mut();
                let applied = construction
                    .apply(field, work)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))?;
                if work.prominence_shortfall.is_some() {
                    super::changes::maintenance(field, &work.landmark_id, applied)
                        .map_err(|e| ExecutionError::Failed(e.to_string()))?;
                }
                Ok(())
            },
        )
    }
    pub fn mountain_measures() -> Query<Self, Measures> {
        Query::new(
            "landmark-mountain-measures",
            vec![],
            |field: &Field, scope| {
                let input = scope.input::<Mountain>()?;
                let measure = || -> io::Result<Measures> {
                    let elevation = field.ground().view(G::Elevation);
                    let mut summit = None;
                    for (cell, _) in cells(field, &input) {
                        let value = elevation.get(cell)?;
                        if summit.is_none_or(|(_, height)| value > height) {
                            summit = Some((cell, value));
                        }
                    }
                    let Some((cell, height)) = summit else {
                        return Ok(Measures {
                            summit: f64::NAN,
                            prominence: f64::NAN,
                        });
                    };
                    Ok(Measures {
                        summit: MapScale::metres(
                            height - field.water().base_sea_level,
                            LengthUnit::Native,
                        ),
                        prominence: MapScale::metres(
                            field.topographic_prominence()?.rise.get(cell)?,
                            LengthUnit::Native,
                        ),
                    })
                };
                measure().map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
}
