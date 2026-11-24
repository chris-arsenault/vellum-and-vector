//! Captured current-format resources are sampled into child-owned construction bands.
pub mod cargo;
mod material;
mod people;
pub mod resources;
use super::{
    owner::FieldSeed,
    projection::channels,
    shared::{CellCode, Flag, FloatField, Scalar},
};
use crate::{
    lattice::{GhostChannel, TriangularLattice},
    reconstruction::{mapping::Mapping, resample::Sampler, Grid},
    spatial::SpatialKernel,
    storage::{Band, Coverage},
};
use resources::Resource;
// hpc-exempt: resource schema names, not per-cell object storage.
use std::{collections::BTreeMap, io, rc::Rc};

pub struct Inputs {
    pub surface: Rc<Resource>,
    // hpc-exempt: captured grids selected by channel name; cells live in resource bands.
    pub parent: BTreeMap<String, Rc<Resource>>,
}
pub fn products(carries: impl Fn(&str) -> bool) -> Vec<String> {
    let mut bands = channels::physical()
        .into_iter()
        .filter(|channel| carries(&channel.name))
        .map(|channel| channel.name)
        .collect::<Vec<_>>();
    if carries("Elevation") {
        for name in [
            "RockKindCodes",
            "SedimentSupply",
            "Geothermal",
            "IceThickness",
        ] {
            if !bands.iter().any(|band| band == name) {
                bands.push(name.into());
            }
        }
    }
    bands
        .into_iter()
        .map(|name| format!("field:{name}"))
        .collect()
}
impl Inputs {
    pub fn products(&self) -> Vec<String> {
        products(|name| self.parent.contains_key(name) || self.surface.channels.contains_key(name))
    }
    pub fn source(&self, name: &str) -> &Resource {
        self.parent.get(name).unwrap_or(&self.surface)
    }
    pub fn material(&self) -> &Resource {
        self.source("RockLayerKind0")
    }
    fn sample(
        &self,
        channel: &channels::Channel,
        mesh: &TriangularLattice,
        mapping: &Mapping,
        coverage: &mut Coverage,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Option<Band<f64>>> {
        let source = if channel.material {
            self.material()
        } else {
            self.source(&channel.name)
        };
        let Some(values) = source.channels.get(&channel.name) else {
            return Ok(None);
        };
        if values.unit != channel.unit {
            return Err(io::Error::other(format!(
                "Inherited {} requires {}; received {}",
                channel.name, channel.unit, values.unit
            )));
        }
        let extensive = channel.quantity == channels::Quantity::Extensive;
        let mut sampler = Sampler::new(
            source,
            &channel.name,
            channel.discrete || channel.quantity == channels::Quantity::Category,
            extensive,
            coverage,
            spatial,
        )?;
        let mut into = coverage.allocate(0.0);
        let [ox, oy] = mesh.origin();
        for start in (0..mesh.len()).step_by(4096) {
            let end = (start + 4096).min(mesh.len());
            let points = (start..end)
                .map(|cell| {
                    let [x, y] = mesh.position(cell);
                    [ox + x, oy + y]
                })
                .collect::<Vec<_>>();
            let locations = mapping.batch(start, end - start)?;
            for (offset, value) in sampler
                .sample_batch(&points, Some(&locations), spatial)?
                .into_iter()
                .enumerate()
            {
                let cell = start + offset;
                let value = value * if extensive { mesh.area(cell) } else { 1.0 };
                into.set(
                    cell,
                    value
                        .max(channel.minimum.unwrap_or(f64::NEG_INFINITY))
                        .min(channel.maximum.unwrap_or(f64::INFINITY)),
                )?;
            }
        }
        Ok(Some(into))
    }
    pub fn sample_all(
        &self,
        mesh: &TriangularLattice,
        coverage: &mut Coverage,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Samples> {
        let mut sampled = Samples::default();
        let mut remaining = channels::physical();
        if self.parent.contains_key("populationCapacity") {
            let mut harvest = channels::Channel::new(
                "populationCapacity",
                "people/square-kilometre",
                &[],
                "population",
            );
            harvest.discrete = true;
            remaining.push(harvest);
        }
        while let Some(channel) = remaining.pop() {
            let source = if channel.material {
                self.material()
            } else {
                self.source(&channel.name)
            };
            let [ox, oy] = mesh.origin();
            let mapping = Mapping::new(
                &source.grid,
                mesh.len(),
                |cell| {
                    let [x, y] = mesh.position(cell);
                    Ok([ox + x, oy + y])
                },
                coverage,
            )?;
            let mut selected = vec![channel];
            let mut i = 0;
            while i < remaining.len() {
                let channel = &remaining[i];
                let other = if channel.material {
                    self.material()
                } else {
                    self.source(&channel.name)
                };
                if Rc::ptr_eq(&source.grid, &other.grid) {
                    selected.push(remaining.remove(i));
                } else {
                    i += 1;
                }
            }
            for channel in selected {
                if let Some(values) = self.sample(&channel, mesh, &mapping, coverage, spatial)? {
                    sampled.bands.insert(channel.name, values);
                }
            }
        }
        Ok(sampled)
    }
    /// Boundary support beyond the child's edge, sampled from the parent like its cells.
    pub fn sample_ghosts(
        &self,
        mesh: &mut TriangularLattice,
        coverage: &mut Coverage,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        let [ox, oy] = mesh.origin();
        let points = mesh
            .support()
            .ghosts()
            .iter()
            .map(|ghost| [ox + ghost.position[0], oy + ghost.position[1]])
            .collect::<Vec<_>>();
        for &ghost in GhostChannel::ALL {
            let name = match ghost {
                GhostChannel::Elevation => "Elevation",
            };
            let Some(channel) = channels::physical().into_iter().find(|c| c.name == name) else {
                continue;
            };
            let source = self.source(name);
            if !source.channels.contains_key(name) {
                continue;
            }
            let extensive = channel.quantity == channels::Quantity::Extensive;
            let mut sampler = Sampler::new(
                source,
                name,
                channel.discrete || channel.quantity == channels::Quantity::Category,
                extensive,
                coverage,
                spatial,
            )?;
            let values = sampler
                .batch(&points, spatial)?
                .into_iter()
                .map(|value| {
                    (value * if extensive { mesh.area(0) } else { 1.0 })
                        .max(channel.minimum.unwrap_or(f64::NEG_INFINITY))
                        .min(channel.maximum.unwrap_or(f64::INFINITY))
                })
                .collect();
            mesh.capture_ghosts(ghost, values)
                .map_err(io::Error::other)?;
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct Samples {
    // hpc-exempt: resource schema keyed by name; every numeric field is a typed band.
    bands: BTreeMap<String, Band<f64>>,
}
impl Samples {
    pub fn get(&self, name: &str, cell: usize) -> io::Result<Option<f64>> {
        self.bands.get(name).map(|band| band.get(cell)).transpose()
    }
    pub fn require(&self, name: &str, cell: usize) -> io::Result<f64> {
        self.get(name, cell)?
            .ok_or_else(|| io::Error::other(format!("Current captured material requires {name}")))
    }
    pub fn import_seed(&self, seed: &mut FieldSeed, mesh: &TriangularLattice) -> io::Result<()> {
        for channel in channels::material() {
            if !self.bands.contains_key(&channel.name) {
                return Err(io::Error::other(format!(
                    "Ground import requires complete current-format material: {}",
                    channel.name
                )));
            }
        }
        for cell in 0..mesh.len() {
            self.shared(seed, cell)?;
            material::install(self, seed, cell)?;
            people::install(self, seed, cell)?;
            seed.shared.code_mut(CellCode::CrustTypeCodes).set(
                cell,
                if self.require("CrustContinentalFraction", cell)? >= 500.0 {
                    2
                } else {
                    1
                },
            )?;
        }
        if let (Some(food), Some(farmland), Some(residents)) = (
            self.bands.get("populationCapacity"),
            self.bands.get("Farmland"),
            self.bands.get("Population"),
        ) {
            seed.capture_harvest(food, farmland, residents)?;
        }
        seed.crust_formed = true;
        seed.ground.support_initialized = true;
        Ok(())
    }
    fn shared(&self, seed: &mut FieldSeed, cell: usize) -> io::Result<()> {
        for &field in Scalar::ALL {
            if let Some(value) = self.get(field.name(), cell)? {
                seed.shared.scalar_mut(field).set(cell, value)?;
            }
        }
        for &field in CellCode::ALL {
            if let Some(value) = self.get(field.name(), cell)? {
                seed.shared
                    .code_mut(field)
                    .set(cell, (value + 0.5).floor() as i32)?;
            }
        }
        for &field in FloatField::ALL {
            if let Some(value) = self.get(field.name(), cell)? {
                seed.shared.float_mut(field).set(cell, value as f32)?;
            }
        }
        for &field in Flag::ALL {
            if let Some(value) = self.get(field.name(), cell)? {
                seed.shared.flag_mut(field).set(cell, value as u8)?;
            }
        }
        Ok(())
    }
}

/// Position in a captured resource is in the shared world chart, including its periodic seam.
/// The point is located on the grid first, as the discrete material sampler locates it, so a
/// cell past the grid's outer samples takes its cargo from the same donor as its layers.
pub fn donor(mesh: &TriangularLattice, grid: &Grid, cell: usize) -> io::Result<usize> {
    let [ox, oy] = mesh.origin();
    let [x, y] = mesh.position(cell);
    grid.sample_index(grid.located_point(grid.locate([x + ox, y + oy])?)?)
}

pub struct Completion<'a> {
    pub samples: &'a Samples,
    pub base_sea_level: f64,
    pub effective_sea_level: f64,
    pub retained_rivers: Option<&'a crate::water::captured::RetainedNetwork>,
}
pub fn complete<'a>() -> crate::execution::Command<super::Field, Completion<'a>> {
    crate::execution::Command::with_inputs(
        "field.inherit-captured",
        crate::execution::CommandKind::Initialize,
        vec![],
        |scope, input: &Completion<'_>| {
            let field = scope.state_mut();
            let mut water = field.water.borrow_mut();
            water.inherit_datum(input.base_sea_level, input.effective_sea_level);
            for cell in 0..field.mesh.len() {
                water.inherit_resources(cell, |name| input.samples.get(name, cell))?;
            }
            if let Some(network) = input.retained_rivers {
                water.restore_network(network)?;
            }
            field.ground.borrow_mut().capture_deposition()?;
            Ok(())
        },
    )
}
