use super::{
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{ExecutionError, Query, QueryDependency},
    metric::search::physical_distance,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    scale_settings::{ResolvedSettings, ScaleDefinition},
    storage::{Band, ReadBand},
};
use serde::Deserialize;
use std::{io, rc::Rc};
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "ShelfDepth":{"kind":"relative-measure","fraction":0.0000525,"dimension":1,"exponent":1},
        "ShelfBreakDepth":{"kind":"relative-measure","fraction":0.0001075,"dimension":1,"exponent":1},
        "IslandAreaThreshold":{"kind":"relative-measure","fraction":0.000625,"dimension":2,"exponent":1}
    }})).expect("Declared geographic settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    shelf_depth: f64,
    shelf_break_depth: f64,
    island_area_threshold: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
type BoundaryDistance = Rc<dyn Fn(usize) -> io::Result<f64>>;
fn failure(e: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(e.to_string())
}
impl Field {
    pub fn ocean_distance(
        dependencies: Vec<QueryDependency<Self>>,
        boundary: Option<BoundaryDistance>,
    ) -> Query<Self, ReadBand<f64>> {
        Query::new("ocean-distance", dependencies, move |field: &Field, _| {
            field
                .measure_ocean_distance(boundary.as_deref())
                .map_err(failure)?;
            Ok(field.shared.scalar(S::OceanDistance))
        })
    }
    pub(super) fn measure_ocean_distance(
        &self,
        boundary: Option<&dyn Fn(usize) -> io::Result<f64>>,
    ) -> io::Result<()> {
        let water = self.water().column.kind;
        let mut distance = self.shared.derive_scalar(S::OceanDistance);
        let mut seeds = Vec::new();
        for cell in 0..self.mesh.len() {
            distance.set(cell, f64::INFINITY)?;
            if water.get(cell)? == 1 {
                distance.set(cell, 0.0)?;
                if self.touches_land(cell, &water)? {
                    seeds.push(cell);
                }
            } else if let Some(boundary) = boundary {
                let d = boundary(cell)?;
                if d >= 0.0 && d.is_finite() {
                    distance.set(cell, d)?;
                    seeds.push(cell);
                }
            }
        }
        physical_distance(&self.mesh, seeds, &mut distance, f64::INFINITY, |_, _| {
            Ok(())
        })?;
        for cell in 0..self.mesh.len() {
            if !distance.get(cell)?.is_finite() {
                distance.set(cell, -1.0)?;
            }
        }
        Ok(())
    }
    fn touches_land(&self, cell: usize, water: &ReadBand<u8>) -> io::Result<bool> {
        for edge in 0..3 {
            if let Some(next) = self.mesh.neighbor(cell, edge) {
                if water.get(next)? != 1 {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    pub(super) fn measure_slopes(&self) -> io::Result<()> {
        let elevation = self.ground().view(G::Elevation);
        let mut slopes = self.shared.derive_scalar(S::Slope);
        for cell in 0..self.mesh.len() {
            let [x, y] = self.mesh.gradient(cell, &|i| elevation.get(i))?;
            slopes.set(cell, MapScale::metres(x.hypot(y), LengthUnit::Native))?;
        }
        Ok(())
    }
    pub fn bathymetry(
        settings: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new("bathymetry", dependencies, move |field: &Field, _| {
            field.measure_bathymetry(&settings).map_err(failure)
        })
    }
    fn measure_bathymetry(&self, p: &Settings) -> io::Result<()> {
        self.measure_slopes()?;
        let sea = self.water().column;
        let ground = self.ground();
        let elevation = ground.view(G::Elevation);
        let level = ground.effective_sea_level();
        let reach = self
            .scale
            .resolve(RelativeMeasure::length(0.045).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let mut zones = self.shared.derive_code(C::BathymetricZoneCodes);
        for cell in 0..self.mesh.len() {
            let code = if sea.kind.get(cell)? == 1 {
                let depth = sea
                    .store(crate::water::column::Store::Standing)
                    .contents()
                    .get(cell)?;
                if depth <= MapScale::native(p.shelf_depth) {
                    2
                } else if depth <= MapScale::native(p.shelf_break_depth) {
                    3
                } else {
                    4
                }
            } else {
                let distance = self.shared.scalar(S::OceanDistance).get(cell)?;
                i32::from(
                    elevation.get(cell)? <= level + MapScale::native(p.shelf_depth / 2.0)
                        && distance >= 0.0
                        && distance <= reach,
                )
            };
            zones.set(cell, code)?;
        }
        Ok(())
    }
    pub fn landmasses(
        settings: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new("landmasses", dependencies, move |field: &Field, _| {
            field.measure_landmasses(&settings).map_err(failure)
        })
    }
    fn measure_landmasses(&self, p: &Settings) -> io::Result<()> {
        let mut ids = self.shared.derive_code(C::LandmassIds);
        let mut classes = self.shared.derive_code(C::LandmassClassCodes);
        let mut groups = self.shared.derive_code(C::ContinentalGroupIds);
        for cell in 0..self.mesh.len() {
            ids.set(cell, 0)?;
            classes.set(cell, 0)?;
            groups.set(cell, 0)?;
        }
        let ground = self.ground();
        let elevation = ground.view(G::Elevation);
        let level = ground.effective_sea_level();
        let water = self.water().column.kind;
        let dry = |i| Ok(water.get(i)? == 0 && elevation.get(i)? >= level);
        let mut next = 0;
        for cell in 0..self.mesh.len() {
            if !dry(cell)? || ids.get(cell)? != 0 {
                continue;
            }
            next += 1;
            let members = collect(self, cell, next, &mut ids, &dry)?;
            let area: f64 = members.iter().map(|&i| self.mesh.area(i)).sum();
            let class = if area >= p.island_area_threshold {
                2
            } else {
                1
            };
            for member in members {
                classes.set(member, class)?;
            }
        }
        next = 0;
        let floor = level - MapScale::native(p.shelf_break_depth);
        let shelf = |i| Ok(elevation.get(i)? >= floor);
        for cell in 0..self.mesh.len() {
            if !shelf(cell)? || groups.get(cell)? != 0 {
                continue;
            }
            next += 1;
            collect(self, cell, next, &mut groups, &shelf)?;
        }
        Ok(())
    }
}
fn collect(
    field: &Field,
    start: usize,
    id: i32,
    labels: &mut Band<i32>,
    eligible: &impl Fn(usize) -> io::Result<bool>,
) -> io::Result<Vec<usize>> {
    let mut members = vec![start];
    labels.set(start, id)?;
    let mut head = 0;
    while head < members.len() {
        let cell = members[head];
        head += 1;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if labels.get(next)? != 0 || !eligible(next)? {
                continue;
            }
            labels.set(next, id)?;
            members.push(next);
        }
    }
    Ok(members)
}
