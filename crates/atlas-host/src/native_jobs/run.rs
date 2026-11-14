use super::{poisoned, Action, Event, Job, PreviewAsset, Settings};
use crate::{
    generation_output::Observations,
    generation_submission::Submission,
    generation_world::CreateWorld,
    native_control::NativeControl,
    native_generation_job::{NativeJob, Services},
    private_inputs::PrivateInputs,
};
use atlas_generation::{
    atlas::{
        history::{Diagnostic, GenerationEpoch},
        preview::Preview,
    },
    execution::ExecutionResult,
    GenerationState,
};
use atlas_gis::postgres_maps::PostgresMaps;
use serde_json::json;
use std::{io, rc::Rc};

// owner-direction(2026-11-12): computation uses one Rust core for native and WASM
pub(super) fn run(action: Action, settings: Settings, job: Job) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        execute(action, settings, &job)
    }))
    .unwrap_or_else(|_| Err(io::Error::other("Generation worker panicked")));
    let _ = job.update(|status| match result {
        Ok(reference) => {
            status.state = GenerationState::Completed;
            status.step = "Map published".into();
            status.progress = Some(1.0);
            status.result = Some(reference);
        }
        Err(error) => {
            status.state = if job.token.is_cancelled() {
                GenerationState::Cancelled
            } else {
                GenerationState::Failed
            };
            status.message = Some(error.to_string());
        }
    });
}
fn execute(action: Action, settings: Settings, job: &Job) -> io::Result<atlas_map::MapRef> {
    let mut maps = PostgresMaps::connect(&settings.database_url)?;
    let inputs = PrivateInputs::connect(&settings.generation_url)?;
    let operation = job.status()?.job_id;
    let request = prepare(action, &maps, &inputs, operation)?;
    let reporting = job.clone();
    let control = NativeControl::new(job.token.clone(), move |progress| {
        let _ = reporting.update(|status| {
            status.step = progress.message.clone();
            status.progress = Some(progress.fraction);
        });
    });
    let reporting = job.clone();
    let progress = Rc::new(move |fraction: f64, message: &str| {
        let _ = reporting.update(|status| {
            status.step = message.into();
            status.progress = Some(fraction);
        });
    });
    futures::executor::block_on(request.run(
        Services {
            maps: &mut maps,
            inputs: &inputs,
            resources: settings.resources,
            scratch: settings.scratch,
            assets: settings.assets,
            memory: settings.memory,
            published: &|reference| {
                job.state
                    .lock()
                    .map_err(poisoned)?
                    .events
                    .push(Event::Published {
                        reference: reference.clone(),
                    });
                Ok(())
            },
        },
        &control,
        Observer {
            job: job.clone(),
            epoch: 0,
        },
        progress,
    ))
}
pub(super) fn prepare(
    action: Action,
    maps: &PostgresMaps,
    inputs: &PrivateInputs,
    operation: String,
) -> io::Result<NativeJob> {
    let (configuration, source, expected, parent, selection, document, area) = match action {
        Action::Create(configuration) => {
            let input = configuration.input("new")?;
            let document = CreateWorld {
                id: configuration
                    .world_id
                    .clone()
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                name: configuration.name.clone(),
                seed: input.seed,
                width: configuration.width,
                height: configuration.height,
                settings: input.settings,
                boundary_mode: None,
            }
            .create()?;
            let area = document.scope.located.area_id.clone();
            (configuration, None, None, None, None, document, area)
        }
        Action::Regenerate {
            reference,
            configuration,
        } => {
            let map = maps.open(&reference)?;
            let document = inputs.document(&reference)?;
            (
                configuration,
                Some(reference.clone()),
                Some(reference.clone()),
                map.parent,
                None,
                document,
                reference.map_id,
            )
        }
        Action::Refine(request) => {
            let parent = request.selection.parent.clone();
            let document = inputs.document(&parent)?;
            let area = uuid::Uuid::new_v4().to_string();
            let name = request.configuration.name.clone();
            (
                request.configuration,
                Some(parent.clone()),
                None,
                Some(parent),
                Some((request.selection, name)),
                document,
                area,
            )
        }
    };
    Ok(NativeJob {
        submission: Submission {
            source: document,
            input: configuration.input(&area)?,
        },
        source,
        expected,
        parent,
        operation,
        selection,
    })
}
struct Observer {
    job: Job,
    epoch: usize,
}
impl Observations for Observer {
    fn diagnostic(&mut self, diagnostic: &Diagnostic) -> ExecutionResult<()> {
        self.job.update(|status| {
            status.message = Some(serde_json::to_string(diagnostic).unwrap_or_default())
        })?;
        Ok(())
    }
    async fn preview(
        &mut self,
        preview: &Preview,
        ancestry: Option<&[GenerationEpoch]>,
    ) -> ExecutionResult<()> {
        let bytes = serde_json::to_vec(&json!({"grid":preview,"ancestry":ancestry}))
            .map_err(io::Error::other)?;
        let mut state = self.job.state.lock().map_err(poisoned)?;
        let job_id = state.status.job_id.clone();
        state.events.push(Event::Preview {
            job_id,
            epoch: self.epoch,
            map: PreviewAsset {
                media_type: "application/vnd.atlas.preview+json".into(),
                bytes,
            },
        });
        self.epoch += 1;
        Ok(())
    }
}
