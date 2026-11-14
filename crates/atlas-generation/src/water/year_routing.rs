//! The complete mean and seasonal routing pass, consuming current owner answers once per pass.
use super::{
    balance::{flow_through_year, MONTHS},
    ledger::{depth_rate_to_discharge, Move, WaterLedger, SECONDS_PER_YEAR},
    reaches::ReachStore,
};
use crate::{
    flow_graph::{gather_down, target_order},
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Passage {
    pub passed: f64,
    pub bed: f64,
    pub drawn: f64,
}
pub struct RoutingInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub targets: &'a ReadBand<i32>,
    pub water_kind: &'a ReadBand<u8>,
    pub surface_water: &'a ReadBand<f64>,
    pub runoff: &'a ReadBand<f64>,
    pub meltwater: &'a ReadBand<f64>,
    pub year: &'a [ReadBand<f64>; MONTHS],
    pub lake_outlets: &'a ReadBand<i32>,
    pub lake_overflow: &'a ReadBand<f64>,
    pub lake_evaporation: f64,
    pub lake_seepage: f64,
    pub lake_infiltration_loss: f64,
    pub passage: &'a dyn Fn(usize, f64) -> io::Result<Passage>,
}
pub struct RiverFlow {
    pub(super) mean: Band<f64>,
    pub(super) flood: Band<f64>,
    pub(super) perennial: Band<f64>,
    pub(super) flowing_months: Band<f64>,
    pub(super) catchment: Band<f64>,
    pub(super) seepage: Band<f64>,
}
pub struct RiverFlowView {
    pub mean: ReadBand<f64>,
    pub flood: ReadBand<f64>,
    pub perennial: ReadBand<f64>,
    pub flowing_months: ReadBand<f64>,
    pub catchment: ReadBand<f64>,
    pub seepage: ReadBand<f64>,
}
pub struct RoutedYear {
    pub order: Band<u32>,
    pub monthly: [Band<f64>; MONTHS],
}
pub struct BoundaryRivers {
    pub incoming: Band<f64>,
    pub catchment: Band<f64>,
    pub monthly: [Band<f64>; MONTHS],
}
impl BoundaryRivers {
    pub fn new(store: &ReachStore, coverage: &mut Coverage) -> io::Result<Option<Self>> {
        if store.entries().is_empty() {
            return Ok(None);
        }
        let n = coverage.len();
        let mut result = Self {
            incoming: coverage.scratch(n, 0.0),
            catchment: coverage.scratch(n, 0.0),
            monthly: std::array::from_fn(|_| coverage.scratch(n, 0.0)),
        };
        for entry in store.entries() {
            let cell = entry.cell;
            result.incoming.set(
                cell,
                result.incoming.get(cell)? + flow_through_year(&entry.monthly, 0.0).mean,
            )?;
            result
                .catchment
                .set(cell, result.catchment.get(cell)? + entry.catchment)?;
            for (band, value) in result.monthly.iter_mut().zip(entry.monthly) {
                band.set(cell, band.get(cell)? + value)?;
            }
        }
        Ok(Some(result))
    }
}
impl RiverFlow {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            mean: coverage.allocate(0.0),
            flood: coverage.allocate(0.0),
            perennial: coverage.allocate(0.0),
            flowing_months: coverage.allocate(0.0),
            catchment: coverage.allocate(0.0),
            seepage: coverage.allocate(0.0),
        }
    }
    pub fn read_only(&self) -> RiverFlowView {
        RiverFlowView {
            mean: self.mean.read_only(),
            flood: self.flood.read_only(),
            perennial: self.perennial.read_only(),
            flowing_months: self.flowing_months.read_only(),
            catchment: self.catchment.read_only(),
            seepage: self.seepage.read_only(),
        }
    }
    pub fn route(
        &mut self,
        input: &RoutingInputs<'_>,
        store: &ReachStore,
        ledger: &mut WaterLedger,
        coverage: &mut Coverage,
    ) -> io::Result<RoutedYear> {
        let boundary = BoundaryRivers::new(store, coverage)?;
        self.route_with_boundary(input, boundary.as_ref(), ledger, coverage)
    }
    pub(super) fn route_with_boundary(
        &mut self,
        input: &RoutingInputs<'_>,
        boundary: Option<&BoundaryRivers>,
        ledger: &mut WaterLedger,
        coverage: &mut Coverage,
    ) -> io::Result<RoutedYear> {
        let order = target_order(coverage, input.targets)?;
        self.gather_catchments(input, &order, boundary)?;
        self.gather_mean(input, &order, boundary, ledger)?;
        let monthly = self.seasonal(input, &order, boundary, coverage)?;
        Ok(RoutedYear { order, monthly })
    }
    fn gather_catchments(
        &mut self,
        input: &RoutingInputs<'_>,
        order: &Band<u32>,
        boundary: Option<&BoundaryRivers>,
    ) -> io::Result<()> {
        for cell in 0..input.mesh.len() {
            let beyond = match boundary {
                Some(boundary) => boundary.catchment.get(cell)?.max(0.0),
                None => 0.0,
            };
            self.catchment.set(cell, input.mesh.area(cell) + beyond)?;
        }
        gather_down(
            &order.read_only(),
            input.targets,
            &mut self.catchment,
            |_, amount| Ok(amount),
        )
    }
    fn gather_mean(
        &mut self,
        input: &RoutingInputs<'_>,
        order: &Band<u32>,
        boundary: Option<&BoundaryRivers>,
        ledger: &mut WaterLedger,
    ) -> io::Result<()> {
        let (mut entering, mut melt) = (0.0, 0.0);
        for cell in 0..input.mesh.len() {
            let brought = match boundary {
                Some(boundary) => boundary.incoming.get(cell)?,
                None => 0.0,
            };
            self.mean.set(
                cell,
                depth_rate_to_discharge(input.surface_water.get(cell)?, input.mesh.area(cell))
                    + brought,
            )?;
            entering += brought;
            if input.water_kind.get(cell)? != 1 {
                melt += depth_rate_to_discharge(input.meltwater.get(cell)?, input.mesh.area(cell));
            }
            self.seepage.set(cell, 0.0)?;
        }
        ledger.flow(Move::Entering, entering);
        ledger.flow(Move::IceMelt, melt);
        let mut left = [0.0; 7];
        gather_down(
            &order.read_only(),
            input.targets,
            &mut self.mean,
            |cell, received| {
                let parts = (input.passage)(cell, received)?;
                left[0] += parts.bed;
                left[1] += parts.drawn;
                self.seepage.set(
                    cell,
                    parts.bed * SECONDS_PER_YEAR * 1000.0 / input.mesh.area(cell),
                )?;
                let mut flow = parts.passed;
                if input.lake_outlets.get(cell)? >= 0 {
                    left[2] += flow;
                    flow = flow.min(input.lake_overflow.get(cell)?);
                    left[3] += flow;
                }
                if input.water_kind.get(cell)? != 1 {
                    if let Some(end) = end_of(input, cell)? {
                        left[end] += flow;
                    }
                }
                Ok(flow)
            },
        )?;
        for (move_, flow) in [
            Move::BedLoss,
            Move::Withdrawal,
            Move::Inflow,
            Move::Spill,
            Move::Mouth,
            Move::Leaving,
            Move::Pan,
        ]
        .into_iter()
        .zip(left)
        {
            ledger.flow(move_, flow);
        }
        self.lake_losses(input, (left[2] - left[3]).max(0.0), ledger)
    }
    fn lake_losses(
        &mut self,
        input: &RoutingInputs<'_>,
        kept: f64,
        ledger: &mut WaterLedger,
    ) -> io::Result<()> {
        let whole = input.lake_evaporation + input.lake_seepage;
        ledger.flow(
            Move::LakeEvaporation,
            if whole > 0.0 {
                kept * input.lake_evaporation / whole
            } else {
                kept
            },
        );
        ledger.flow(
            Move::LakeSeepage,
            if whole > 0.0 {
                kept * input.lake_seepage / whole
            } else {
                0.0
            },
        );
        for cell in 0..input.mesh.len() {
            if input.water_kind.get(cell)? == 2 && whole > 0.0 {
                self.seepage.set(
                    cell,
                    self.seepage.get(cell)? + input.lake_infiltration_loss * kept / whole,
                )?;
            }
        }
        Ok(())
    }
    fn seasonal(
        &mut self,
        input: &RoutingInputs<'_>,
        order: &Band<u32>,
        boundary: Option<&BoundaryRivers>,
        coverage: &mut Coverage,
    ) -> io::Result<[Band<f64>; MONTHS]> {
        let n = input.mesh.len();
        let mut flow = coverage.scratch(n, 0.0);
        let mut monthly: [Band<f64>; MONTHS] = std::array::from_fn(|_| coverage.scratch(n, 0.0));
        for cell in 0..n {
            self.flood.set(cell, 0.0)?;
            self.perennial.set(cell, f64::INFINITY)?;
            self.flowing_months.set(cell, 0.0)?;
        }
        for (month, carried) in monthly.iter_mut().enumerate() {
            for cell in 0..n {
                let entering = match boundary {
                    Some(boundary) => boundary.monthly[month].get(cell)?,
                    None => 0.0,
                };
                let supply = (input.surface_water.get(cell)? - input.runoff.get(cell)?).max(0.0)
                    + input.year[month].get(cell)? * MONTHS as f64;
                flow.set(
                    cell,
                    depth_rate_to_discharge(supply, input.mesh.area(cell)) + entering,
                )?;
            }
            gather_down(
                &order.read_only(),
                input.targets,
                &mut flow,
                |cell, received| {
                    let value = if input.lake_outlets.get(cell)? >= 0 {
                        self.mean.get(cell)?
                    } else {
                        (input.passage)(cell, received)?.passed
                    };
                    carried.set(cell, value)?;
                    self.flood.set(cell, self.flood.get(cell)?.max(value))?;
                    self.perennial
                        .set(cell, self.perennial.get(cell)?.min(value))?;
                    Ok(value)
                },
            )?;
        }
        for cell in 0..n {
            if !self.perennial.get(cell)?.is_finite() {
                self.perennial.set(cell, 0.0)?;
            }
        }
        Ok(monthly)
    }
}
fn end_of(input: &RoutingInputs<'_>, cell: usize) -> io::Result<Option<usize>> {
    if let Ok(target) = usize::try_from(input.targets.get(cell)?) {
        return Ok((input.water_kind.get(target)? == 1).then_some(4));
    }
    if input.mesh.boundary(cell) {
        return Ok(Some(5));
    }
    Ok(Some(if input.water_kind.get(cell)? == 2 {
        2
    } else {
        6
    }))
}
pub fn channel_origins(
    mesh: &TriangularLattice,
    order: &ReadBand<u32>,
    targets: &ReadBand<i32>,
    captured: &ReadBand<f64>,
    coverage: &mut Coverage,
) -> io::Result<Vec<u8>> {
    let mut length = coverage.scratch(mesh.len(), 0.0);
    for cell in 0..mesh.len() {
        length.set(cell, captured.get(cell)?)?;
    }
    gather_down(order, targets, &mut length, |_, value| Ok(value))?;
    (0..mesh.len())
        .map(|cell| {
            Ok(match usize::try_from(targets.get(cell)?) {
                Ok(next) => u8::from(length.get(cell)? >= mesh.physical_distance(cell, next)),
                Err(_) => 0,
            })
        })
        .collect()
}
