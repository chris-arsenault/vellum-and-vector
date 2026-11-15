//! Groundwater follows hydraulic head and the permeability of the actual substrate.
use super::{
    column::{Store, WaterColumn},
    ledger::{Move, WaterLedger},
};
use crate::{
    lattice::TriangularLattice,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, Coverage, ReadBand},
};
use std::io;
pub fn returned_charge(inventory: f64, available: f64, returned: f64) -> f64 {
    if available > 0.0 {
        inventory.max(0.0) * (returned / available).clamp(0.0, 1.0)
    } else {
        0.0
    }
}
pub fn return_rate(returned: f64, exposure: f64) -> f64 {
    if exposure > 0.0 {
        returned.max(0.0) / exposure
    } else {
        0.0
    }
}
pub struct Balance {
    pub storage: f64,
    pub outflow: f64,
    pub returned: f64,
}
pub fn balance(
    storage: f64,
    recharge: f64,
    capacity: f64,
    drainage: f64,
    marine: bool,
    exposure: f64,
) -> Balance {
    if exposure <= 0.0 {
        return Balance {
            storage,
            outflow: 0.0,
            returned: 0.0,
        };
    }
    let wet = (storage + recharge * exposure).max(0.0);
    if marine {
        return Balance {
            storage: 0.0,
            outflow: wet,
            returned: 0.0,
        };
    }
    let share = -((-drainage.clamp(0.0, 1.0)).ln_1p() * exposure).exp_m1();
    let outflow = wet * share;
    let returned = (wet - outflow - capacity).max(0.0);
    Balance {
        storage: wet - outflow - returned,
        outflow,
        returned,
    }
}
pub struct Groundwater {
    targets: Band<i32>,
    exchange: Band<f64>,
    recharge: Band<f64>,
    outflow: Band<f64>,
    returned: Band<f64>,
    interval: f64,
}
pub struct GroundwaterView {
    pub targets: ReadBand<i32>,
    pub exchange: ReadBand<f64>,
    pub recharge: ReadBand<f64>,
    pub outflow: ReadBand<f64>,
    pub returned: ReadBand<f64>,
    pub interval: f64,
}
pub struct GroundwaterInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub scale: &'a MapScale,
    pub water_kind: &'a ReadBand<u8>,
    pub elevation: &'a ReadBand<f64>,
    pub recharge: &'a ReadBand<f64>,
    pub seepage: &'a ReadBand<f64>,
    pub permeability: &'a dyn Fn(usize) -> io::Result<f64>,
    pub sea_level: f64,
    pub exposure: f64,
}
struct GroundwaterWork {
    head: Band<f64>,
    conductance: Band<f64>,
    arriving: Band<f64>,
}
impl Groundwater {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.band("groundwater-targets", &mut self.targets)?;
        archive.band("groundwater-exchange", &mut self.exchange)?;
        archive.band("groundwater-recharge", &mut self.recharge)?;
        archive.band("groundwater-outflow", &mut self.outflow)?;
        archive.band("groundwater-returned", &mut self.returned)?;
        archive.value("groundwater-interval", &mut self.interval)
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            targets: coverage.allocate(0),
            exchange: coverage.allocate(0.0),
            recharge: coverage.allocate(0.0),
            outflow: coverage.allocate(0.0),
            returned: coverage.allocate(0.0),
            interval: 0.0,
        }
    }
    pub fn read_only(&self) -> GroundwaterView {
        GroundwaterView {
            targets: self.targets.read_only(),
            exchange: self.exchange.read_only(),
            recharge: self.recharge.read_only(),
            outflow: self.outflow.read_only(),
            returned: self.returned.read_only(),
            interval: self.interval,
        }
    }
    pub fn begin_exchange(&mut self, exposure: f64) -> io::Result<()> {
        self.interval = exposure.max(0.0);
        for cell in 0..self.targets.len() {
            self.targets.set(cell, -1)?;
            self.exchange.set(cell, 0.0)?;
            self.recharge.set(cell, 0.0)?;
            self.outflow.set(cell, 0.0)?;
            self.returned.set(cell, 0.0)?;
        }
        Ok(())
    }
    pub fn begin_epoch(&mut self) -> io::Result<()> {
        for cell in 0..self.returned.len() {
            self.returned.set(cell, 0.0)?;
        }
        Ok(())
    }
    pub fn advance(
        &mut self,
        input: GroundwaterInputs<'_>,
        water: &mut WaterColumn,
        ledger: &mut WaterLedger,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.begin_exchange(input.exposure)?;
        if self.interval == 0.0 {
            return Ok(());
        }
        let n = input.mesh.len();
        let mut work = GroundwaterWork {
            conductance: coverage.scratch(n, 0.0),
            head: coverage.scratch(n, 0.0),
            arriving: coverage.scratch(n, 0.0),
        };
        let depth = input
            .scale
            .resolve(RelativeMeasure::length(2.5e-6).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        for cell in 0..n {
            let permeable = (input.permeability)(cell)?.clamp(0.0, 1.0);
            work.conductance.set(cell, permeable)?;
            let marine = input.water_kind.get(cell)? == 1;
            let recharge = if marine {
                0.0
            } else {
                MapScale::metres(
                    input.recharge.get(cell)? + input.seepage.get(cell)?,
                    LengthUnit::Millimetre,
                ) * self.interval
            };
            water.add_groundwater(cell, recharge)?;
            self.recharge.set(cell, recharge)?;
            let height = if marine {
                MapScale::metres(input.sea_level, LengthUnit::Native)
            } else {
                MapScale::metres(input.elevation.get(cell)?, LengthUnit::Native) - depth
                    + water.store(Store::Ground).at(cell)?.held / permeable.max(0.01)
            };
            work.head.set(cell, height)?;
        }
        for cell in 0..n {
            self.route(&input, water, cell, &mut work)?;
        }
        let (mut to_sea, mut sprung) = (0.0, 0.0);
        for cell in 0..n {
            let volume = work.arriving.get(cell)?;
            if input.water_kind.get(cell)? != 1 {
                water.add_groundwater(cell, volume / input.mesh.area(cell))?;
            } else {
                to_sea += volume;
            }
            sprung += self.returned.get(cell)? * input.mesh.area(cell);
        }
        ledger.state(Move::SeepToSea, to_sea / self.interval);
        ledger.state(Move::Spring, sprung / self.interval);
        Ok(())
    }
    fn route(
        &mut self,
        input: &GroundwaterInputs<'_>,
        water: &mut WaterColumn,
        cell: usize,
        work: &mut GroundwaterWork,
    ) -> io::Result<()> {
        let (mut target, mut gradient) = (None, 0.0);
        for edge in 0..3 {
            let Some(next) = input.mesh.neighbor(cell, edge) else {
                continue;
            };
            let slope = (work.head.get(cell)? - work.head.get(next)?)
                / input.mesh.edge_length(cell, edge)
                * work.conductance.get(cell)?.min(work.conductance.get(next)?);
            if slope > gradient {
                target = Some(next);
                gradient = slope;
            }
        }
        let store = water.store(Store::Ground);
        let held = store.at(cell)?;
        self.exchange.set(cell, held.held)?;
        let marine = input.water_kind.get(cell)? == 1;
        let balance = balance(
            held.held,
            0.0,
            held.capacity,
            gradient / (gradient + 0.01),
            marine,
            self.interval,
        );
        if marine {
            target = None;
        }
        self.targets
            .set(cell, target.map_or(-1, |cell| cell as i32))?;
        let outflow = store.give(cell, balance.outflow)?;
        let returned = store.give(cell, balance.returned)?;
        self.outflow.set(cell, outflow)?;
        self.returned
            .set(cell, self.returned.get(cell)? + returned)?;
        if let Some(target) = target {
            work.arriving.set(
                target,
                work.arriving.get(target)? + outflow * input.mesh.area(cell),
            )?;
        }
        Ok(())
    }
}
