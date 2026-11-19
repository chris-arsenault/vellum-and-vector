//! Durable LAN jobs. Interrupted work waits for an explicit resume request.
mod contexts;
mod retention;
mod review;
mod run;
use crate::generation_application::{Choice, Configuration};
use atlas_generation::{
    control::CancellationToken, storage::MemoryBudget, GenerationDetails, GenerationState,
    GenerationStatus, RefinementRequest,
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
    time::Instant,
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
    Resume {
        job_id: String,
    },
    Observe {
        job_id: String,
        after: usize,
    },
}
#[derive(Serialize, Deserialize)]
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
        status: Box<GenerationStatus>,
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
    /// One byte string: a mature city's preview is tens of megabytes.
    #[serde(serialize_with = "byte_string")]
    pub bytes: Vec<u8>,
}
fn byte_string<S: serde::Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_bytes(bytes)
}
/// A generation call's reply. Observed events are sent as they are, so their preview bytes
/// stay one byte string instead of becoming a list of numbers.
#[derive(Serialize)]
#[serde(untagged)]
pub enum Reply {
    Value(Value),
    Observed {
        events: Vec<Event>,
        next: usize,
        status: Box<GenerationStatus>,
    },
}
pub(super) struct State {
    status: GenerationStatus,
    events: Vec<Event>,
}
#[derive(Clone)]
pub(super) struct Job {
    state: Arc<Mutex<State>>,
    token: CancellationToken,
    started: Instant,
    elapsed_before: f64,
    files: crate::job_files::JobFiles,
}
impl Job {
    fn status(&self) -> io::Result<GenerationStatus> {
        let mut status = self.state.lock().map_err(poisoned)?.status.clone();
        if status.state == GenerationState::Running {
            if let Some(details) = &mut status.details {
                details.elapsed_seconds =
                    self.elapsed_before + self.started.elapsed().as_secs_f64();
            }
        }
        if !matches!(
            status.state,
            GenerationState::Running | GenerationState::Completed
        ) {
            status.recovery = Some(match self.files.checkpoint() {
                Ok(checkpoint) => {
                    if let (Some(c), Some(details)) = (&checkpoint, &mut status.details) {
                        details.elapsed_seconds = details.elapsed_seconds.max(c.elapsed_seconds);
                    }
                    atlas_generation::RecoveryStatus {
                        checkpoint: checkpoint.map(|c| c.point.label()),
                        problem: None,
                    }
                }
                Err(error) => atlas_generation::RecoveryStatus {
                    checkpoint: None,
                    problem: Some(error.to_string()),
                },
            });
        }
        Ok(status)
    }
    fn update(&self, change: impl FnOnce(&mut GenerationStatus)) -> io::Result<()> {
        let mut state = self.state.lock().map_err(poisoned)?;
        change(&mut state.status);
        if let Some(details) = &mut state.status.details {
            details.elapsed_seconds = self.elapsed_before + self.started.elapsed().as_secs_f64();
        }
        let status = state.status.clone();
        state.events.push(Event::Status {
            status: Box::new(status),
        });
        Ok(())
    }
}
pub struct Jobs {
    settings: Settings,
    jobs: Mutex<BTreeMap<String, Job>>,
}
impl Jobs {
    pub fn new(settings: Settings) -> io::Result<Self> {
        let jobs = retention::load(&settings.resources.join(".jobs"))?;
        Ok(Self {
            settings,
            jobs: Mutex::new(jobs),
        })
    }
    pub fn call(&self, call: Call) -> io::Result<Reply> {
        if let Call::Observe { job_id, after } = call {
            let job = self.job(&job_id)?;
            let state = job.state.lock().map_err(poisoned)?;
            if after > state.events.len() {
                return Err(io::Error::other("Unknown generation event cursor"));
            }
            let events = state.events[after..].to_vec();
            let next = state.events.len();
            drop(state);
            return Ok(Reply::Observed {
                events,
                next,
                status: Box::new(job.status()?),
            });
        }
        self.answer(call).map(Reply::Value)
    }
    fn answer(&self, call: Call) -> io::Result<Value> {
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
            Call::Resume { job_id } => Ok(json!(self.resume(&job_id)?)),
            Call::Cancel { job_id } => {
                let job = self.job(&job_id)?;
                if job.status()?.state == GenerationState::Running {
                    job.token.cancel();
                }
                Ok(json!(job.status()?))
            }
            Call::Observe { .. } => Err(io::Error::other("Observation replies are typed")),
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
    fn start(&self, mut action: Action) -> io::Result<GenerationStatus> {
        let mut jobs = self.jobs.lock().map_err(poisoned)?;
        let id = uuid::Uuid::new_v4().to_string();
        if let Action::Create(configuration) = &mut action {
            configuration
                .world_id
                .get_or_insert_with(|| uuid::Uuid::new_v4().to_string());
        }
        let files = crate::job_files::JobFiles::new(&self.settings.resources.join(".jobs"), &id)?;
        files.write("action.json", &action)?;
        let status = GenerationStatus {
            job_id: id.clone(),
            state: GenerationState::Running,
            step: "Preparing map".into(),
            progress: None,
            result: None,
            message: None,
            details: Some(action.details()),
            recovery: None,
        };
        files.write("status.json", &status)?;
        let job = Job {
            state: Arc::new(Mutex::new(State {
                status: status.clone(),
                events: vec![Event::Status {
                    status: Box::new(status.clone()),
                }],
            })),
            token: CancellationToken::default(),
            started: Instant::now(),
            elapsed_before: 0.0,
            files,
        };
        let settings = self.settings.clone();
        let worker = job.clone();
        thread::Builder::new()
            .name(format!("atlas-generation-{id}"))
            .spawn(move || run::run(action, settings, worker))?;
        jobs.insert(id, job);
        Ok(status)
    }
}
impl Action {
    fn details(&self) -> GenerationDetails {
        let (name, parent) = match self {
            Self::Create(configuration) => (&configuration.name, None),
            Self::Refine(request) => (
                &request.configuration.name,
                Some(request.selection.parent.clone()),
            ),
            // The regenerated map, as the browser host records it; a map takes one job at a time.
            Self::Regenerate {
                configuration,
                reference,
            } => (&configuration.name, Some(reference.clone())),
        };
        GenerationDetails {
            name: name.clone(),
            parent,
            started_at: chrono::Utc::now().to_rfc3339(),
            finished_at: None,
            elapsed_seconds: 0.0,
            epochs: Vec::new(),
        }
    }
}
fn poisoned<T>(_: std::sync::PoisonError<T>) -> io::Error {
    io::Error::other("Generation job state lock was poisoned")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_observed_preview_is_sent_as_one_byte_string() {
        let reply = Reply::Observed {
            events: vec![Event::Preview {
                job_id: "job".into(),
                epoch: 0,
                map: PreviewAsset {
                    media_type: "application/json".into(),
                    bytes: b"{}".to_vec(),
                },
            }],
            next: 1,
            status: Box::new(GenerationStatus {
                job_id: "job".into(),
                state: GenerationState::Running,
                step: String::new(),
                progress: None,
                result: None,
                message: None,
                details: None,
                recovery: None,
            }),
        };
        let mut encoded = Vec::new();
        ciborium::into_writer(&reply, &mut encoded).unwrap();
        let value: ciborium::Value = ciborium::from_reader(encoded.as_slice()).unwrap();
        let field = |value: &ciborium::Value, name: &str| {
            value
                .as_map()
                .and_then(|m| m.iter().find(|(k, _)| k.as_text() == Some(name)))
                .map(|(_, v)| v.clone())
                .unwrap()
        };
        let event = field(&value, "events").as_array().unwrap()[0].clone();
        assert_eq!(
            field(&field(&event, "map"), "bytes"),
            ciborium::Value::Bytes(b"{}".to_vec())
        );
        assert_eq!(field(&value, "next"), ciborium::Value::Integer(1.into()));
    }
}
