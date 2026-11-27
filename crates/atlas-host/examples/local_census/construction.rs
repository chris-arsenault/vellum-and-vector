use super::{land, pass, Command, ExecutionResult, Executor, Facts, Field, Timing};
use atlas_generation::{
    human::{catalogue::LayerId, HumanField},
    lattice::hexes::triangle_polygon,
    spatial::SpatialKernel,
};
use atlas_map::{Geometry, Id};
use serde::Deserialize;
use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Footprint {
    world_id: Id,
    footprint: Geometry,
    profile: String,
}

pub(super) struct Case {
    pub source: PathBuf,
    footprint: PathBuf,
    scale: f64,
}

impl Case {
    pub fn parse(mut arguments: impl Iterator<Item = String>) -> io::Result<Self> {
        let mut next = || {
            arguments.next().ok_or_else(|| {
                io::Error::other("Expected scale, captured world and measurement footprint")
            })
        };
        let scale: f64 = next()?.parse().map_err(io::Error::other)?;
        if !scale.is_finite() || scale <= 0. {
            return Err(io::Error::other(
                "Construction scale must be finite and positive",
            ));
        }
        Ok(Self {
            source: next()?.into(),
            footprint: next()?.into(),
            scale,
        })
    }

    pub fn run(
        &self,
        executor: &mut Executor<Field>,
        harden: &Command<Field, pass::Inputs<land::Capital>>,
        spatial: &dyn SpatialKernel,
    ) -> ExecutionResult<()> {
        let read =
            |p: &Path| -> io::Result<Footprint> { Ok(serde_json::from_reader(File::open(p)?)?) };
        let source = read(&self.source)?;
        if source.profile != "world" {
            return Err(
                io::Error::other("Select a World source for historical construction").into(),
            );
        }
        let footprint = read(&self.footprint)?;
        if source.world_id != footprint.world_id {
            return Err(io::Error::other("The selected footprint belongs to another world").into());
        }
        let mesh = executor.state().mesh();
        let polygons: Vec<_> = (0..mesh.len())
            .map(|cell| triangle_polygon(mesh, cell))
            .collect();
        let areas = spatial
            .intersection_areas(&footprint.footprint, &polygons)
            .map_err(io::Error::other)?;
        let cells: Vec<_> = areas
            .into_iter()
            .enumerate()
            .filter(|(_, area)| *area > 0.)
            .collect();
        if cells.is_empty() {
            return Err(io::Error::other("The footprint lies outside the captured lattice").into());
        }
        measure(executor.state(), &cells, "captured")?;
        let site = executor.state().process_site();
        let mut strategy = land::BUILT_GROUND
            .select(site, Timing::Elapsed)?
            .into_iter()
            .find(|strategy| matches!(strategy.algorithm, land::Investment::Historical { .. }))
            .ok_or_else(|| {
                io::Error::other("The capture does not support historical construction")
            })?;
        strategy.algorithm = land::Investment::Historical {
            area_scale: self.scale,
        };
        let inputs = pass::Inputs {
            facts: Facts::settled(100., 1.),
            strategy,
            parent: Default::default(),
            city: None,
        };
        for _ in 0..3 {
            executor.run_with(harden, &inputs)?;
        }
        measure(executor.state(), &cells, "300 years of construction")?;
        Ok(())
    }
}

fn measure(field: &Field, cells: &[(usize, f64)], label: &str) -> io::Result<()> {
    let built = field.people().view(HumanField::Layer(LayerId::BuiltUp));
    let mut land = 0.;
    let mut developed = 0.;
    let mut residents = 0.;
    for &(cell, area) in cells {
        let km2 = area / 1e6;
        land += km2;
        developed += km2 * built.get(cell)?;
        residents += km2 * field.people().people(cell)?;
    }
    println!("{label}: {} native cells, {land:.3} km², {residents:.2} residents, {developed:.4} km² developed ({:.4}%)", cells.len(), 100. * developed / land);
    Ok(())
}
