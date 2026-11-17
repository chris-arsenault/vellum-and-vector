//! Plate intervals carry actual ground before selected deformation runs on each arrival.
mod geometry;
use super::events::EventKind;
use super::{
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionError, ExecutionResult},
    hpc::BitSet,
    processes::runner::PhysicalContext,
    spatial::SpatialKernel,
    tectonics::{controls::plate_travel, fracture::Plume, integration},
    transport::{
        carriers::Carriers,
        plan::{self, TransportPlan},
        HistoryTransport,
    },
};
use std::{io, rc::Rc};

pub struct Operations {
    pub province_layout: Command<Field, i32>,
    pub after_step: Option<Command<Field, PhysicalContext>>,
    pub during_step: Option<Command<Field, PhysicalContext>>,
}
struct Advection {
    kernel: Rc<dyn SpatialKernel>,
    drift_per_myr: f64,
    operations: Operations,
    history: Command<Field, HistoryTransport>,
}
fn failure(error: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
impl Field {
    pub fn plate_advection(
        kernel: Rc<dyn SpatialKernel>,
        drift_per_myr: f64,
        operations: Operations,
        carriers: Carriers<Self>,
    ) -> Command<Self, PhysicalContext> {
        let work = Advection {
            kernel,
            drift_per_myr,
            operations,
            history: Self::transport_history(carriers),
        };
        Command::with_inputs(
            "plate-advection",
            CommandKind::Work,
            vec![],
            move |scope, context| work.run(scope, context),
        )
    }
    pub fn accumulated_plate_drift(&self) -> f64 {
        self.accumulated_plate_drift
    }
    pub fn transport_plan(&self) -> Option<&TransportPlan> {
        self.transport_plan.as_ref()
    }
    pub fn landmark_ledger(&self) -> &[super::landmark_ledger::LandmarkRecord] {
        &self.landmark_ledger
    }
    fn begin_advection(&mut self, total: f64) -> io::Result<()> {
        self.crust_formed = true;
        self.last_plate_drift_step = total;
        for cell in 0..self.mesh.len() {
            self.shared
                .code_mut(C::AdvectionSourceIndex)
                .set(cell, -1)?;
            for field in [
                S::ConvergentCrustSurplus,
                S::OrogenicConstruction,
                S::OceanicSubduction,
            ] {
                self.shared.scalar_mut(field).set(cell, 0.0)?;
            }
        }
        Ok(())
    }
    fn move_landmark_drainage(&mut self, plan: &TransportPlan) -> io::Result<()> {
        let dominant = plan.history().shares.dominant;
        let mut previous = BitSet::new(self.mesh.len());
        for record in &mut self.landmark_ledger {
            previous.clear_all();
            for &cell in &record.corridor {
                previous.add(cell as usize);
            }
            record.corridor.clear();
            for cell in 0..self.mesh.len() {
                let source = dominant.get(cell)?;
                if source >= 0 && previous.has(source as usize) {
                    record.corridor.push(cell as u32);
                }
            }
        }
        Ok(())
    }
    fn complete_motion(&mut self, myr: f64, distance: f64) -> Result<(), String> {
        let plumes: Vec<_> = self
            .events
            .iter()
            .filter(|event| event.kind == EventKind::Plume)
            .map(|event| Plume {
                position: [event.x, event.y],
                radius: event.radius,
                strength: event.strength,
            })
            .collect();
        let state = self
            .tectonics
            .as_mut()
            .ok_or("Plate interval lost its tectonic state")?;
        integration::complete(
            &self.mesh,
            self.scale,
            state,
            integration::Interval { myr, distance },
            &plumes,
            |_| {},
        )?;
        for cell in 0..self.mesh.len() {
            if self
                .shared
                .scalar(S::CrustRiftStrain)
                .get(cell)
                .map_err(|e| e.to_string())?
                > 0.0
            {
                let age = self.shared.scalar_mut(S::CrustRiftAgeMyr);
                age.set(cell, age.get(cell).map_err(|e| e.to_string())? + myr)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}
impl Advection {
    fn deform(
        &self,
        scope: &mut CommandContext<'_, Field>,
        context: &PhysicalContext,
        myr: f64,
        distance: f64,
    ) -> ExecutionResult<()> {
        let field = scope.state_mut();
        let carry = field.begin_relief_carry().map_err(failure)?;
        for cell in 0..field.mesh.len() {
            field
                .shared
                .scalar_mut(S::ConvergentCrustSurplus)
                .set(cell, 0.0)
                .map_err(failure)?;
        }
        geometry::advect(field, self.kernel.as_ref(), distance).map_err(failure)?;
        let plan = plan::build(
            &field.mesh,
            &field.shared,
            field.tectonics.as_ref(),
            field.coverage.get_mut(),
            distance,
        )
        .map_err(failure)?;
        field.transport_plan = None;
        field.move_landmark_drainage(&plan).map_err(failure)?;
        scope.run(&self.history, &plan.history())?;
        let field = scope.state_mut();
        let dominant = plan.history().shares.dominant;
        for cell in 0..field.mesh.len() {
            field
                .shared
                .code_mut(C::AdvectionSourceIndex)
                .set(cell, dominant.get(cell).map_err(failure)?)
                .map_err(failure)?;
        }
        field.finish_relief_carry(carry, &plan).map_err(failure)?;
        field.transport_plan = Some(plan);
        if let Some(after) = &self.operations.after_step {
            scope.run(after, context)?;
        }
        let interval = PhysicalContext {
            tectonic_duration_myr: myr,
            span: context.span * myr / context.tectonic_duration_myr,
            ..*context
        };
        scope.state_mut().last_plate_drift_step = distance;
        if let Some(during) = &self.operations.during_step {
            scope.run_with_context(during, &interval, Rc::new(interval))?;
        }
        Ok(())
    }
    fn run(
        &self,
        scope: &mut CommandContext<'_, Field>,
        context: &PhysicalContext,
    ) -> ExecutionResult<()> {
        let total = plate_travel(
            self.drift_per_myr,
            context.tectonic_duration_myr,
            context.plate_travel_share,
        );
        let rate = total / context.tectonic_duration_myr.max(1e-9);
        scope.state_mut().begin_advection(total).map_err(failure)?;
        if total <= 0.0 {
            return Ok(());
        }
        if scope.state().tectonics.is_none() {
            self.deform(scope, context, context.tectonic_duration_myr, total)?;
            scope.state_mut().accumulated_plate_drift += total;
            return Ok(());
        }
        let field = scope.state_mut();
        field.tectonics.as_mut().unwrap().rate = rate;
        let mut surplus = field.coverage.get_mut().allocate(0.0);
        let mut remaining = context.tectonic_duration_myr;
        while remaining > 1e-9 {
            let field = scope.state_mut();
            let state = field.tectonics.as_mut().unwrap();
            let myr =
                integration::interval(field.scale, state, remaining, rate).map_err(failure)?;
            let distance = rate * myr;
            integration::prepare(&field.mesh, field.scale, self.kernel.as_ref(), state, myr)
                .map_err(failure)?;
            scope.run(&self.operations.province_layout, &context.seed)?;
            self.deform(scope, context, myr, distance)?;
            let field = scope.state_mut();
            for cell in 0..field.mesh.len() {
                surplus
                    .set(
                        cell,
                        surplus.get(cell).map_err(failure)?
                            + field
                                .shared
                                .scalar(S::ConvergentCrustSurplus)
                                .get(cell)
                                .map_err(failure)?,
                    )
                    .map_err(failure)?;
            }
            field.complete_motion(myr, distance).map_err(failure)?;
            remaining -= myr;
        }
        let field = scope.state_mut();
        field.last_plate_drift_step = total;
        for cell in 0..field.mesh.len() {
            field
                .shared
                .scalar_mut(S::ConvergentCrustSurplus)
                .set(cell, surplus.get(cell).map_err(failure)?)
                .map_err(failure)?;
        }
        scope.run(&self.operations.province_layout, &context.seed)?;
        scope.state_mut().accumulated_plate_drift += total;
        Ok(())
    }
}
