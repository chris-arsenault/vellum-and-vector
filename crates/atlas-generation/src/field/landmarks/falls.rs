use super::{
    capture,
    changes::{add, cut, maintenance, shift},
    measurement::distance,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query},
    field::{shared::Scalar as S, Field},
    rock::{catalogue, ground::GroundField as G},
    scale::{LengthUnit, MapScale},
    spatial::SpatialKernel,
};
use std::{io, rc::Rc};
pub struct Falls {
    pub id: atlas_map::Id,
    pub center: [f64; 2],
    pub drop_metres: f64,
    pub capture_distance_km: f64,
}
pub struct FallsWork {
    pub falls: Falls,
    pub drop_shortfall: Option<f64>,
}
pub struct FallsCapture {
    pub falls: Falls,
    pub book: bool,
}
fn lip(field: &Field, falls: &Falls, corridor: &[u32]) -> io::Result<Option<usize>> {
    let Some(nearest) = field.mesh.cell_at(falls.center[0], falls.center[1]) else {
        return Ok(None);
    };
    let mut candidates = vec![nearest];
    candidates.extend(corridor.iter().map(|&i| i as usize));
    for edge in 0..3 {
        if let Some(cell) = field.mesh.neighbor(nearest, edge) {
            candidates.push(cell);
        }
    }
    let mut best = None;
    let mut greatest = f64::NEG_INFINITY;
    for cell in candidates {
        if distance(field, cell, falls.center) > field.scale.cells(1.1) {
            continue;
        }
        let water = capture::water_at(field, cell)?;
        if best.is_none() || water > greatest {
            best = Some(cell);
            greatest = water;
        }
    }
    Ok(best)
}
fn foot(field: &Field, lip: usize) -> io::Result<Option<usize>> {
    let water = field.water.try_borrow().map_err(io::Error::other)?;
    let view = water.read_only();
    let retained = water.river_reader().at(lip).is_some();
    let target = if retained {
        capture::successor(field, lip)?
    } else {
        usize::try_from(view.routing.targets.get(lip)?).ok()
    };
    if let Some(target) = target {
        if view.column.kind.get(target)? == 0 {
            return Ok(Some(target));
        }
    }
    if retained {
        return Ok(None);
    }
    let elevation = field.ground().view(G::Elevation);
    let mut lowest = None;
    let mut minimum = f64::INFINITY;
    for edge in 0..3 {
        if let Some(cell) = field.mesh.neighbor(lip, edge) {
            let height = elevation.get(cell)?;
            if lowest.is_none() || height < minimum {
                lowest = Some(cell);
                minimum = height;
            }
        }
    }
    Ok(lowest)
}
fn hold_step(
    field: &mut Field,
    lip: Option<usize>,
    foot: Option<usize>,
    deficit: f64,
    book: bool,
) -> io::Result<f64> {
    let (Some(lip), Some(foot)) = (lip, foot) else {
        return Ok(0.0);
    };
    if deficit <= 0.0 {
        return Ok(0.0);
    }
    let done = cut(field, foot, deficit)?;
    if book {
        add(field, S::LandmarkMaintenance, foot, done)?;
    }
    let remainder = (deficit - done).round();
    let lifted = if remainder > 0.0 {
        shift(field, lip, remainder)?
    } else {
        0.0
    };
    if book {
        add(field, S::LandmarkMaintenance, lip, lifted)?;
    }
    Ok(done.max(lifted))
}
fn corridor(field: &Field, id: atlas_map::Id) -> io::Result<Vec<u32>> {
    field
        .landmark_ledger
        .iter()
        .find(|r| r.id == id)
        .map(|r| r.corridor.clone())
        .ok_or_else(|| io::Error::other("Falls need their landmark record"))
}
fn failure(e: io::Error) -> ExecutionError {
    ExecutionError::Failed(e.to_string())
}
impl Field {
    pub fn landmark_falls() -> Command<Self, FallsWork> {
        Command::with_inputs(
            "landmark-falls",
            CommandKind::Event,
            vec![],
            |scope, work: &FallsWork| {
                let field = scope.state_mut();
                let mut run = || -> io::Result<()> {
                    let corridor = corridor(field, work.falls.id)?;
                    let lip = lip(field, &work.falls, &corridor)?;
                    if let Some(shortfall) = work.drop_shortfall {
                        let foot = lip.map(|cell| foot(field, cell)).transpose()?.flatten();
                        let applied =
                            hold_step(field, lip, foot, MapScale::native(shortfall), true)?;
                        return maintenance(field, work.falls.id, applied);
                    }
                    let Some(lip) = lip else {
                        return Ok(());
                    };
                    let elevation = field.ground().view(G::Elevation);
                    let height = elevation.get(lip)?;
                    let mut cells = vec![lip];
                    for edge in 0..3 {
                        if let Some(cell) = field.mesh.neighbor(lip, edge) {
                            cells.push(cell);
                        }
                    }
                    for cell in cells {
                        if elevation.get(cell)? >= height {
                            field
                                .ground
                                .try_borrow_mut()
                                .map_err(io::Error::other)?
                                .harden_rock(cell, 8, catalogue::CATALOGUE[8].facts.resistance)?;
                        }
                    }
                    let Some(foot) = foot(field, lip)? else {
                        return Ok(());
                    };
                    let deficit = MapScale::native(work.falls.drop_metres)
                        - (elevation.get(lip)? - elevation.get(foot)?);
                    hold_step(field, Some(lip), Some(foot), deficit, false)?;
                    Ok(())
                };
                run().map_err(failure)
            },
        )
    }
    pub fn falls_measure() -> Query<Self, f64> {
        Query::new("landmark-falls-measures", vec![], |field: &Field, scope| {
            let input = scope.input::<Falls>()?;
            let read = || -> io::Result<f64> {
                let corridor = corridor(field, input.id)?;
                let Some(lip) = lip(field, &input, &corridor)? else {
                    return Ok(f64::NAN);
                };
                let Some(foot) = foot(field, lip)? else {
                    return Ok(f64::NAN);
                };
                let height = field.ground().view(G::Elevation);
                Ok(MapScale::metres(
                    height.get(lip)? - height.get(foot)?,
                    LengthUnit::Native,
                ))
            };
            read().map_err(failure)
        })
    }
    pub fn capture_falls_river(kernel: Rc<dyn SpatialKernel>) -> Command<Self, FallsCapture> {
        Command::with_inputs(
            "landmark-falls-capture",
            CommandKind::Event,
            vec![],
            move |scope, work: &FallsCapture| {
                capture::with_record(scope.state_mut(), work.falls.id, |field, record| {
                    let head = lip(field, &work.falls, &record.corridor)?;
                    let mut floor: Vec<_> = head.into_iter().map(|i| i as u32).collect();
                    floor.extend(&record.corridor);
                    let target = capture::Target {
                        head,
                        floor,
                        floor_width: field.scale.cells(0.55),
                        reach: MapScale::metres(
                            work.falls.capture_distance_km,
                            LengthUnit::Kilometre,
                        ),
                        label: "falls",
                    };
                    let applied = capture::into(field, record, &target, kernel.as_ref())?;
                    if work.book {
                        record.maintenance += applied;
                    }
                    Ok(())
                })
                .map_err(failure)
            },
        )
    }
}
