use super::{
    allocation::{self, Candidate, Layout},
    controls,
    state::{Province, Site},
    territories,
};
use crate::{
    chance::Chance,
    lattice::TriangularLattice,
    scale_settings::{ResolvedSettings, ScaleDefinition},
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Position};
use serde::Deserialize;

pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({ "kind": "relative-settings", "values": {
        "TectonicProvinceCount":14, "TectonicSiteCandidateMultiplier":24,
        "ContinentalAssemblyCount":3, "ContinentalAssemblyClustering":1,
        "ContinentalAssemblyGrowthVariation":0.8, "ContinentalMajorAssemblies":2,
        "ContinentalMajorGrowth":2, "OceanicPlateCount":2, "OceanicPlateWaterShare":0.5,
        "ContinentalCrustFraction":0.48, "TectonicMotionMinimum":0.22, "TectonicMotionMaximum":0.72
    }}))
    .expect("Declared province settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    tectonic_province_count: usize,
    tectonic_site_candidate_multiplier: usize,
    continental_assembly_count: usize,
    continental_assembly_clustering: f64,
    continental_assembly_growth_variation: f64,
    continental_major_assemblies: usize,
    continental_major_growth: f64,
    oceanic_plate_count: usize,
    oceanic_plate_water_share: f64,
    continental_crust_fraction: f64,
    tectonic_motion_minimum: f64,
    tectonic_motion_maximum: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
    fn layout(&self) -> Layout {
        Layout {
            assemblies: self.continental_assembly_count,
            continental_fraction: self.continental_crust_fraction,
            clustering: self.continental_assembly_clustering,
            growth_variation: self.continental_assembly_growth_variation,
            major_assemblies: self.continental_major_assemblies,
            major_growth: self.continental_major_growth,
            ocean_plates: self.oceanic_plate_count,
            ocean_water_share: self.oceanic_plate_water_share,
        }
    }
}
pub fn create_provinces(
    mesh: &TriangularLattice,
    kernel: &dyn SpatialKernel,
    profile: &Settings,
    seed: i32,
) -> SpatialResult<Vec<Province>> {
    let count = profile
        .tectonic_province_count
        .checked_mul(profile.tectonic_site_candidate_multiplier)
        .ok_or("Province candidate count exceeds address space")?;
    let bounds = mesh.bounds();
    let scatter = super::sources::scatter(seed);
    let mut selected: Vec<_> = (0..count)
        .map(|id| Candidate {
            position: scatter.position(id, bounds),
            priority: scatter.rank(id),
        })
        .collect();
    // hpc-exempt: seeded province candidates sorted once before selecting the configured count.
    selected.sort_by(|a, b| b.priority.total_cmp(&a.priority));
    selected.truncate(profile.tectonic_province_count);
    let width = mesh.periodic_width().unwrap_or(0.0);
    let positions: Vec<_> = selected.iter().map(|s| s.position).collect();
    let territory = territories::territories(kernel, &positions, bounds, width)?;
    let allocation = allocation::allocate(&selected, &territory, profile.layout(), seed, width);
    Ok(selected
        .into_iter()
        .enumerate()
        .map(|(i, candidate)| {
            let angle = Chance::of(seed, 0x5c27).angle([i as f64, 0.0]);
            let speed = Chance::of(seed, 0x5c27 + 0x16da).between(
                [i as f64, 1.0],
                [
                    profile.tectonic_motion_minimum,
                    profile.tectonic_motion_maximum,
                ],
            );
            Province {
                position: candidate.position,
                priority: candidate.priority,
                assembly: allocation.continents[i],
                ocean_plate: allocation.oceans[i],
                motion: [angle.cos() * speed, angle.sin() * speed],
            }
        })
        .collect())
}
fn plate_roots(source: &[Province], seed: i32) -> Vec<usize> {
    let candidates: Vec<_> = (0..source.len())
        .filter(|&i| source[i].ocean_plate == 0)
        .collect();
    let ranked =
        Chance::of(seed, 0x7143).ranked(candidates.iter().copied(), |at, _| [at as f64, 0.0]);
    let mut continents = Vec::new();
    for &i in &candidates {
        let id = source[i].assembly;
        if id > 0 && !continents.contains(&id) {
            continents.push(id);
        }
    }
    let mut founders: Vec<_> = continents
        .iter()
        .map(|&id| *ranked.iter().find(|i| source[**i].assembly == id).unwrap())
        .collect();
    let count =
        ((candidates.len() as f64 / controls::INITIAL_PROVINCES_PER_PLATE).round() as usize).max(2);
    let additional = count.saturating_sub(founders.len());
    founders.extend(
        ranked
            .into_iter()
            .filter(|i| source[*i].assembly == 0)
            .take(additional),
    );
    founders
}
pub fn initial_sites(
    mesh: &TriangularLattice,
    kernel: &dyn SpatialKernel,
    profile: &Settings,
    seed: i32,
) -> SpatialResult<Vec<Site>> {
    let source = create_provinces(mesh, kernel, profile, seed)?;
    let roots = plate_roots(&source, seed);
    let width = mesh.coordinate_width().unwrap_or(0.0);
    let offsets: &[f64] = if width == 0.0 {
        &[0.0]
    } else {
        &[-width, 0.0, width]
    };
    let mut points = Vec::new();
    for offset in offsets {
        for &i in &roots {
            points.push(Geometry::Point {
                coordinates: Position::xy(source[i].position[0] + offset, source[i].position[1]),
            });
        }
    }
    let index = kernel.index(&points)?;
    let positions: Vec<_> = source.iter().map(|s| s.position).collect();
    let areas = territories::areas(
        kernel,
        &positions,
        mesh.bounds(),
        mesh.periodic_width().unwrap_or(0.0),
    )?;
    source
        .iter()
        .enumerate()
        .map(|(i, province)| {
            let ocean = province.ocean_plate > 0;
            let root = if ocean {
                None
            } else if province.assembly > 0 {
                roots
                    .iter()
                    .position(|&r| source[r].assembly == province.assembly)
            } else {
                index
                    .nearest(Position::xy(province.position[0], province.position[1]))?
                    .map(|i| i % roots.len())
            };
            let (driver, plate) = if ocean {
                (
                    source
                        .iter()
                        .find(|s| s.ocean_plate == province.ocean_plate)
                        .unwrap(),
                    roots.len() + province.ocean_plate,
                )
            } else {
                let root = root.ok_or("Non-ocean province has no founding plate")?;
                (&source[roots[root]], root + 1)
            };
            let share = if ocean {
                0.0
            } else {
                controls::LOCAL_DRIVING_SHARE
            };
            let drive = [
                driver.motion[0] * (1.0 - share) + province.motion[0] * share,
                driver.motion[1] * (1.0 - share) + province.motion[1] * share,
            ];
            let mut province = province.clone();
            province.motion = drive;
            Ok(Site {
                origin: province.position,
                area: areas[i],
                mass: areas[i] * if province.assembly > 0 { 4.0 } else { 1.0 },
                province,
                id: i + 1,
                plate,
                drive,
                compliance: 0.0,
                block: plate,
                pull: [0.0; 2],
            })
        })
        .collect()
}
