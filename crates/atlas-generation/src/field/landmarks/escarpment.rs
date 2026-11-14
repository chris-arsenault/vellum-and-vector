use super::{
    changes::{add, maintenance, shift},
    measurement::mean,
    path::{Hits, Path},
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query},
    field::{fractures::Fault, shared::Scalar as S, Field},
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
    spatial::SpatialKernel,
};
use std::{io, rc::Rc};
pub struct Escarpment {
    pub id: String,
    pub path: Vec<[f64; 2]>,
    pub width_km: f64,
    pub throw_metres: f64,
}
pub struct ScarpWork {
    pub scarp: Escarpment,
    pub throw_shortfall: Option<f64>,
}
struct Cells {
    width: f64,
    hits: Hits,
}
impl Cells {
    fn new(field: &Field, scarp: &Escarpment, kernel: &dyn SpatialKernel) -> io::Result<Self> {
        Ok(Self {
            width: field
                .scale
                .supported(MapScale::metres(scarp.width_km, LengthUnit::Kilometre), 1.2),
            hits: Path::new(&field.mesh, &scarp.path).hits(field, kernel)?,
        })
    }
    fn ramp(&self, cell: usize) -> io::Result<f64> {
        Ok(self.hits.side.get(cell)?
            * (self.hits.distance.get(cell)? / (self.width / 2.0)).clamp(0.0, 1.0))
    }
    fn apply(&self, field: &mut Field, amount: f64, book: bool) -> io::Result<f64> {
        let mut applied: f64 = 0.0;
        for cell in 0..field.mesh.len() {
            if self.hits.distance.get(cell)? > self.width {
                continue;
            }
            let done = shift(field, cell, (amount / 2.0 * self.ramp(cell)?).round())?;
            if book {
                add(field, S::LandmarkMaintenance, cell, done.abs())?;
            }
            applied = applied.max(done.abs());
        }
        Ok(applied)
    }
}
fn failure(error: io::Error) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
impl Field {
    pub fn landmark_escarpment(
        kernel: Rc<dyn SpatialKernel>,
        fracture_strength: f64,
    ) -> Command<Self, ScarpWork> {
        Command::with_inputs(
            "landmark-escarpment",
            CommandKind::Event,
            vec![],
            move |scope, work: &ScarpWork| {
                let field = scope.state_mut();
                let mut run = || -> io::Result<()> {
                    let cells = Cells::new(field, &work.scarp, kernel.as_ref())?;
                    if let Some(shortfall) = work.throw_shortfall {
                        let needed = MapScale::native(shortfall);
                        if needed <= 0.0 {
                            return Ok(());
                        }
                        let applied = cells.apply(field, needed, true)?;
                        return maintenance(field, &work.scarp.id, applied);
                    }
                    cells.apply(field, MapScale::native(work.scarp.throw_metres), false)?;
                    for cell in 0..field.mesh.len() {
                        let d = cells.hits.distance.get(cell)?;
                        if d > cells.width {
                            continue;
                        }
                        let conductance = field.shared.scalar_mut(S::FractureConductance);
                        conductance.set(
                            cell,
                            conductance
                                .get(cell)?
                                .max((fracture_strength * (1.0 - d / cells.width)).round()),
                        )?;
                    }
                    field.faults.push(Fault {
                        id: format!("landmark:{}", work.scarp.id),
                        coordinates: work.scarp.path.clone(),
                        width: cells.width,
                    });
                    Ok(())
                };
                run().map_err(failure)
            },
        )
    }
    pub fn escarpment_measure(kernel: Rc<dyn SpatialKernel>) -> Query<Self, f64> {
        Query::new(
            "landmark-escarpment-measures",
            vec![],
            move |field: &Field, scope| {
                let scarp = scope.input::<Escarpment>()?;
                let cells = Cells::new(field, &scarp, kernel.as_ref()).map_err(failure)?;
                let elevation = field.ground().view(G::Elevation);
                let mut xs = Vec::new();
                let mut ys = Vec::new();
                for cell in 0..field.mesh.len() {
                    if cells.hits.distance.get(cell).map_err(failure)? > cells.width {
                        continue;
                    }
                    xs.push(cells.ramp(cell).map_err(failure)?);
                    ys.push(elevation.get(cell).map_err(failure)?);
                }
                let mx = mean(&xs);
                let my = mean(&ys);
                let mut covariance = 0.0;
                let mut variance = 0.0;
                for (x, y) in xs.into_iter().zip(ys) {
                    covariance += (x - mx) * (y - my);
                    variance += (x - mx).powi(2);
                }
                Ok(if variance > 0.0 {
                    MapScale::metres(2.0 * covariance / variance, LengthUnit::Native)
                } else {
                    f64::NAN
                })
            },
        )
    }
}
