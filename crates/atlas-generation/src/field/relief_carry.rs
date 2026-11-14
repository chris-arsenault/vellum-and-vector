//! Place surviving ground and collision packages from world/reliefCarry.ts.
use super::{shared::CellCode, Field};
use crate::{
    lattice::TriangularLattice,
    rock::ground::{
        crust::{collision_area_shares, ARC_CRUST_YIELD},
        remap::GroundRemapper,
        transport::HeldRock,
        GroundField,
    },
    storage::{Band, Coverage},
    transport::{
        plan::TransportPlan, GroundArrivals, HistoryTransport, TRANSPORT_WEIGHT_SCALE as SCALE,
    },
};
use std::io;
pub(super) struct ReliefCarry {
    held: HeldRock,
    continental: Band<u8>,
}
struct Retained {
    continental: Band<f64>,
    oceanic: Band<f64>,
}
impl Retained {
    fn share(&self, carry: &ReliefCarry, source: usize, target: usize) -> io::Result<f64> {
        if carry.continental.get(source)? != 0 {
            self.continental.get(target)
        } else {
            self.oceanic.get(target)
        }
    }
}
fn area_weight(
    mesh: &TriangularLattice,
    plan: &HistoryTransport,
    source: usize,
    at: usize,
    target: usize,
) -> io::Result<f64> {
    Ok(plan.shares.weights.get(at)? * mesh.area(source) / (SCALE * mesh.area(target)))
}
fn retained(
    field: &mut Field,
    plan: &HistoryTransport,
    carry: &ReliefCarry,
) -> io::Result<Retained> {
    let coverage = field.coverage.get_mut();
    let mut work = Retained {
        continental: coverage.allocate(0.0),
        oceanic: coverage.allocate(1.0),
    };
    for source in 0..field.mesh.len() {
        if carry.continental.get(source)? == 0 {
            continue;
        }
        for at in plan.shares.offsets.get(source)?..plan.shares.offsets.get(source + 1)? {
            let target = plan.shares.targets.get(at as usize)?;
            if target < 0 || field.mesh.area(target as usize) <= 0.0 {
                continue;
            }
            let target = target as usize;
            let weight = area_weight(&field.mesh, plan, source, at as usize, target)?;
            work.continental
                .set(target, work.continental.get(target)? + weight)?;
        }
    }
    for target in 0..field.mesh.len() {
        let total = plan.arrivals.get(target)? / SCALE;
        if field
            .shared
            .code(CellCode::TectonicBoundaryCodes)
            .get(target)?
            == 1
            && total > 1.0
        {
            let land = work.continental.get(target)?;
            let [land, sea] = collision_area_shares(land, total - land);
            work.continental.set(target, land)?;
            work.oceanic.set(target, sea)?;
        } else {
            work.continental.set(target, 1.0)?;
        }
    }
    Ok(work)
}
struct Arrivals {
    offsets: Band<u32>,
    sources: Band<u32>,
    weights: Band<f64>,
}
impl Arrivals {
    fn view(&self) -> GroundArrivals {
        GroundArrivals {
            offsets: self.offsets.read_only(),
            sources: self.sources.read_only(),
            weights: self.weights.read_only(),
        }
    }
}
fn ground_arrivals(
    mesh: &TriangularLattice,
    coverage: &mut Coverage,
    plan: &HistoryTransport,
    carry: &ReliefCarry,
    work: &Retained,
) -> io::Result<Arrivals> {
    let mut offsets = coverage.scratch(mesh.len() + 1, 0u32);
    for source in 0..mesh.len() {
        for at in plan.shares.offsets.get(source)?..plan.shares.offsets.get(source + 1)? {
            let target = plan.shares.targets.get(at as usize)?;
            if target >= 0
                && mesh.area(target as usize) > 0.0
                && work.share(carry, source, target as usize)?
                    * plan.shares.weights.get(at as usize)?
                    > 0.0
            {
                let index = target as usize + 1;
                offsets.set(
                    index,
                    offsets.get(index)?.checked_add(1).ok_or_else(|| {
                        io::Error::other("Ground arrival count exceeds representation")
                    })?,
                )?;
            }
        }
    }
    for cell in 1..=mesh.len() {
        offsets.set(
            cell,
            offsets
                .get(cell)?
                .checked_add(offsets.get(cell - 1)?)
                .ok_or_else(|| io::Error::other("Ground arrival offsets exceed representation"))?,
        )?;
    }
    let length = offsets.get(mesh.len())? as usize;
    let mut sources = coverage.scratch(length, 0u32);
    let mut weights = coverage.scratch(length, 0.0);
    let mut cursor = coverage.copy_band(&offsets)?;
    for source in 0..mesh.len() {
        for at in plan.shares.offsets.get(source)?..plan.shares.offsets.get(source + 1)? {
            let target = plan.shares.targets.get(at as usize)?;
            if target < 0 || mesh.area(target as usize) <= 0.0 {
                continue;
            }
            let target = target as usize;
            let weight = area_weight(mesh, plan, source, at as usize, target)?
                * work.share(carry, source, target)?;
            if weight <= 0.0 {
                continue;
            }
            let index = cursor.get(target)?;
            sources.set(
                index as usize,
                u32::try_from(source).map_err(io::Error::other)?,
            )?;
            weights.set(index as usize, weight)?;
            cursor.set(target, index + 1)?;
        }
    }
    Ok(Arrivals {
        offsets,
        sources,
        weights,
    })
}
impl Field {
    pub(super) fn begin_relief_carry(&mut self) -> io::Result<ReliefCarry> {
        let ground = self.ground.try_borrow().map_err(io::Error::other)?;
        let coverage = self.coverage.get_mut();
        let held = ground.hold(coverage)?;
        let mut continental = coverage.allocate(0u8);
        for source in 0..self.mesh.len() {
            let thickness = ground.view(GroundField::CrustThickness).get(source)?;
            let column = ground.continental_thickness(source)?;
            continental.set(source, u8::from(column >= (thickness - column).max(0.0)))?;
        }
        Ok(ReliefCarry { held, continental })
    }
    pub(super) fn finish_relief_carry(
        &mut self,
        carry: ReliefCarry,
        transport: &TransportPlan,
    ) -> io::Result<()> {
        let plan = transport.history();
        let work = retained(self, &plan, &carry)?;
        let arrivals = ground_arrivals(&self.mesh, self.coverage.get_mut(), &plan, &carry, &work)?;
        let deformation = transport.deformation();
        let mut ground = self.ground.try_borrow_mut().map_err(io::Error::other)?;
        let mut remap = GroundRemapper::new(
            &mut ground,
            &carry.held,
            &deformation,
            self.coverage.get_mut(),
        )?;
        let view = arrivals.view();
        for cell in 0..self.mesh.len() {
            if arrivals.offsets.get(cell)? == arrivals.offsets.get(cell + 1)? {
                remap.form_opening(cell)?;
            } else {
                remap.place(cell, &view)?;
            }
        }
        drop(remap);
        for source in 0..self.mesh.len() {
            let returned = if carry.continental.get(source)? != 0 {
                1.0
            } else {
                ARC_CRUST_YIELD
            };
            let f = deformation.at(source)?;
            for at in plan.shares.offsets.get(source)?..plan.shares.offsets.get(source + 1)? {
                let target = plan.shares.targets.get(at as usize)?;
                if target < 0 || self.mesh.area(target as usize) <= 0.0 {
                    continue;
                }
                let target = target as usize;
                let excess = 1.0 - work.share(&carry, source, target)?;
                if excess > 0.0 {
                    ground.land_collision(
                        &carry.held,
                        target,
                        source,
                        area_weight(&self.mesh, &plan, source, at as usize, target)?
                            * excess
                            * returned,
                        f,
                    )?;
                }
            }
        }
        Ok(())
    }
}
