use super::{
    changes::{add, cut, excavate, shift},
    measurement::{distance, mean},
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query, QueryValue},
    field::{impacts, shared::Scalar as S, Field},
    hpc::{radix_order, BitSet, Direction, NumericKey},
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
};
use std::{io, rc::Rc};
pub struct Dome {
    pub center: [f64; 2],
    pub diameter_km: f64,
    pub ring_count: f64,
    pub ring_relief: f64,
}
pub struct DomeWork {
    pub landmark_id: atlas_map::Id,
    pub dome: Dome,
    pub relief_shortfall: Option<f64>,
}
struct Classes {
    cells: Vec<usize>,
    crests: BitSet,
    radius: f64,
    count: f64,
}
fn classes(field: &Field, dome: &Dome) -> io::Result<Classes> {
    let radius = MapScale::metres(dome.diameter_km, LengthUnit::Kilometre) / 2.0;
    let count = dome.ring_count.round().max(1.0);
    let spacing = radius / count;
    let mut cells = Vec::new();
    let mut phases = Vec::new();
    for cell in 0..field.mesh.len() {
        let d = distance(field, cell, dome.center);
        if d <= radius {
            cells.push(cell);
            phases.push((d % spacing / spacing - 0.5).abs());
        }
    }
    let mut split = 0.25;
    if !phases.iter().any(|&phase| phase < split) || !phases.iter().any(|&phase| phase >= split) {
        let order = radix_order(&[NumericKey::Float(&phases)], Direction::Ascending)
            .map_err(io::Error::other)?;
        split = if phases.is_empty() {
            f64::NAN
        } else {
            phases[order[phases.len() / 2]] + 1e-9
        };
    }
    let mut crests = BitSet::new(field.mesh.len());
    for (&cell, &phase) in cells.iter().zip(&phases) {
        if phase < split {
            crests.add(cell);
        }
    }
    Ok(Classes {
        cells,
        crests,
        radius,
        count,
    })
}
fn dome_apply(field: &mut Field, work: &DomeWork) -> io::Result<f64> {
    let c = classes(field, &work.dome)?;
    let mut applied: f64 = 0.0;
    if let Some(shortfall) = work.relief_shortfall {
        let needed = MapScale::native(shortfall);
        if needed <= 0.0 {
            return Ok(0.0);
        }
        let mut remainder: f64 = 0.0;
        for &cell in &c.cells {
            if c.crests.has(cell) {
                continue;
            }
            let done = cut(field, cell, needed)?;
            add(field, S::LandmarkMaintenance, cell, done)?;
            applied = applied.max(done);
            remainder = remainder.max(needed - done);
        }
        for &cell in &c.cells {
            if !c.crests.has(cell) {
                continue;
            }
            let done = shift(field, cell, remainder.round())?;
            add(field, S::LandmarkMaintenance, cell, done)?;
            applied = applied.max(done);
        }
    } else {
        let height = MapScale::native(work.dome.ring_relief * (c.count + 1.0));
        let realized = c.radius * 2.0 >= field.scale.cells(2.0)
            && c.radius / work.dome.ring_count >= field.scale.cells(1.0);
        for &cell in &c.cells {
            let d = distance(field, cell, work.dome.center);
            shift(
                field,
                cell,
                (height * (1.0 - (d / c.radius).powi(2))).round(),
            )?;
            let resistance = if !realized {
                2000.0
            } else if c.crests.has(cell) {
                3400.0
            } else {
                600.0
            };
            field
                .ground
                .try_borrow_mut()
                .map_err(io::Error::other)?
                .harden_rock(cell, 8, resistance)?;
        }
    }
    Ok(applied)
}
pub struct ImpactRing {
    pub center: [f64; 2],
    pub diameter_km: f64,
    pub floor_depth: f64,
    pub rim_height: f64,
}
pub struct ImpactRingWork {
    pub landmark_id: atlas_map::Id,
    pub ring: ImpactRing,
    pub shortfall: Option<CraterMeasures>,
}
pub struct CraterMeasures {
    pub floor_depth: f64,
    pub rim_height: f64,
}
impl QueryValue for CraterMeasures {}
struct CraterBands {
    radius: f64,
    band: f64,
    floor: f64,
    plain_outer: f64,
}
impl CraterBands {
    fn new(field: &Field, ring: &ImpactRing) -> Self {
        let radius = MapScale::metres(ring.diameter_km, LengthUnit::Kilometre) / 2.0;
        Self {
            radius,
            band: field.scale.supported(radius * 0.2, 0.6),
            floor: field.scale.supported(radius * 0.4, 0.6),
            plain_outer: (radius * 2.4).max(radius * 1.6 + field.scale.cells(1.2)),
        }
    }
    fn rim(&self, d: f64) -> bool {
        (d - self.radius).abs() <= self.band
    }
}
fn crater_maintain(
    field: &mut Field,
    work: &ImpactRingWork,
    shortfall: &CraterMeasures,
) -> io::Result<f64> {
    let bands = CraterBands::new(field, &work.ring);
    let deeper = MapScale::native(shortfall.floor_depth);
    let higher = MapScale::native(shortfall.rim_height);
    let mut applied: f64 = 0.0;
    for cell in 0..field.mesh.len() {
        let d = distance(field, cell, work.ring.center);
        if deeper > 0.0 && d <= bands.floor {
            let done = excavate(field, cell, deeper)?;
            add(field, S::LandmarkMaintenance, cell, done)?;
            applied = applied.max(done);
        }
        if higher > 0.0 && bands.rim(d) {
            let done = shift(field, cell, higher)?;
            add(field, S::ImpactRimUplift, cell, done)?;
            add(field, S::LandmarkMaintenance, cell, done)?;
            applied = applied.max(done);
        }
    }
    Ok(applied)
}
fn failure(e: io::Error) -> ExecutionError {
    ExecutionError::Failed(e.to_string())
}
impl Field {
    pub fn landmark_dome_ring() -> Command<Self, DomeWork> {
        Command::with_inputs(
            "landmark-dome-ring",
            CommandKind::Event,
            vec![],
            |scope, work| {
                let field = scope.state_mut();
                let applied = dome_apply(field, work).map_err(failure)?;
                if work.relief_shortfall.is_some() {
                    super::changes::maintenance(field, work.landmark_id, applied)
                        .map_err(failure)?;
                }
                Ok(())
            },
        )
    }
    pub fn dome_ring_measure() -> Query<Self, f64> {
        Query::new(
            "landmark-dome-ring-measures",
            vec![],
            |field: &Field, scope| {
                let dome = scope.input::<Dome>()?;
                let c = classes(field, &dome).map_err(failure)?;
                let elevation = field.ground().view(G::Elevation);
                let mut up = Vec::new();
                let mut down = Vec::new();
                for cell in c.cells {
                    let list = if c.crests.has(cell) {
                        &mut up
                    } else {
                        &mut down
                    };
                    list.push(elevation.get(cell).map_err(failure)?);
                }
                Ok(MapScale::metres(
                    mean(&up) - mean(&down),
                    LengthUnit::Native,
                ))
            },
        )
    }
    pub fn landmark_impact_ring(
        settings: Rc<impacts::settings::Settings>,
    ) -> Command<Self, ImpactRingWork> {
        let impact = Self::shape_impact(settings);
        Command::with_inputs(
            "landmark-impact-ring",
            CommandKind::Event,
            vec![],
            move |scope, work: &ImpactRingWork| {
                if let Some(shortfall) = &work.shortfall {
                    let field = scope.state_mut();
                    let applied = crater_maintain(field, work, shortfall).map_err(failure)?;
                    super::changes::maintenance(field, work.landmark_id, applied).map_err(failure)
                } else {
                    scope.run(
                        &impact,
                        &impacts::Shape {
                            position: work.ring.center,
                            radius: MapScale::metres(work.ring.diameter_km, LengthUnit::Kilometre)
                                / 2.0,
                            depth: work.ring.floor_depth,
                            rim: work.ring.rim_height,
                        },
                    )
                }
            },
        )
    }
    pub fn impact_ring_measures() -> Query<Self, CraterMeasures> {
        Query::new(
            "landmark-impact-ring-measures",
            vec![],
            |field: &Field, scope| {
                let ring = scope.input::<ImpactRing>()?;
                let bands = CraterBands::new(field, &ring);
                let elevation = field.ground().view(G::Elevation);
                let mut floor = Vec::new();
                let mut rim = Vec::new();
                let mut plain = Vec::new();
                for cell in 0..field.mesh.len() {
                    let d = distance(field, cell, ring.center);
                    let list = if d <= bands.floor {
                        &mut floor
                    } else if bands.rim(d) {
                        &mut rim
                    } else if d >= bands.radius * 1.6 && d <= bands.plain_outer {
                        &mut plain
                    } else {
                        continue;
                    };
                    list.push(elevation.get(cell).map_err(failure)?);
                }
                Ok(CraterMeasures {
                    floor_depth: MapScale::metres(mean(&rim) - mean(&floor), LengthUnit::Native),
                    rim_height: MapScale::metres(mean(&rim) - mean(&plain), LengthUnit::Native),
                })
            },
        )
    }
}
