use super::{poisoned, Action, Event, Job, Jobs, State};
use crate::job_files::JobFiles;
use atlas_generation::{control::CancellationToken, GenerationState, GenerationStatus};
use std::{
    collections::BTreeMap,
    fs, io,
    path::Path,
    sync::{Arc, Mutex},
    time::Instant,
};

pub(super) fn load(root: &Path) -> io::Result<BTreeMap<String, Job>> {
    fs::create_dir_all(root)?;
    let mut jobs = BTreeMap::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let files = JobFiles::new(root, &id)?;
        let mut status: GenerationStatus = match files.read("status.json") {
            Ok(Some(status)) => status,
            result => GenerationStatus {
                job_id: id.clone(),
                state: GenerationState::Failed,
                step: "Unreadable saved job".into(),
                progress: None,
                result: None,
                details: None,
                recovery: None,
                message: Some(match result {
                    Err(error) => error.to_string(),
                    _ => "Job metadata is incomplete".into(),
                }),
            },
        };
        if status.state == GenerationState::Running {
            status.state = GenerationState::Interrupted;
            status.step = "Interrupted by host restart".into();
        }
        jobs.insert(
            id,
            Job {
                elapsed_before: status.details.as_ref().map_or(0.0, |d| d.elapsed_seconds),
                state: Arc::new(Mutex::new(State {
                    status,
                    events: Vec::new(),
                })),
                token: CancellationToken::default(),
                started: Instant::now(),
                files,
            },
        );
    }
    Ok(jobs)
}
impl Jobs {
    pub(super) fn resume(&self, id: &str) -> io::Result<GenerationStatus> {
        let mut jobs = self.jobs.lock().map_err(poisoned)?;
        let previous = jobs
            .get(id)
            .ok_or_else(|| io::Error::other("Generation job was not found"))?;
        let mut status = previous.status()?;
        if matches!(
            status.state,
            GenerationState::Running | GenerationState::Completed
        ) {
            return Err(io::Error::other(
                "Only interrupted, failed or cancelled jobs can resume",
            ));
        }
        let action: Action = previous
            .files
            .read("action.json")?
            .ok_or_else(|| io::Error::other("Saved job request is missing"))?;
        let checkpoint = previous.files.checkpoint()?;
        status.state = GenerationState::Running;
        status.step = if checkpoint.is_some() {
            "Resuming latest checkpoint"
        } else {
            "Restarting from beginning"
        }
        .into();
        status.message = None;
        status.recovery = None;
        if let Some(details) = &mut status.details {
            details.finished_at = None;
        }
        let job = Job {
            state: Arc::new(Mutex::new(State {
                status: status.clone(),
                events: vec![Event::Status {
                    status: Box::new(status.clone()),
                }],
            })),
            token: CancellationToken::default(),
            started: Instant::now(),
            elapsed_before: status.details.as_ref().map_or(0.0, |d| d.elapsed_seconds),
            files: previous.files.clone(),
        };
        job.files.write("status.json", &status)?;
        let worker = job.clone();
        let settings = self.settings.clone();
        std::thread::Builder::new()
            .name(format!("atlas-generation-{id}"))
            .spawn(move || super::run::run(action, settings, worker))?;
        jobs.insert(id.to_owned(), job);
        Ok(status)
    }
}
