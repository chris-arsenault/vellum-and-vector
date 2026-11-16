//! Crust columns travel by represented area, with explicit subduction and continental roots.
use super::{Ground, GroundField as F};
use crate::{
    scale::MapScale,
    storage::{Band, Coverage, ReadBand},
    transport::{TransportShares, TRANSPORT_WEIGHT_SCALE},
};
use std::io;
pub struct CapturedCrust {
    continental: Band<f64>,
    oceanic: Band<f64>,
    reserve: Band<f64>,
}
struct Arrived {
    columns: CapturedCrust,
    land: Band<f64>,
}
pub struct CrustTransport<'a> {
    pub shares: &'a TransportShares,
    pub arrivals: &'a ReadBand<f64>,
    pub boundaries: &'a ReadBand<i32>,
}
/// The overriding continent keeps its area when it meets ocean; continents shorten each other.
pub fn collision_area_shares(land: f64, sea: f64) -> [f64; 2] {
    [
        if land > 1.0 { 1.0 / land } else { 1.0 },
        if sea > 0.0 {
            ((1.0 - land).max(0.0) / sea).min(1.0)
        } else {
            1.0
        },
    ]
}
/// Share of a subducting ocean slab that rises as new arc crust.
pub const ARC_CRUST_YIELD: f64 = 0.5;
pub type CrustReceiver<'a> = dyn FnMut(usize, f64, f64) -> io::Result<()> + 'a;
impl Ground {
    pub fn continental_thickness(&self, cell: usize) -> io::Result<f64> {
        if self.crust_initialized {
            self.get(F::CrustContinentalColumn, cell)
        } else {
            Ok(
                self.get(F::CrustThickness, cell)? * self.get(F::CrustContinentalFraction, cell)?
                    / 1000.0,
            )
        }
    }
    pub fn accrue_root_reserve(&mut self, cell: usize, amount: f64) -> io::Result<()> {
        self.set(
            F::CrustRootReserve,
            cell,
            (self.get(F::CrustRootReserve, cell)? + amount).max(0.0),
        )
    }
    pub fn spend_root_reserve(&mut self, cell: usize, amount: f64) -> io::Result<f64> {
        let spent = self.get(F::CrustRootReserve, cell)?.min(amount.max(0.0));
        self.add(F::CrustRootReserve, cell, -spent)?;
        Ok(spent)
    }
    pub fn retain_root_reserve(&mut self, cell: usize, fraction: f64) -> io::Result<()> {
        self.set(
            F::CrustRootReserve,
            cell,
            self.get(F::CrustRootReserve, cell)? * fraction.clamp(0.0, 1.0),
        )
    }
    pub fn mark_seam(&mut self, cell: usize) -> io::Result<()> {
        self.set(F::CrustProvinceSeam, cell, 1.0)
    }
    pub fn record_suture(&mut self, cell: usize, pair: i32, strength: f64) -> io::Result<()> {
        self.set(F::CrustSuturePairIds, cell, f64::from(pair))?;
        self.set(F::CrustSutureStrength, cell, strength)
    }
    pub fn initialize_continental_affinity(
        &mut self,
        cell: usize,
        affinity: f64,
    ) -> io::Result<()> {
        self.set(F::CrustContinentalFraction, cell, affinity)
    }
    pub fn capture_crust(&mut self, coverage: &mut Coverage) -> io::Result<CapturedCrust> {
        self.initialize_crust()?;
        let mut oceanic = coverage.allocate(0.0);
        for cell in 0..self.mesh.len() {
            oceanic.set(
                cell,
                (self.get(F::CrustThickness, cell)? - self.get(F::CrustContinentalColumn, cell)?)
                    .max(0.0),
            )?;
        }
        Ok(CapturedCrust {
            continental: coverage
                .copy_band(&self.storage.bands[F::CrustContinentalColumn as usize])?,
            oceanic,
            reserve: coverage.copy_band(&self.storage.bands[F::CrustRootReserve as usize])?,
        })
    }
    fn accumulate_crust(
        &mut self,
        plan: &TransportShares,
        old: &CapturedCrust,
        coverage: &mut Coverage,
    ) -> io::Result<Arrived> {
        let mut result = Arrived {
            columns: CapturedCrust {
                continental: coverage.allocate(0.0),
                oceanic: coverage.allocate(0.0),
                reserve: coverage.allocate(0.0),
            },
            land: coverage.allocate(0.0),
        };
        for source in 0..self.mesh.len() {
            let amounts = [
                old.continental.get(source)?,
                old.oceanic.get(source)?,
                old.reserve.get(source)?,
            ];
            let mut retained = 0.0;
            for offset in plan.offsets.get(source)?..plan.offsets.get(source + 1)? {
                let target = usize::try_from(plan.targets.get(offset as usize)?)
                    .map_err(io::Error::other)?;
                let share = plan.weights.get(offset as usize)? / TRANSPORT_WEIGHT_SCALE;
                result.add(
                    target,
                    amounts,
                    share * self.mesh.area(source) / self.mesh.area(target),
                )?;
                retained += share;
            }
            // Ground arriving from beyond the edge rides this row but is not this cell's own.
            let inflow = plan.inflow.get(source)?;
            let exported_area = self.volume(source, (1.0 - (retained - inflow)).max(0.0));
            self.crust_budget.continental_exported += (amounts[0] + amounts[2]) * exported_area;
            self.crust_budget.ocean_exported += amounts[1] * exported_area;
            let imported_area = self.volume(source, inflow);
            self.crust_budget.continental_imported += (amounts[0] + amounts[2]) * imported_area;
            self.crust_budget.ocean_imported += amounts[1] * imported_area;
        }
        Ok(result)
    }
    pub fn transport_crust(
        &mut self,
        plan: &CrustTransport<'_>,
        old: &CapturedCrust,
        coverage: &mut Coverage,
        receive: &mut CrustReceiver<'_>,
    ) -> io::Result<()> {
        let columns = self.accumulate_crust(plan.shares, old, coverage)?;
        for cell in 0..self.mesh.len() {
            self.retain_crust(cell, plan, &columns, receive)?;
        }
        Ok(())
    }
    fn retain_crust(
        &mut self,
        cell: usize,
        plan: &CrustTransport<'_>,
        columns: &Arrived,
        receive: &mut CrustReceiver<'_>,
    ) -> io::Result<()> {
        let mut continental = columns.columns.continental.get(cell)?;
        let mut oceanic = columns.columns.oceanic.get(cell)?;
        let arrival = plan.arrivals.get(cell)? / TRANSPORT_WEIGHT_SCALE;
        let fresh = (1.0 - arrival).max(0.0) * MapScale::native(self.relative_length(0.00025)?);
        oceanic += fresh;
        self.crust_budget.ocean_created += self.volume(cell, fresh);
        let [slab, squeezed] = if plan.boundaries.get(cell)? == 1 && arrival > 1.0 {
            closure(columns.land.get(cell)?, arrival, continental, oceanic)
        } else {
            [0.0; 2]
        };
        let consumed = oceanic.min(slab);
        let shortened = squeezed + slab - consumed;
        let arc = consumed * ARC_CRUST_YIELD;
        let reserve = shortened + arc;
        oceanic -= consumed;
        continental -= shortened;
        self.crust_budget.ocean_consumed += self.volume(cell, consumed);
        self.crust_budget.continental_adjustment += self.volume(cell, arc);
        self.set(
            F::CrustRootReserve,
            cell,
            columns.columns.reserve.get(cell)? + reserve,
        )?;
        self.set(F::CrustContinentalColumn, cell, continental)?;
        self.set(F::CrustThickness, cell, continental + oceanic)?;
        self.refresh_crust_fraction(cell)?;
        receive(cell, consumed, reserve)
    }
    pub fn add_continental_root(&mut self, cell: usize, column: f64) -> io::Result<()> {
        self.add(F::CrustThickness, cell, column)?;
        self.add(F::CrustContinentalColumn, cell, column)?;
        self.refresh_crust_fraction(cell)
    }
    pub(super) fn refresh_crust_fraction(&mut self, cell: usize) -> io::Result<()> {
        let thickness = self.get(F::CrustThickness, cell)?;
        let fraction = if thickness > 0.0 {
            (self.get(F::CrustContinentalColumn, cell)? / thickness).clamp(0.0, 1.0)
        } else {
            0.0
        };
        self.set(
            F::CrustContinentalFraction,
            cell,
            (fraction * 1000.0).round(),
        )
    }
}
impl Arrived {
    fn add(
        &mut self,
        cell: usize,
        [continental, oceanic, reserve]: [f64; 3],
        weight: f64,
    ) -> io::Result<()> {
        for (band, amount) in [
            (&mut self.columns.continental, continental),
            (&mut self.columns.oceanic, oceanic),
            (&mut self.columns.reserve, reserve),
        ] {
            band.set(cell, band.get(cell)? + amount * weight)?;
        }
        if continental >= oceanic {
            self.land.set(cell, self.land.get(cell)? + weight)?;
        }
        Ok(())
    }
}
fn closure(land: f64, arrival: f64, continental: f64, oceanic: f64) -> [f64; 2] {
    let sea = arrival - land;
    let [continent_kept, ocean_kept] = collision_area_shares(land, sea);
    [
        if sea > 0.0 {
            oceanic * (1.0 - ocean_kept)
        } else {
            oceanic
        },
        continental * (1.0 - continent_kept),
    ]
}
