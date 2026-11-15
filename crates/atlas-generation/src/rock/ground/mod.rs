//! Ground authority: columns, placement and derived reads change together.
// Arconis: docs/architecture/subsystems.arconis#item=g_ops — ground owner operations: wear, burial, heat, deformation, transport.
mod actions;
pub mod alteration;
mod burial;
mod checkpoint;
mod collision;
pub mod contacts;
pub mod crust;
pub mod deformation;
pub mod deposition;
mod extraction;
mod faces;
mod history;
mod incision;
mod initialization;
pub mod inventory;
mod inventory_actions;
mod ledger;
mod metamorphism;
pub mod observers;
mod placement;
mod protection;
pub mod queries;
pub mod query;
pub mod remap;
mod storage;
mod surface_media;
pub mod transport;
mod transport_load;
mod weak_layers;
use super::{cargo_identity::CargoIdentities, columns::RockColumns};
use crate::{
    lattice::TriangularLattice, scale::MapScale, settlement::stage::Pool, storage::ReadBand,
};
pub use actions::GroundTaken;
pub use collision::Accretion;
pub use faces::{support_failure_depth, FaceQuery, FailureFace};
pub use inventory_actions::{Charge, InventoryAccess, InventoryConstruction};
pub use placement::SectionLayer;
use std::{io, rc::Rc};
pub use storage::{GroundField, GroundStorage};

pub type MaterialReceiver<'a> = dyn FnMut(super::material::MaterialLayer) -> io::Result<()> + 'a;
type WaterReconciler = Box<dyn FnMut(usize) -> io::Result<()>>;
pub struct GroundInputs {
    pub tree: ReadBand<f64>,
    pub grass: ReadBand<f64>,
    pub wetland: ReadBand<f64>,
    pub ice: ReadBand<f64>,
    pub fire: ReadBand<f64>,
    pub fracture: ReadBand<f64>,
    pub ward: ReadBand<f64>,
    pub marine: ReadBand<u8>,
    pub root_hold: Option<ReadBand<f64>>,
    pub stiffening: Option<ReadBand<f64>>,
}
pub struct GroundSeed {
    pub storage: GroundStorage,
    pub columns: RockColumns,
    pub identities: CargoIdentities,
    pub scale: MapScale,
    pub sea_level: f64,
    pub completed_epochs: f64,
    pub crust_initialized: bool,
    pub support_initialized: bool,
}
pub trait GroundEvents {
    fn remapped_package(
        &mut self,
        column: super::columns::Column,
        before: usize,
        after: usize,
    ) -> io::Result<()>;
    fn constructed(
        &mut self,
        cell: usize,
        material: &super::material::MaterialLayer,
        cause: &str,
        amount: f64,
    ) -> io::Result<()>;
    fn folded(
        &mut self,
        cell: usize,
        column: super::columns::Column,
        fold: &super::coarsening::Fold<'_>,
    ) -> io::Result<()>;
    fn changed(&mut self, cell: usize) -> io::Result<()>;
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Transfer {
    pub cause: String,
    pub from: Pool,
    pub to: Pool,
    pub volume: f64,
}
#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct CrustBudget {
    pub ocean_created: f64,
    pub ocean_consumed: f64,
    pub continental_exported: f64,
    pub ocean_exported: f64,
    pub continental_adjustment: f64,
    pub ocean_adjustment: f64,
}
/// Writers enter once at construction. Callers retain only read views and owner operations.
/// ```compile_fail
/// use atlas_generation::rock::ground::Ground;
/// fn spill(ground: &mut Ground) { ground.storage.bands[0].set(0, 4.0); }
/// ```
pub struct Ground {
    storage: GroundStorage,
    columns: RockColumns,
    identities: CargoIdentities,
    mesh: Rc<TriangularLattice>,
    scale: MapScale,
    inputs: GroundInputs,
    sea_level: f64,
    epoch: f64,
    crust_initialized: bool,
    support_initialized: bool,
    crust_budget: CrustBudget,
    transfers: Vec<Transfer>,
    produced: f64,
    deposited: f64,
    exported: f64,
    history: Vec<(String, crate::storage::Band<f64>)>,
    reconcile: Option<WaterReconciler>,
    events: Box<dyn GroundEvents>,
    last_action: std::cell::Cell<(usize, GroundTaken)>,
    watcher: Option<transport::TransferWatch>,
    inventory_cache: std::cell::RefCell<inventory::InventoryCache>,
}
impl Ground {
    pub fn support_initialized(&self) -> bool {
        self.support_initialized
    }
    pub fn new(
        seed: GroundSeed,
        mesh: Rc<TriangularLattice>,
        inputs: GroundInputs,
        events: Box<dyn GroundEvents>,
    ) -> io::Result<Self> {
        let mut ground = Self {
            storage: seed.storage,
            columns: seed.columns,
            identities: seed.identities,
            scale: seed.scale,
            sea_level: seed.sea_level,
            epoch: seed.completed_epochs,
            mesh,
            inputs,
            crust_initialized: seed.crust_initialized,
            support_initialized: seed.support_initialized,
            crust_budget: CrustBudget::default(),
            transfers: Vec::new(),
            produced: 0.0,
            deposited: 0.0,
            exported: 0.0,
            history: Vec::new(),
            reconcile: None,
            events,
            last_action: std::cell::Cell::new((usize::MAX, GroundTaken::default())),
            watcher: None,
            inventory_cache: Default::default(),
        };
        for cell in 0..ground.mesh.len() {
            ground.project(cell)?;
        }
        Ok(ground)
    }
    pub fn view(&self, name: GroundField) -> ReadBand<f64> {
        self.storage.view(name)
    }
    /// Ecology changes the surface soil skin; it does not replace the retained substrate.
    pub fn soil_depth(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        self.set(GroundField::SoilDepth, cell, depth)
    }
    pub fn columns(&self) -> &RockColumns {
        &self.columns
    }
    pub fn cargo_identities(&self) -> &CargoIdentities {
        &self.identities
    }
    pub fn record(&self) -> &[Transfer] {
        &self.transfers
    }
    pub fn crust_budget(&self) -> &CrustBudget {
        &self.crust_budget
    }
    pub fn produced(&self) -> f64 {
        self.produced
    }
    pub fn deposited(&self) -> f64 {
        self.deposited
    }
    pub fn exported(&self) -> f64 {
        self.exported
    }
    pub fn bind_water(&mut self, reconcile: impl FnMut(usize) -> io::Result<()> + 'static) {
        self.reconcile = Some(Box::new(reconcile));
    }
    pub fn bind_history(&mut self, name: &str, band: crate::storage::Band<f64>) -> io::Result<()> {
        if self.history.iter().any(|(held, _)| held == name) {
            return Err(io::Error::other("Ground history band already bound"));
        }
        self.history.push((name.into(), band));
        Ok(())
    }
    pub fn root_hold(&mut self, hold: Option<ReadBand<f64>>) {
        self.inputs.root_hold = hold;
    }
    fn get(&self, field: GroundField, cell: usize) -> io::Result<f64> {
        self.storage.bands[field as usize].get(cell)
    }
    fn set(&mut self, field: GroundField, cell: usize, value: f64) -> io::Result<()> {
        self.storage.bands[field as usize].set(cell, value)
    }
    fn add(&mut self, field: GroundField, cell: usize, value: f64) -> io::Result<()> {
        self.set(field, cell, self.get(field, cell)? + value)
    }
    fn volume(&self, cell: usize, depth: f64) -> f64 {
        MapScale::metres(depth, crate::scale::LengthUnit::Native) * self.mesh.area(cell)
    }
    // Arconis: docs/architecture/subsystems.arconis#item=q_ledger — records each transfer with its source and destination pools.
    fn record_flow(&mut self, cause: &str, from: Pool, to: Pool, volume: f64) {
        if volume == 0.0 {
            return;
        }
        if let Some(held) = self
            .transfers
            .iter_mut()
            .find(|held| held.cause == cause && held.from == from && held.to == to)
        {
            held.volume += volume;
        } else {
            self.transfers.push(Transfer {
                cause: cause.into(),
                from,
                to,
                volume,
            });
        }
    }
}
