use super::{
    changes::{add, cut, maintenance, shift},
    measurement::mean,
    path::{Path, Station},
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query},
    field::{shared::Scalar as S, Field},
    hpc::BitSet,
    rock::{catalogue, ground::GroundField as G},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    spatial::SpatialKernel,
};
use std::{io, rc::Rc};
pub struct Canyon {
    pub id: atlas_map::Id,
    pub path: Vec<[f64; 2]>,
    pub rim_width_km: f64,
    pub depth_metres: f64,
    pub capture_distance_km: f64,
}
pub struct CanyonWork {
    pub canyon: Canyon,
    pub depth_shortfall: Option<f64>,
}
pub struct CanyonCapture {
    pub canyon: Canyon,
    pub book: bool,
}
pub fn floor_cells(
    field: &Field,
    input: &Canyon,
    corridor: &[u32],
    kernel: &dyn SpatialKernel,
) -> io::Result<Vec<usize>> {
    Ok(geometry(field, input, corridor, kernel)?.floor_cells)
}
pub(super) struct Geometry {
    pub width: f64,
    pub floor_width: f64,
    pub line: Vec<Station>,
    pub floor_cells: Vec<usize>,
    floor_station: Vec<usize>,
    rim_cells: Vec<usize>,
    rim_distance: Vec<f64>,
    rim_station: Vec<usize>,
}
pub(super) fn geometry(
    field: &Field,
    input: &Canyon,
    corridor: &[u32],
    kernel: &dyn SpatialKernel,
) -> io::Result<Geometry> {
    let path = Path::new(&field.mesh, &input.path);
    let width = MapScale::metres(input.rim_width_km, LengthUnit::Kilometre);
    let floor_width = field.scale.supported(width / 4.0, 0.55);
    let rim_reach = width.max(floor_width + field.scale.cells(1.2));
    let step = field.scale.cells(0.5);
    let line = path.stations(step)?;
    if line.is_empty() {
        return Err(io::Error::other("Canyon needs a nonzero path"));
    }
    let hits = path.hits(field, kernel)?;
    let mut channel = BitSet::new(field.mesh.len());
    for &cell in corridor {
        channel.add(cell as usize);
    }
    let mut result = Geometry {
        width,
        floor_width,
        line,
        floor_cells: Vec::new(),
        floor_station: Vec::new(),
        rim_cells: Vec::new(),
        rim_distance: Vec::new(),
        rim_station: Vec::new(),
    };
    for cell in 0..field.mesh.len() {
        let distance = hits.distance.get(cell)?;
        if distance > rim_reach {
            if channel.has(cell) {
                result.floor_cells.push(cell);
                result.floor_station.push(0);
            }
            continue;
        }
        let station = (hits.along.get(cell)? / step)
            .round()
            .min((result.line.len() - 1) as f64) as usize;
        if distance <= floor_width || channel.has(cell) {
            result.floor_cells.push(cell);
            result
                .floor_station
                .push(if distance <= floor_width { station } else { 0 });
        } else {
            result.rim_cells.push(cell);
            result.rim_distance.push(distance);
            result.rim_station.push(station);
        }
    }
    Ok(result)
}
fn fill_along(values: &[f64]) -> Vec<f64> {
    let mut filled = values.to_vec();
    for (k, value) in filled.iter_mut().enumerate() {
        if value.is_finite() {
            continue;
        }
        for reach in 1..values.len() {
            if let Some(&near) = k
                .checked_sub(reach)
                .and_then(|i| values.get(i))
                .filter(|v| v.is_finite())
                .or_else(|| values.get(k + reach).filter(|v| v.is_finite()))
            {
                *value = near;
                break;
            }
        }
    }
    filled
}
struct Profile {
    geometry: Geometry,
    rim: Vec<f64>,
    floor: Vec<f64>,
}
fn profile(
    field: &Field,
    input: &Canyon,
    corridor: &[u32],
    kernel: &dyn SpatialKernel,
) -> io::Result<Profile> {
    let geometry = geometry(field, input, corridor, kernel)?;
    let count = geometry.line.len();
    let mut sums = vec![0.0; count];
    let mut counts = vec![0u32; count];
    let mut floors = vec![f64::NAN; count];
    let height = field.ground().view(G::Elevation);
    for (&cell, &station) in geometry.rim_cells.iter().zip(&geometry.rim_station) {
        sums[station] += height.get(cell)?;
        counts[station] += 1;
    }
    for (&cell, &station) in geometry.floor_cells.iter().zip(&geometry.floor_station) {
        floors[station] = floors[station].min(height.get(cell)?);
    }
    let rim: Vec<_> = sums
        .into_iter()
        .zip(counts)
        .map(|(sum, count)| {
            if count > 0 {
                sum / f64::from(count)
            } else {
                f64::NAN
            }
        })
        .collect();
    Ok(Profile {
        geometry,
        rim: fill_along(&rim),
        floor: fill_along(&floors),
    })
}
pub(super) fn length(field: &Field, fraction: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
pub(super) fn base(field: &Field) -> io::Result<f64> {
    Ok(field.water().effective_sea_level + MapScale::native(length(field, 2.5e-7)?))
}
fn deepen(
    field: &mut Field,
    input: &Canyon,
    corridor: &[u32],
    kernel: &dyn SpatialKernel,
    book: bool,
) -> io::Result<f64> {
    let p = profile(field, input, corridor, kernel)?;
    let fall = MapScale::native(length(field, 5e-8)?);
    let base = base(field)?;
    let mut previous = if p.floor[0].is_finite() {
        p.floor[0] + fall
    } else {
        f64::INFINITY
    };
    let targets: Vec<_> = p
        .rim
        .iter()
        .zip(&p.floor)
        .map(|(&rim, &floor)| {
            let rim = if rim.is_finite() { rim } else { floor };
            let target = (previous - fall).min(rim - MapScale::native(input.depth_metres));
            previous = target;
            target
        })
        .collect();
    let elevation = field.ground().view(G::Elevation);
    let mut applied: f64 = 0.0;
    for (&cell, &station) in p.geometry.floor_cells.iter().zip(&p.geometry.floor_station) {
        let done = cut(field, cell, elevation.get(cell)? - targets[station])?;
        applied = applied.max(done);
        if book {
            add(field, S::LandmarkMaintenance, cell, done)?;
        }
    }
    for (&cell, &station) in p.geometry.rim_cells.iter().zip(&p.geometry.rim_station) {
        let remainder = (base - targets[station]).max(0.0).round();
        if remainder <= 0.0 {
            continue;
        }
        let done = shift(field, cell, remainder)?;
        if book {
            add(field, S::LandmarkMaintenance, cell, done)?;
        }
        applied = applied.max(done);
    }
    Ok(applied)
}
fn corridor(field: &Field, id: atlas_map::Id) -> io::Result<Vec<u32>> {
    field
        .landmark_ledger
        .iter()
        .find(|r| r.id == id)
        .map(|r| r.corridor.clone())
        .ok_or_else(|| io::Error::other("Canyon needs its landmark record"))
}
fn failure(e: io::Error) -> ExecutionError {
    ExecutionError::Failed(e.to_string())
}
impl Field {
    pub fn capture_canyon_river(kernel: Rc<dyn SpatialKernel>) -> Command<Self, CanyonCapture> {
        Command::with_inputs(
            "landmark-canyon-capture",
            CommandKind::Event,
            vec![],
            move |scope, work: &CanyonCapture| {
                super::capture::with_record(scope.state_mut(), work.canyon.id, |field, record| {
                    let geometry =
                        geometry(field, &work.canyon, &record.corridor, kernel.as_ref())?;
                    let target = super::capture::Target {
                        head: super::capture::channel_cell(field, geometry.line[0].point)?,
                        floor: geometry
                            .floor_cells
                            .into_iter()
                            .map(|cell| cell as u32)
                            .collect(),
                        floor_width: geometry.floor_width,
                        reach: MapScale::metres(
                            work.canyon.capture_distance_km,
                            LengthUnit::Kilometre,
                        ),
                        label: "canyon head",
                    };
                    let applied = super::capture::into(field, record, &target, kernel.as_ref())?;
                    if work.book {
                        record.maintenance += applied;
                    }
                    Ok(())
                })
                .map_err(failure)
            },
        )
    }
    pub fn landmark_canyon(kernel: Rc<dyn SpatialKernel>) -> Command<Self, CanyonWork> {
        Command::with_inputs(
            "landmark-canyon",
            CommandKind::Event,
            vec![],
            move |scope, work: &CanyonWork| {
                let field = scope.state_mut();
                let mut apply = || -> io::Result<()> {
                    if work.depth_shortfall.is_some_and(|value| value <= 0.0) {
                        return Ok(());
                    }
                    let corridor = corridor(field, work.canyon.id)?;
                    if work.depth_shortfall.is_none() {
                        let geometry = geometry(field, &work.canyon, &corridor, kernel.as_ref())?;
                        let mut ground = field.ground.try_borrow_mut().map_err(io::Error::other)?;
                        for (&cell, &distance) in
                            geometry.rim_cells.iter().zip(&geometry.rim_distance)
                        {
                            let strength = catalogue::CATALOGUE[catalogue::STRATA].facts.resistance
                                + 2000.0
                                    * (1.0
                                        - (distance - geometry.width / 4.0)
                                            / (geometry.width * 0.75))
                                        .clamp(0.0, 1.0);
                            ground.harden_rock(cell, 8, strength)?;
                        }
                    }
                    let applied = deepen(
                        field,
                        &work.canyon,
                        &corridor,
                        kernel.as_ref(),
                        work.depth_shortfall.is_some(),
                    )?;
                    if work.depth_shortfall.is_some() {
                        maintenance(field, work.canyon.id, applied)?;
                    }
                    Ok(())
                };
                apply().map_err(failure)
            },
        )
    }
    pub fn canyon_measure(kernel: Rc<dyn SpatialKernel>) -> Query<Self, f64> {
        Query::new(
            "landmark-canyon-measures",
            vec![],
            move |field: &Field, scope| {
                let input = scope.input::<Canyon>()?;
                let corridor = corridor(field, input.id).map_err(failure)?;
                let p = profile(field, &input, &corridor, kernel.as_ref()).map_err(failure)?;
                let depths: Vec<_> = p
                    .rim
                    .iter()
                    .zip(p.floor)
                    .map(|(&rim, floor)| MapScale::metres(rim - floor, LengthUnit::Native))
                    .collect();
                Ok(mean(&depths))
            },
        )
    }
}
