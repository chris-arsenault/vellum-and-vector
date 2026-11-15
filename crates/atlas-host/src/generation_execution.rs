//! Shared preparation, process execution and completed-document construction.
use crate::{
    generation_bindings::{Bindings, Input},
    generation_document::{Finished, Preparation, Records as DocumentRecords},
    generation_output::{Observations, Publication},
    generation_request::Host,
    generation_submission::Submission,
    numerical_output::Sink,
    numerical_resource::Store,
    record_store::Workspace,
};
use atlas_generation::{
    atlas::{regional::work::Progress, state::Records, world::Sources},
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
    let Services {
        resources,
        spatial,
        cache,
        records,
        progress,
        completed_at,
    } = services;
    let prepared = submission
        .request(spatial.as_ref())?
        .resolve(spatial.as_ref(), resources.as_ref())?;
    let input = Input {
        operation_id: operation.into(),
        seed: submission.input.seed,
        scope: prepared.geography.scope.clone(),
        precision: prepared.geography.frame.scope.precision,
        fields: serde_json::from_value(submission.source.world["fields"].clone())?,
    };
    let document = Preparation::new(submission.source, &prepared)?;
    let (bindings, plan) = Bindings::new(input, &prepared)?;
    let host = Host {
        resources,
        cache,
        spatial: spatial.clone(),
        progress,
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
    };
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
        .prepare(host)
        .map_err(|e| io::Error::other(format!("{e:?}")))?
        .run(control, &mut output)
        .await
        .map_err(|e| io::Error::other(format!("{e:?}")))?;
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
