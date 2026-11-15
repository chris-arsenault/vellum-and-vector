//! Stage composition follows processes/processRunner.ts: resolve, submit together, then settle.
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, ExecutionError, Query, QueryDependency, QueryValues},
    field::{stage::FieldGround, Field},
    settlement::{stage::Stage, Sharing},
};
use std::io;

#[derive(Clone, Copy)]
pub struct PhysicalContext {
    pub impact_count: Option<f64>,
    pub volcanic_height: Option<f64>,
    pub span: f64,
    pub hydrology_strength: f64,
    pub tectonic_duration_myr: f64,
    pub plate_travel_share: f64,
    pub local_development: Option<bool>,
    pub rainfall_multiplier: f64,
    pub seed: i32,
    pub epoch_stable_seed: i32,
    pub epoch_index: i32,
    pub epoch_count: usize,
    pub tectonic_strength: f64,
    pub glaciation_strength: f64,
    pub coastal_strength: f64,
    pub temperature_offset: f64,
    pub sea_level_offset: f64,
}
impl Default for PhysicalContext {
    fn default() -> Self {
        Self {
            impact_count: None,
            volcanic_height: None,
            span: 1.0,
            hydrology_strength: 1000.0,
            tectonic_duration_myr: crate::tectonics::controls::REFERENCE_MYR,
            plate_travel_share: 1.0,
            local_development: None,
            rainfall_multiplier: 1.0,
            seed: 0,
            epoch_stable_seed: 0,
            epoch_index: -1,
            epoch_count: 0,
            tectonic_strength: 1000.0,
            glaciation_strength: 1000.0,
            coastal_strength: 1000.0,
            temperature_offset: 0.0,
            sea_level_offset: 0.0,
        }
    }
}
pub struct StageWork {
    pub context: PhysicalContext,
    pub span: f64,
    pub substep: usize,
}
pub type FieldStage<'a, 'b> = Stage<'a, FieldGround<'b>>;
type Submit = dyn Fn(&mut FieldStage<'_, '_>, &StageWork, &QueryValues) -> io::Result<()>;
type Substeps = dyn Fn(&PhysicalContext) -> f64;

// Arconis: docs/architecture/subsystems.arconis#item=q_runner — a process run within a group, together or in order.
/// Bodies are only invoked by the dispatched group; callers compose executable references.
pub struct StageProcess {
    id: &'static str,
    dependencies: Vec<QueryDependency<Field>>,
    substeps: Box<Substeps>,
    submit: Box<Submit>,
    prepare: Option<Command<Field, StageWork>>,
}
impl StageProcess {
    pub fn new(
        id: &'static str,
        dependencies: Vec<QueryDependency<Field>>,
        substeps: impl Fn(&PhysicalContext) -> f64 + 'static,
        submit: impl Fn(&mut FieldStage<'_, '_>, &StageWork, &QueryValues) -> io::Result<()> + 'static,
    ) -> Self {
        Self {
            id,
            dependencies,
            substeps: Box::new(substeps),
            submit: Box::new(submit),
            prepare: None,
        }
    }
    pub fn id(&self) -> &str {
        self.id
    }
    pub fn prepared_by(mut self, command: Command<Field, StageWork>) -> Self {
        self.prepare = Some(command);
        self
    }
}

fn substep_count(
    processes: &[StageProcess],
    context: &PhysicalContext,
) -> Result<usize, ExecutionError> {
    let mut count = 1;
    for process in processes {
        let requested = (process.substeps)(context);
        let steps = requested.round().max(1.0);
        if !requested.is_finite() || steps >= usize::MAX as f64 {
            return Err(ExecutionError::Failed(
                "Substep count exceeds numeric representation".into(),
            ));
        }
        count = count.max(steps as usize);
    }
    Ok(count)
}

/// Every participant sees the same starting material, including when their substep counts differ.
pub fn together(
    id: &str,
    processes: Vec<StageProcess>,
    root_hold: Query<Field, AnswerBand>,
) -> Command<Field, PhysicalContext> {
    group(id, processes, root_hold, Sharing::Simultaneous)
}

/// Each process completes all its own substeps before the next one reads the landed geography.
pub fn by(
    id: &str,
    processes: Vec<StageProcess>,
    root_hold: Query<Field, AnswerBand>,
) -> Command<Field, PhysicalContext> {
    let commands: Vec<_> = processes
        .into_iter()
        .map(|process| {
            let name = process.id;
            group(name, vec![process], root_hold.clone(), Sharing::Sequential)
        })
        .collect();
    Command::with_inputs(id, CommandKind::Work, vec![], move |scope, context| {
        for command in &commands {
            scope.run(command, context)?;
        }
        Ok(())
    })
}

fn group(
    id: &str,
    mut processes: Vec<StageProcess>,
    root_hold: Query<Field, AnswerBand>,
    sharing: Sharing,
) -> Command<Field, PhysicalContext> {
    let dependencies = processes
        .iter()
        .flat_map(|process| process.dependencies.clone())
        .collect();
    let rules: Vec<_> = processes.iter().map(|process| process.id).collect();
    let preparations = processes
        .iter_mut()
        .filter_map(|process| process.prepare.take())
        .collect();
    let processes = std::rc::Rc::new(processes);
    let participants = processes.clone();
    let stage = Field::stage_command_with_preparation(
        id,
        CommandKind::Work,
        dependencies,
        sharing,
        crate::field::stage::StagePreparation {
            root_hold: Some(root_hold),
            commands: preparations,
        },
        move |stage, work: &StageWork, values| {
            for process in participants.iter() {
                (process.submit)(stage, work, values)?;
            }
            Ok(())
        },
    );
    Command::with_inputs(
        id,
        CommandKind::Work,
        vec![],
        move |scope, context: &PhysicalContext| {
            if !context.span.is_finite() || context.span < 0.0 {
                return Err(ExecutionError::Failed(format!(
                    "Invalid span for {rules:?}"
                )));
            }
            let count = substep_count(&processes, context)?;
            for substep in 0..count {
                let work = StageWork {
                    context: *context,
                    span: context.span / count as f64,
                    substep,
                };
                scope.batch(|scope| {
                    scope.run_with_context(&stage, &work, std::rc::Rc::new(*context))
                })?;
            }
            Ok(())
        },
    )
}

pub(super) fn io_error(error: ExecutionError) -> io::Error {
    io::Error::other(format!("{error:?}"))
}
pub(super) fn require_passes(passes: f64) -> io::Result<()> {
    if !passes.is_finite() || passes <= 0.0 {
        return Err(io::Error::other(
            "Regional execution needs a positive number of passes",
        ));
    }
    Ok(())
}
