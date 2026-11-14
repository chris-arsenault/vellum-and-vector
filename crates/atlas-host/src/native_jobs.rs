//! In-memory jobs for the LAN service. Completed maps persist; running jobs do not restart.
mod review;
mod run;
use crate::generation_application::{Choice, Configuration};
use atlas_generation::{
    control::CancellationToken, storage::MemoryBudget, GenerationState, GenerationStatus,
    RefinementRequest,
};
use atlas_gis::map_files::MapFiles;
use atlas_map::MapRef;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

#[derive(Clone)]
pub struct Settings {
    pub database_url: String,
    pub generation_url: String,
    pub resources: PathBuf,
    pub scratch: PathBuf,
    pub assets: MapFiles,
    pub memory: Arc<MemoryBudget>,
}
#[derive(Deserialize)]
#[serde(tag = "method", content = "request", rename_all = "camelCase")]
pub enum Call {
    Jobs,
    Configurations,
    Presentation,
    Choose(Choice),
    Configuration(MapRef),
    Review(Action),
    Validate(Configuration),
    Create(Configuration),
    Refine(RefinementRequest<Configuration>),
    Regenerate {
        reference: MapRef,
        configuration: Configuration,
    },
    Status {
        job_id: String,
    },
    Cancel {
        job_id: String,
    },
    Observe {
        job_id: String,
        after: usize,
    },
}
#[derive(Deserialize)]
#[serde(tag = "method", content = "request", rename_all = "camelCase")]
pub enum Action {
    Create(Configuration),
    Refine(RefinementRequest<Configuration>),
    Regenerate {
        reference: MapRef,
        configuration: Configuration,
    },
}
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Event {
    Published {
        reference: MapRef,
    },
    Status {
        status: GenerationStatus,
    },
    Preview {
        #[serde(rename = "jobId")]
        job_id: String,
        epoch: usize,
        map: PreviewAsset,
    },
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAsset {
    pub media_type: String,
    pub bytes: Vec<u8>,
}
pub(super) struct State {
    status: GenerationStatus,
    events: Vec<Event>,
}
#[derive(Clone)]
pub(super) struct Job {
    state: Arc<Mutex<State>>,
    token: CancellationToken,
}
impl Job {
    fn status(&self) -> io::Result<GenerationStatus> {
        Ok(self.state.lock().map_err(poisoned)?.status.clone())
    }
    fn update(&self, change: impl FnOnce(&mut GenerationStatus)) -> io::Result<()> {
        let mut state = self.state.lock().map_err(poisoned)?;
        change(&mut state.status);
        let status = state.status.clone();
        state.events.push(Event::Status { status });
        Ok(())
    }
}
pub struct Jobs {
    settings: Settings,
    jobs: Mutex<BTreeMap<String, Job>>,
}
impl Jobs {
    pub fn new(settings: Settings) -> Self {
        Self {
            settings,
            jobs: Mutex::new(BTreeMap::new()),
        }
    }
    pub fn call(&self, call: Call) -> io::Result<Value> {
        match call {
            Call::Jobs => Ok(json!(self
                .jobs
                .lock()
                .map_err(poisoned)?
                .values()
                .map(Job::status)
                .collect::<io::Result<Vec<_>>>()?)),
            Call::Configurations => Ok(
                json!([{"id":"atlas","title":"Atlas","values":Configuration::default_configuration()?}]),
            ),
            Call::Validate(value) => Ok(json!(value.normalize()?)),
            Call::Presentation => Ok(serde_json::from_str(
                &crate::generation_application::generation_presentation(),
            )?),
            Call::Choose(choice) => Ok(json!(choice.apply()?)),
            Call::Configuration(reference) => review::configuration(&self.settings, &reference),
            Call::Review(action) => review::review(&self.settings, action),
            Call::Create(value) => Ok(json!(self.start(Action::Create(value.normalize()?))?)),
            Call::Refine(mut request) => {
                request.configuration = request.configuration.normalize()?;
                Ok(json!(self.start(Action::Refine(request))?))
            }
            Call::Regenerate {
                reference,
                configuration,
            } => Ok(json!(self.start(Action::Regenerate {
                reference,
                configuration: configuration.normalize()?,
            })?)),
            Call::Status { job_id } => Ok(json!(self.job(&job_id)?.status()?)),
            Call::Cancel { job_id } => {
                let job = self.job(&job_id)?;
                if job.status()?.state == GenerationState::Running {
                    job.token.cancel();
                }
                Ok(json!(job.status()?))
            }
            Call::Observe { job_id, after } => {
                let job = self.job(&job_id)?;
                let state = job.state.lock().map_err(poisoned)?;
                if after > state.events.len() {
                    return Err(io::Error::other("Unknown generation event cursor"));
                }
                Ok(
                    json!({"events":state.events[after..],"next":state.events.len(),"status":state.status}),
                )
            }
        }
    }
    fn job(&self, id: &str) -> io::Result<Job> {
        self.jobs
            .lock()
            .map_err(poisoned)?
            .get(id)
            .cloned()
            .ok_or_else(|| io::Error::other("Generation job was not found"))
    }
    fn start(&self, action: Action) -> io::Result<GenerationStatus> {
        let id = uuid::Uuid::new_v4().to_string();
        let status = GenerationStatus {
            job_id: id.clone(),
            state: GenerationState::Running,
            step: "Preparing map".into(),
            progress: None,
            result: None,
            message: None,
        };
        let job = Job {
            state: Arc::new(Mutex::new(State {
                status: status.clone(),
                events: vec![Event::Status {
                    status: status.clone(),
                }],
            })),
            token: CancellationToken::default(),
        };
        let settings = self.settings.clone();
        let worker = job.clone();
        thread::Builder::new()
            .name(format!("atlas-generation-{id}"))
            .spawn(move || run::run(action, settings, worker))?;
        self.jobs.lock().map_err(poisoned)?.insert(id, job);
        Ok(status)
    }
}
fn poisoned<T>(_: std::sync::PoisonError<T>) -> io::Error {
    io::Error::other("Generation job state lock was poisoned")
}
