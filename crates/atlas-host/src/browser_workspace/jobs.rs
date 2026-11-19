use super::{
    error, BrowserJob, BrowserWorkspace, Database, LocalInputs, MapRef, ASSETS, JOBS, RESOURCES,
    SAVED_INPUTS,
};
use crate::{browser_job::Action, job_files::JobFiles};
use atlas_generation::{GenerationDetails, GenerationState, GenerationStatus, RecoveryStatus};
use std::{fs, io, path::Path, rc::Rc};
use wasm_bindgen::prelude::*;

impl BrowserWorkspace {
    pub(super) fn job_files(&self) -> io::Result<Vec<JobFiles>> {
        fs::create_dir_all(JOBS)?;
        let mut files = Vec::new();
        for entry in fs::read_dir(JOBS)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                files.push(JobFiles::new(
                    Path::new(JOBS),
                    &entry.file_name().to_string_lossy(),
                )?);
            }
        }
        Ok(files)
    }
    pub(super) fn ensure_inputs(&self, reference: &MapRef) -> io::Result<()> {
        if self.copy_available_inputs(reference)? {
            Ok(())
        } else {
            Err(io::Error::other(
                "This map has no retained generation inputs",
            ))
        }
    }
    pub(super) fn copy_available_inputs(&self, reference: &MapRef) -> io::Result<bool> {
        let inputs = LocalInputs::open(Rc::new(Database::open(&self.input_path)?))?;
        if inputs.contains(reference)? {
            return Ok(true);
        }
        for path in [std::path::PathBuf::from(SAVED_INPUTS)] {
            if !path.exists() {
                continue;
            }
            let source = LocalInputs::open(Rc::new(Database::open(&path)?))?;
            if source.contains(reference)? {
                source.document(reference)?;
                drop(source);
                inputs.copy_from(&path.to_string_lossy(), std::slice::from_ref(reference))?;
                return Ok(true);
            }
        }
        Ok(false)
    }
    pub(super) fn status(&self, files: &JobFiles) -> io::Result<GenerationStatus> {
        let mut status = files
            .read::<GenerationStatus>("status.json")?
            .ok_or_else(|| io::Error::other("Saved job metadata is missing"))?;
        if status.state == GenerationState::Running
            && !self.running.borrow().contains(&status.job_id)
        {
            status.state = GenerationState::Interrupted;
            status.step = "Interrupted browser job".into();
        }
        if !matches!(
            status.state,
            GenerationState::Completed | GenerationState::Running
        ) {
            status.recovery = Some(match files.checkpoint() {
                Ok(checkpoint) => {
                    if let (Some(c), Some(details)) = (&checkpoint, &mut status.details) {
                        details.elapsed_seconds = details.elapsed_seconds.max(c.elapsed_seconds);
                    }
                    RecoveryStatus {
                        checkpoint: checkpoint.map(|c| c.point.label()),
                        problem: None,
                    }
                }
                Err(error) => RecoveryStatus {
                    checkpoint: None,
                    problem: Some(error.to_string()),
                },
            });
        }
        Ok(status)
    }
}
#[wasm_bindgen]
impl BrowserWorkspace {
    pub fn generation_jobs(&self) -> Result<String, JsValue> {
        let mut statuses = Vec::new();
        for files in self.job_files().map_err(error)? {
            statuses.push(self.status(&files).unwrap_or_else(|error| {
                GenerationStatus {
                    job_id: files
                        .directory
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    state: GenerationState::Failed,
                    step: "Unreadable saved job".into(),
                    progress: None,
                    result: None,
                    details: None,
                    recovery: Some(RecoveryStatus {
                        checkpoint: None,
                        problem: Some(error.to_string()),
                    }),
                    message: Some(error.to_string()),
                }
            }));
        }
        serde_json::to_string(&statuses).map_err(error)
    }
    pub fn start_job(&self, action: &str) -> Result<String, JsValue> {
        let mut action: Action = serde_json::from_str(action).map_err(error)?;
        let id = uuid::Uuid::new_v4().to_string();
        let files = JobFiles::new(Path::new(JOBS), &id).map_err(error)?;
        let (configuration, parent) = match &mut action {
            Action::Create(c) => {
                c.world_id
                    .get_or_insert_with(crate::generation_world::random_id);
                (c, None)
            }
            Action::Refine(r) => (&mut r.configuration, Some(r.selection.parent.clone())),
            Action::Regenerate {
                reference,
                configuration,
            } => (configuration, Some(reference.clone())),
        };
        let status = GenerationStatus {
            job_id: id,
            state: GenerationState::Running,
            step: "Preparing map".into(),
            progress: None,
            result: None,
            message: None,
            recovery: None,
            details: Some(GenerationDetails {
                name: configuration.name.clone(),
                parent: parent.clone(),
                started_at: crate::job_files::now(),
                finished_at: None,
                elapsed_seconds: 0.0,
                epochs: Vec::new(),
            }),
        };
        let maps = self.saved().map_err(error)?;
        let inputs = LocalInputs::open(Rc::new(Database::open(SAVED_INPUTS).map_err(error)?))
            .map_err(error)?;
        if let Some(parent) = parent {
            self.ensure(&parent).map_err(error)?;
            self.ensure_inputs(&parent).map_err(error)?;
            maps.copy_from(&self.map_path, &parent).map_err(error)?;
            inputs
                .copy_from(&self.input_path, &[parent])
                .map_err(error)?;
        }
        files.write("action.json", &action).map_err(error)?;
        files.write("status.json", &status).map_err(error)?;
        self.running.borrow_mut().insert(status.job_id.clone());
        serde_json::to_string(&status).map_err(error)
    }
    pub fn resume_status(&self, id: &str) -> Result<String, JsValue> {
        let files = JobFiles::new(Path::new(JOBS), id).map_err(error)?;
        let mut status = self.status(&files).map_err(error)?;
        if matches!(
            status.state,
            GenerationState::Completed | GenerationState::Running
        ) {
            return Err(error(
                "Only interrupted, failed or cancelled jobs can resume",
            ));
        }
        let _: Action = files
            .read("action.json")
            .map_err(error)?
            .ok_or_else(|| error("Saved job request is missing"))?;
        status.step = if files.checkpoint().map_err(error)?.is_some() {
            "Resuming latest checkpoint"
        } else {
            "Restarting from beginning"
        }
        .into();
        status.state = GenerationState::Running;
        status.message = None;
        status.recovery = None;
        if let Some(details) = &mut status.details {
            details.finished_at = None;
        }
        files.write("status.json", &status).map_err(error)?;
        self.running.borrow_mut().insert(id.into());
        serde_json::to_string(&status).map_err(error)
    }
    pub fn retained_job(&self, id: &str) -> Result<BrowserJob, JsValue> {
        let maps = self.saved().map_err(error)?;
        let directory = self.directory.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory).map_err(error)?;
        let mut job = BrowserJob::new(
            SAVED_INPUTS,
            &directory.join("records.sqlite").to_string_lossy(),
            &maps,
            RESOURCES,
            ASSETS,
            &directory.to_string_lossy(),
        )?;
        job.running = Some((self.running.clone(), id.into()));
        Ok(job)
    }
}
