//! One run-owned water package. Algorithms share these owners and never duplicate their bands.
use super::{
    captured::RetainedNetwork,
    channel_geometry::{ChannelGeometry, ChannelView},
    column::{CapturedColumn, WaterColumn, WaterColumnView, WaterMedium},
    drainage::{Drainage, DrainageView},
    groundwater::{Groundwater, GroundwaterView},
    ledger::{Transfer, WaterLedger},
    meltwater::{Meltwater, MeltwaterView},
    network::{RiverProjection, RiverReader},
    ocean::OceanDatum,
    reaches::ReachStore,
    routing::{FlowRouting, FlowRoutingView},
    runoff::{Runoff, RunoffView},
    warmth::RiverWarmth,
    year_routing::{RiverFlow, RiverFlowView},
};
use crate::{
    lattice::TriangularLattice,
    scale::MapScale,
    storage::{Coverage, ReadBand},
    transport::TransportShares,
};
use std::{cell::RefCell, io, rc::Rc};

/// Numerical state lives with the retained rivers, independently of any publication cache.
/// ```compile_fail
/// use atlas_generation::water::Water;
/// fn bypass(water: &mut Water) { water.column.put_snow(0, 10.0); }
/// ```
// owner-direction(2026-11-12): water gets the same intentional paradigms and columnar state as geology and society.
pub struct Water {
    pub(super) mesh: Rc<TriangularLattice>,
    pub(super) scale: MapScale,
    pub(super) column: Rc<RefCell<WaterColumn>>,
    pub(super) ocean: OceanDatum,
    pub(super) groundwater: Groundwater,
    pub(super) melt: Meltwater,
    pub(super) drainage: Drainage,
    pub(super) routing: FlowRouting,
    pub(super) flow: RiverFlow,
    pub(super) projection: RiverProjection,
    pub(super) channels: ChannelGeometry,
    pub(super) warmth: RiverWarmth,
    pub(super) runoff: Runoff,
    pub(super) rivers: ReachStore,
    pub(super) ledger: WaterLedger,
}
pub struct WaterView {
    pub column: WaterColumnView,
    pub groundwater: GroundwaterView,
    pub melt: MeltwaterView,
    pub drainage: DrainageView,
    pub routing: FlowRoutingView,
    pub flow: RiverFlowView,
    pub channels: ChannelView,
    pub runoff: RunoffView,
    pub warmth: ReadBand<f64>,
    pub river_orders: ReadBand<u32>,
    pub flowing_months: ReadBand<u8>,
    pub small_channel_length: ReadBand<f64>,
    pub river_spines: ReadBand<u8>,
    pub effective_sea_level: f64,
    pub base_sea_level: f64,
}
impl Water {
    pub fn new(
        mesh: Rc<TriangularLattice>,
        scale: MapScale,
        coverage: &mut Coverage,
        medium: WaterMedium,
    ) -> Self {
        Self {
            mesh,
            scale,
            column: Rc::new(RefCell::new(WaterColumn::new(coverage, medium))),
            ocean: OceanDatum::default(),
            groundwater: Groundwater::new(coverage),
            melt: Meltwater::new(coverage),
            drainage: Drainage::new(coverage),
            routing: FlowRouting::new(coverage),
            flow: RiverFlow::new(coverage),
            projection: RiverProjection::new(coverage),
            channels: ChannelGeometry::new(coverage),
            warmth: RiverWarmth::new(coverage),
            runoff: Runoff::new(coverage),
            rivers: ReachStore::default(),
            ledger: WaterLedger::default(),
        }
    }
    pub fn read_only(&self) -> WaterView {
        WaterView {
            column: self.column.borrow().read_only(),
            groundwater: self.groundwater.read_only(),
            melt: self.melt.read_only(),
            drainage: self.drainage.read_only(),
            routing: self.routing.read_only(),
            flow: self.flow.read_only(),
            channels: self.channels.read_only(),
            runoff: self.runoff.read_only(),
            warmth: self.warmth.read_only(),
            river_orders: self.projection.orders(),
            flowing_months: self.projection.months(),
            small_channel_length: self.projection.small_channels(),
            river_spines: self.projection.spines(),
            effective_sea_level: self.ocean.effective_level,
            base_sea_level: self.ocean.base_level,
        }
    }
    pub fn rivers(&self) -> &ReachStore {
        &self.rivers
    }
    pub fn river_reader(&self) -> RiverReader<'_> {
        self.rivers.reader()
    }
    pub fn hold_surface(&mut self, cell: usize, surface: f64) -> io::Result<()> {
        self.column.borrow_mut().hold_surface(cell, surface)
    }
    pub fn shoal_bed(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        self.channels.shoal_bed(&mut self.rivers, cell, depth)
    }
    pub fn ledger(&self) -> Vec<Transfer> {
        self.ledger.transfers()
    }
    pub fn account_line(&self) -> String {
        self.ledger.account_line()
    }
    pub fn capture_network(&self) -> RetainedNetwork {
        self.rivers.capture(&self.mesh)
    }
    pub fn restore_network(&mut self, network: &RetainedNetwork) -> io::Result<()> {
        self.rivers
            .restore(network, &self.mesh)
            .map_err(io::Error::other)
    }
    pub fn inherit_column(
        &mut self,
        cell: usize,
        value: CapturedColumn,
        year: [f64; 14],
    ) -> io::Result<()> {
        let mut column = self.column.borrow_mut();
        column.inherit(cell, value)?;
        column.set_year(cell, year)
    }
    pub fn begin_epoch(&mut self) -> io::Result<()> {
        self.melt.begin_epoch()?;
        self.groundwater.begin_epoch()
    }
    pub fn receive_melt(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        self.melt.receive(cell, depth)
    }
    pub fn reconcile_ground(&mut self, cell: usize) -> io::Result<()> {
        self.column.borrow_mut().reconcile(cell)
    }
    /// Ground notifications borrow only the column, even during river or material work.
    pub fn ground_reconciler(&mut self) -> impl FnMut(usize) -> io::Result<()> + use<> {
        let column = Rc::downgrade(&self.column);
        move |cell| {
            let column = column
                .upgrade()
                .ok_or_else(|| io::Error::other("Water column is no longer available"))?;
            column
                .try_borrow_mut()
                .map_err(io::Error::other)?
                .reconcile(cell)?;
            Ok(())
        }
    }
    pub fn carry_ground(
        &mut self,
        shares: &TransportShares,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.column
            .borrow_mut()
            .carry(shares, coverage, |cell| self.mesh.area(cell))?;
        self.rivers.carry_ground(shares, self.mesh.len())
    }
    pub fn remember_lakes(&mut self) -> io::Result<()> {
        self.column.borrow_mut().remember_lakes()
    }
    pub fn forget_lake(&mut self, cell: usize) -> io::Result<()> {
        self.column.borrow_mut().forget_lake(cell)
    }
    pub fn impound(&mut self, cell: usize, body: i32, crest: f64) -> io::Result<()> {
        self.column.borrow_mut().impound(cell, body, crest)
    }
    pub fn lose_soil_water(&mut self, cell: usize, share: f64) -> io::Result<()> {
        self.column.borrow_mut().lose_soil(cell, share)
    }
    pub fn record_marine_connections(&mut self) -> io::Result<()> {
        self.column.borrow_mut().record_marine_connections()
    }
}
