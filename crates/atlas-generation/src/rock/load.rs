//! Columnar material on the move. Its depth field is volume until the ground admits it.
use super::{
    cargo::{CargoStore, MaterialCargo},
    layer_bands::{LayerBands, MaterialScalar},
    material::{blend_layers, MaterialLayer},
};
use crate::{
    lattice::TriangularLattice,
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage, ReadBand},
};
use std::{io, rc::Rc};

struct SupplyProjection {
    band: Band<f64>,
    mesh: Rc<TriangularLattice>,
}

pub struct MaterialLoad {
    bands: LayerBands,
    cargo: CargoStore,
    projection: Option<SupplyProjection>,
}
impl MaterialLoad {
    pub(crate) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.label("material-load")?;
        self.bands.checkpoint(archive)?;
        self.cargo.checkpoint(archive)?;
        if let Some(projection) = &mut self.projection {
            archive.band("supply-projection", &mut projection.band)?;
        }
        Ok(())
    }
    pub fn view(&self) -> super::layer_bands::ReadLayerBands {
        self.bands.read_only()
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            bands: LayerBands::new(coverage),
            cargo: CargoStore::new(coverage, coverage.len()),
            projection: None,
        }
    }
    pub fn ground(coverage: &mut Coverage, mesh: Rc<TriangularLattice>) -> Self {
        let mut load = Self::new(coverage);
        load.projection = Some(SupplyProjection {
            band: coverage.allocate(0.0),
            mesh,
        });
        load
    }
    pub fn supply(&self) -> Option<ReadBand<f64>> {
        self.projection.as_ref().map(|p| p.band.read_only())
    }
    fn project(&mut self, cell: usize) -> io::Result<()> {
        let amount = self.amount(cell)?;
        if let Some(projection) = &mut self.projection {
            let area = projection.mesh.area(cell);
            projection.band.set(
                cell,
                if area > 0.0 {
                    MapScale::in_units(amount / area, LengthUnit::Native)
                } else {
                    0.0
                },
            )?;
        }
        Ok(())
    }
    pub fn amount(&self, cell: usize) -> io::Result<f64> {
        self.bands
            .read_only()
            .scalar(MaterialScalar::Depth)
            .get(cell)
    }
    pub fn get(&self, cell: usize) -> io::Result<MaterialLayer> {
        let mut material = self.bands.read_only().read_raw(cell)?;
        material.cargo = self.cargo.get(cell)?;
        Ok(material)
    }
    pub fn import_cargo(&mut self, cell: usize, cargo: Option<&MaterialCargo>) -> io::Result<()> {
        self.cargo.set(
            cell,
            if self.amount(cell)? > 0.0 {
                cargo
            } else {
                None
            },
        )
    }
    /// Construction imports the complete record, including metadata in an empty load.
    pub fn import(&mut self, cell: usize, material: &MaterialLayer) -> io::Result<()> {
        self.bands.write(cell, material)?;
        self.import_cargo(cell, material.cargo.as_ref())?;
        self.project(cell)
    }
    pub fn add(&mut self, cell: usize, material: &MaterialLayer) -> io::Result<()> {
        if material.depth <= 0.0 {
            return Ok(());
        }
        let held = self.get(cell)?;
        let next = if held.depth > 0.0 {
            blend_layers(&held, material, held.depth, material.depth)
        } else {
            material.clone()
        };
        self.bands.write(cell, &next)?;
        self.cargo.set(cell, next.cargo.as_ref())?;
        self.project(cell)
    }
    pub fn take(&mut self, cell: usize, volume: f64) -> io::Result<MaterialLayer> {
        let mut held = self.get(cell)?;
        let taken = held.depth.min(volume.max(0.0));
        self.bands.set_depth(cell, held.depth - taken)?;
        if taken >= held.depth {
            self.cargo.clear(cell)?;
        }
        held.depth = taken;
        self.project(cell)?;
        Ok(held)
    }
    pub fn clear(&mut self, cell: usize) -> io::Result<()> {
        self.bands.write(cell, &MaterialLayer::default())?;
        self.cargo.clear(cell)?;
        self.project(cell)
    }
    pub fn snapshot(&self, coverage: &mut Coverage) -> io::Result<Self> {
        Ok(Self {
            bands: self.bands.snapshot(coverage)?,
            cargo: self.cargo.snapshot(coverage)?,
            projection: self
                .projection
                .as_ref()
                .map(|projection| {
                    Ok::<_, io::Error>(SupplyProjection {
                        band: coverage.copy_band(&projection.band)?,
                        mesh: projection.mesh.clone(),
                    })
                })
                .transpose()?,
        })
    }
}
