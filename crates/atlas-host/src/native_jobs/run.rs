use super::{poisoned, Action, Event, Job, Settings};
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

/// A retained epoch preview: the preview grid and, at an epoch's end, its ancestry.
#[derive(serde::Serialize)]
struct RetainedPreview<'a> {
    grid: &'a Preview,
    ancestry: Option<&'a [GenerationEpoch]>,
}
// owner-direction(2026-11-12): computation uses one Rust core for native and WASM
pub(super) fn run(action: Action, settings: Settings, job: Job) {
    log(&job, "started");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        execute(action, settings, &job)
    }))
    .unwrap_or_else(|_| Err(io::Error::other("Generation worker panicked")));
    let _ = job.update(|status| {
        if let Some(details) = &mut status.details {
            details.finished_at = Some(chrono::Utc::now().to_rfc3339());
        }
        match result {
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
        }
    });
    if let Err(error) = job.status().and_then(|status| {
        job.files.write("status.json", &status)?;
        if status.state == GenerationState::Completed {
            crate::context_files::retire_job_inputs(&job.files)?;
        }
        Ok(())
    }) {
        eprintln!("Failed to retain generation job status: {error}");
    }
    log(&job, "stopped");
}
// owner-direction(2026-11-15): high-level generation logs include start, stop and duration
fn log(job: &Job, event: &str) {
    if let Ok(status) = job.status() {
        eprintln!(
            "{}",
            json!({"event":format!("generation.{event}"),"jobId":status.job_id,
            "state":status.state,"details":status.details,"message":status.message})
        );
    }
}
fn execute(action: Action, settings: Settings, job: &Job) -> io::Result<atlas_map::MapRef> {
    let mut maps = PostgresMaps::connect(&settings.database_url)?;
    let inputs = PrivateInputs::connect(&settings.generation_url)?;
    // A job's id is the identity text the service handed out; the map revision takes it.
    let operation = job.status()?.job_id.parse().map_err(io::Error::other)?;
    // A run numbers its epochs from the start; previews of an earlier run do not carry over.
    job.files.remove_previews()?;
    let request = match job.files.read::<NativeJob>("request.json")? {
        Some(request) => request,
        None => {
            let request = prepare(action, &maps, &inputs, operation)?;
            job.files.write("request.json", &request)?;
            request
        }
    };
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
            previous_epoch_seconds: 0.0,
        },
        progress,
    ))
}
pub(super) fn prepare(
    action: Action,
    maps: &PostgresMaps,
    inputs: &PrivateInputs,
    operation: atlas_map::Id,
) -> io::Result<NativeJob> {
    let (configuration, source, expected, parent, selection, document, area) = match action {
        Action::Create(configuration) => {
            let input = configuration.input(atlas_map::Id::NIL)?;
            let document = CreateWorld {
                id: configuration
                    .world_id
                    .unwrap_or_else(crate::generation_world::random_id),
                name: configuration.name.clone(),
                seed: input.seed,
                width: configuration.width,
                height: configuration.height,
                settings: input.settings,
                boundary_mode: None,
            }
            .create()?;
            let area = document.scope.located.area_id;
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
            let area = crate::generation_world::random_id();
            let name = request.configuration.name.clone();
            (
                request.configuration,
                Some(parent.clone()),
                None,
                Some(parent),
                Some(crate::regional_capture::Child {
                    selection: request.selection,
                    name,
                    real_scale: request.real_scale,
                }),
                document,
                area,
            )
        }
    };
    Ok(NativeJob {
        submission: Submission {
            source: document,
            input: configuration.input(area)?,
        },
        source,
        expected,
        parent,
        operation,
        creates_child: selection.is_some(),
        selection,
    })
}
struct Observer {
    job: Job,
    epoch: usize,
    previous_epoch_seconds: f64,
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
        if let Some(ancestry) = ancestry {
            let elapsed = self.job.started.elapsed().as_secs_f64();
            let name = ancestry
                .iter()
                .map(|epoch| epoch.id.as_str())
                .collect::<Vec<_>>()
                .join(" / ");
            let seconds = elapsed - self.previous_epoch_seconds;
            self.previous_epoch_seconds = elapsed;
            self.job.update(|status| {
                if let Some(details) = &mut status.details {
                    details.epochs.push(atlas_generation::EpochDuration {
                        name: name.clone(),
                        seconds,
                    });
                }
            })?;
            if let Err(error) = self
                .job
                .status()
                .and_then(|status| self.job.files.write("status.json", &status))
            {
                eprintln!("Failed to retain epoch timing: {error}");
            }
            eprintln!(
                "{}",
                json!({"event":"generation.epoch.completed","jobId":self.job.status()?.job_id,"epoch":name,"seconds":seconds})
            );
        }
        // The preview goes to a retained file; the event only names it, so the job's event
        // list does not grow with the town.
        self.job.files.write_preview(
            self.epoch,
            &RetainedPreview {
                grid: preview,
                ancestry,
            },
        )?;
        let mut state = self.job.state.lock().map_err(poisoned)?;
        let job_id = state.status.job_id.clone();
        state.events.push(Event::Preview {
            job_id,
            epoch: self.epoch,
            media_type: super::PREVIEW_MEDIA_TYPE.into(),
        });
        self.epoch += 1;
        Ok(())
    }
}
