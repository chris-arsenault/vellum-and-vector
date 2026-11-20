pub use super::operations::Operations;
use super::{
    catalogue::{Landmark, Measures},
    magic::Scene,
    placement::{place, realized, Placed, Tracking},
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionError, ExecutionResult},
    field::{
        events::{Event, EventKind},
        landmark_ledger::LandmarkRecord,
        Field,
    },
    spatial::SpatialKernel,
    tectonics::fracture::Plume,
};
use std::{io, rc::Rc};
pub struct Work {
    pub landmark: Landmark,
    pub epoch: usize,
    pub drift: Vec<f64>,
    pub plumes: Vec<Plume>,
    pub scene: Scene,
}
fn failed(e: io::Error) -> ExecutionError {
    ExecutionError::Failed(e.to_string())
}
fn ensure(
    context: &mut CommandContext<'_, Field>,
    placed: &Placed<'_>,
    ops: &Operations,
    scene: &Scene,
) -> ExecutionResult<usize> {
    if let Some(at) = context
        .state()
        .landmark_ledger
        .iter()
        .position(|r| r.id == placed.landmark.id)
    {
        return Ok(at);
    }
    let record = LandmarkRecord {
        id: placed.landmark.id,
        kind: placed.landmark.kind.id().into(),
        realized: realized(context.state(), placed),
        emplaced_at_epoch: placed.landmark.emplaced_at_epoch,
        target: Measures::new(),
        measured: Measures::new(),
        maintenance: 0.0,
        strength: None,
        capture: None,
        corridor: vec![],
        notes: vec![],
    };
    let at = context.state().landmark_ledger.len();
    context.state_mut().landmark_ledger.push(record);
    let measured = ops.measure(context, placed, scene)?;
    let target = placed
        .landmark
        .kind
        .parameters()
        .into_iter()
        .filter(|p| !p.advisory && measured.contains_key(p.key))
        .map(|p| (p.key.to_owned(), placed.landmark.parameters[p.key]))
        .collect();
    context.state_mut().landmark_ledger[at].target = target;
    Ok(at)
}
pub fn shortfalls(record: &LandmarkRecord, measured: &Measures) -> Measures {
    record
        .target
        .iter()
        .filter_map(|(key, &target)| {
            let value = measured.get(key).copied().unwrap_or(f64::NAN);
            (!value.is_finite() || value < target - 0.01).then(|| {
                (
                    key.clone(),
                    target - if value.is_nan() { 0.0 } else { value },
                )
            })
        })
        .collect()
}
impl Operations {
    pub fn emplacement(self: Rc<Self>, kernel: Rc<dyn SpatialKernel>) -> Command<Field, Work> {
        Command::with_inputs(
            "landmark.emplace",
            CommandKind::Event,
            vec![],
            move |context, work: &Work| {
                let tracking = Tracking {
                    drift: &work.drift,
                    epoch: work.epoch,
                    plumes: &work.plumes,
                    kernel: kernel.as_ref(),
                };
                let Some(placed) =
                    place(context.state(), &work.landmark, Some(&tracking)).map_err(failed)?
                else {
                    return Ok(());
                };
                let at = ensure(context, &placed, &self, &work.scene)?;
                self.apply(context, &placed, work.epoch as i32, &work.scene, None)?;
                context.state_mut().events.push(Event {
                    id: format!("landmark:{}", work.landmark.id),
                    kind: EventKind::Landmark,
                    x: placed.center[0],
                    y: placed.center[1],
                    radius: work.landmark.kind.reach(&work.landmark.parameters),
                    epoch: work.epoch as i32,
                    strength: 1000.0,
                    caldera: None,
                });
                self.capture(context, &placed, false)?;
                let measured = self.measure(context, &placed, &work.scene)?;
                let record = &mut context.state_mut().landmark_ledger[at];
                record.measured = measured;
                if !record.realized {
                    record.note("Below this mesh's resolution: causes written at cell scale, signature latent.");
                }
                Ok(())
            },
        )
    }
    pub fn maintenance(self: Rc<Self>, kernel: Rc<dyn SpatialKernel>) -> Command<Field, Work> {
        Command::with_inputs(
            "landmark.maintain",
            CommandKind::Event,
            vec![],
            move |context, work: &Work| {
                let tracking = Tracking {
                    drift: &work.drift,
                    epoch: work.epoch,
                    plumes: &work.plumes,
                    kernel: kernel.as_ref(),
                };
                let Some(placed) =
                    place(context.state(), &work.landmark, Some(&tracking)).map_err(failed)?
                else {
                    return Ok(());
                };
                let at = ensure(context, &placed, &self, &work.scene)?;
                let holds = context.state().landmark_ledger[at].realized
                    || work.landmark.kind.system().is_some();
                if holds {
                    self.capture(context, &placed, true)?;
                }
                let measured = self.measure(context, &placed, &work.scene)?;
                let missing = shortfalls(&context.state().landmark_ledger[at], &measured);
                if holds && !missing.is_empty() {
                    self.apply(
                        context,
                        &placed,
                        work.epoch as i32,
                        &work.scene,
                        Some(&missing),
                    )?;
                }
                let measured = self.measure(context, &placed, &work.scene)?;
                context.state_mut().landmark_ledger[at].measured = measured;
                Ok(())
            },
        )
    }
    pub fn remeasure(self: Rc<Self>) -> Command<Field, Work> {
        Command::with_inputs(
            "landmark.remeasure",
            CommandKind::Publish,
            vec![],
            move |context, work: &Work| {
                let Some(at) = context
                    .state()
                    .landmark_ledger
                    .iter()
                    .position(|r| r.id == work.landmark.id)
                else {
                    return Ok(());
                };
                let Some(placed) = place(context.state(), &work.landmark, None).map_err(failed)?
                else {
                    return Ok(());
                };
                let measured = self.measure(context, &placed, &work.scene)?;
                context.state_mut().landmark_ledger[at].measured = measured;
                Ok(())
            },
        )
    }
}
