//! Shared preparation, process execution and completed-document construction.
use crate::{
    generation_bindings::{Bindings, Input},
    generation_document::{Finished, Preparation, Records as DocumentRecords},
    generation_output::{Observations, Publication},
    generation_request::{Host, PreparedRequest},
    generation_submission::Submission,
    numerical_output::Sink,
    numerical_resource::Store,
    record_store::Workspace,
};
use atlas_generation::{
    atlas::{
        dispatch::experiment::Experiment, regional::work::Progress, state::Records,
        workflow::Output, world::Sources,
    },
    control::GenerationControl,
    spatial::SpatialKernel,
    storage::SharedCache,
};
use std::{collections::BTreeMap, io, rc::Rc};

pub struct Services<'a> {
    pub resources: Rc<dyn Store>,
    pub spatial: Rc<dyn SpatialKernel>,
    pub cache: SharedCache,
    pub records: &'a Workspace,
    pub progress: Progress,
    pub completed_at: fn() -> String,
    pub recovery: Option<&'a mut dyn atlas_generation::checkpoint::Recovery>,
    pub experiment: Option<Experiment>,
}

impl Services<'_> {
    fn host(&self, prepared: &PreparedRequest) -> Host {
        let records = self.records;
        Host {
            resources: self.resources.clone(),
            cache: self.cache.clone(),
            spatial: self.spatial.clone(),
            progress: self.progress.clone(),
            records: Records {
                features: Box::new(records.features()),
                source_features: Some(Box::new(records.source_features())),
                networks: Box::new(records.networks()),
                retained_names: BTreeMap::new(),
            },
            original: Sources {
                features: Rc::new(records.source_features()),
                networks: Rc::new(records.source_networks()),
                contracted: prepared.request.crossed_features.clone(),
            },
        }
    }
    fn prepare(&self, submission: &Submission) -> io::Result<PreparedRequest> {
        submission
            .request(self.spatial.as_ref())?
            .resolve(self.spatial.as_ref(), self.resources.as_ref())
    }
}

pub async fn run_selected(
    submission: &Submission,
    mut services: Services<'_>,
    control: &impl GenerationControl,
    output: &mut impl Output,
) -> io::Result<()> {
    let prepared = services.prepare(submission)?;
    let host = services.host(&prepared);
    services.records.begin_execution()?;
    prepared
        .prepare_experiment(host, services.experiment.take())
        .map_err(execution_error)?
        .run(control, output, None)
        .await
        .map_err(execution_error)?;
    Ok(())
}

fn execution_error(error: atlas_generation::execution::ExecutionError) -> io::Error {
    io::Error::other(format!("{error:?}"))
}

// Arconis: docs/architecture/subsystems.arconis#item=j_run — the one generation core both hosts call.
pub async fn run(
    submission: Submission,
    operation: &str,
    services: Services<'_>,
    control: &impl GenerationControl,
    observations: impl Observations,
    sink: &mut impl Sink,
) -> io::Result<Finished> {
    let prepared = services.prepare(&submission)?;
    let host = services.host(&prepared);
    let Services {
        spatial,
        records,
        completed_at,
        recovery,
        experiment,
        ..
    } = services;
    let input = Input {
        operation_id: operation.into(),
        seed: submission.input.seed,
        scope: prepared.geography.scope.clone(),
        precision: prepared.geography.frame.scope.precision,
        fields: serde_json::from_value(submission.source.world["fields"].clone())?,
    };
    let document = Preparation::new(submission.source, &prepared)?;
    let (bindings, plan) = Bindings::new(input, &prepared)?;
    records.begin_execution()?;
    let mut output = Publication {
        plan,
        bindings,
        sink,
        control,
        observations,
        result: None,
    };
    prepared
        .prepare_experiment(host, experiment)
        .map_err(execution_error)?
        .run(control, &mut output, recovery)
        .await
        .map_err(execution_error)?;
    let result = output
        .result
        .ok_or_else(|| io::Error::other("Generation did not complete publication"))?;
    document.finish(
        result,
        operation,
        &completed_at(),
        DocumentRecords {
            features: &mut records.features(),
            original: &records.source_features(),
            networks: &mut records.networks(),
            source_networks: &records.source_networks(),
        },
        spatial.as_ref(),
    )
}
