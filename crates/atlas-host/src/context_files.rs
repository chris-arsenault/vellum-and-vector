//! Reference-aware file cleanup shared by the two host adapters.
use crate::{
    context_inventory::{resource_references, InputEntry, Orphan, Target},
    job_files::JobFiles,
    native_resources::NativeResources,
    numerical_resource::Store,
};
use atlas_generation::{GenerationState, GenerationStatus};
use atlas_gis::map_files::MapFiles;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, io, path::Path};

#[derive(Default)]
pub struct Retention {
    pub resources: BTreeSet<String>,
    pub geography: BTreeSet<crate::context_inventory::GeographyKey>,
    pub problems: Vec<String>,
}
impl Retention {
    pub fn collect(
        inputs: &[InputEntry],
        jobs: &[GenerationStatus],
        jobs_root: &Path,
        resources: &Path,
    ) -> Self {
        let mut result = Self::default();
        for input in inputs {
            match crate::generation_document::FORMAT
                .read::<crate::generation_document::Document>(input.document.clone())
                .and_then(|document| {
                    document.world["fields"].as_array().ok_or_else(|| {
                        io::Error::other("The numerical field references cannot be read")
                    })?;
                    Ok(document)
                }) {
                Ok(_) => resource_references(&input.document, &mut result.resources),
                Err(e) => result
                    .problems
                    .push(format!("Inputs {}: {e}", input.catalog)),
            }
        }
        for job in jobs
            .iter()
            .filter(|j| j.state != GenerationState::Completed)
        {
            if let Err(e) = result.job(job, jobs_root) {
                result.problems.push(format!("Job {}: {e}", job.job_id));
            }
        }
        let store = NativeResources::new(resources.into());
        let mut pending = result.resources.clone();
        let mut seen = BTreeSet::new();
        while let Some(id) = pending.pop_first() {
            if !seen.insert(id.clone()) {
                continue;
            }
            match store.describe(&id) {
                Ok(descriptor) => {
                    if let Some(field) = &descriptor.field {
                        result.geography.insert((
                            descriptor.scope.world_id,
                            descriptor.scope.area_id,
                            field.geography_id.clone(),
                        ));
                    }
                    let mut references = BTreeSet::new();
                    resource_references(
                        &serde_json::to_value(descriptor).unwrap(),
                        &mut references,
                    );
                    pending.extend(references.iter().cloned());
                    result.resources.extend(references);
                }
                Err(e) => result.problems.push(format!("Resource {id}: {e}")),
            }
        }
        result
    }
    fn job(&mut self, job: &GenerationStatus, root: &Path) -> io::Result<()> {
        let files = JobFiles::new(root, &job.job_id)?;
        for name in ["captured.json", "request.json"] {
            if let Some(value) = files.read::<serde_json::Value>(name)? {
                resource_references(&value, &mut self.resources);
            }
        }
        Ok(())
    }
    pub fn require_known(&self) -> io::Result<()> {
        if self.problems.is_empty() {
            Ok(())
        } else {
            Err(io::Error::other(format!(
                "Cleanup retained files because some references cannot be read: {}",
                self.problems.join("; ")
            )))
        }
    }
}
pub fn orphan_files(
    retention: &Retention,
    resources: &Path,
    assets: &MapFiles,
    used_assets: &[String],
) -> io::Result<Vec<Orphan>> {
    let mut result = Vec::new();
    fs::create_dir_all(resources)?;
    for entry in fs::read_dir(resources)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !entry.file_type()?.is_dir() {
            continue;
        }
        let id = percent_encoding::percent_decode_str(&name)
            .decode_utf8()
            .map_err(io::Error::other)?
            .into_owned();
        if !retention.resources.contains(&id) {
            result.push(Orphan {
                kind: "resource".into(),
                id,
                reference: None,
                problem: (!retention.problems.is_empty()).then(|| {
                    "Reference ownership could not be fully read; cleanup is blocked".into()
                }),
            });
        }
    }
    let used: BTreeSet<_> = used_assets.iter().collect();
    for id in assets
        .locations()?
        .into_iter()
        .filter(|id| !used.contains(id))
    {
        result.push(Orphan {
            kind: "asset".into(),
            id,
            reference: None,
            problem: None,
        });
    }
    Ok(result)
}
pub fn remove_file(orphan: &Orphan, resources: &Path, assets: &MapFiles) -> io::Result<()> {
    match orphan.kind.as_str() {
        "resource" => {
            match fs::remove_dir_all(NativeResources::new(resources.into()).directory(&orphan.id)?)
            {
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                result => result,
            }
        }
        "asset" => assets.remove(&orphan.id),
        _ => Err(io::Error::other("This entry is not a stored file")),
    }
}

/// A small durable deletion intent keeps a failed cross-store cleanup visible and retryable.
#[derive(Serialize, Deserialize)]
pub struct Cleanup {
    pub target: Target,
    pub maps: BTreeSet<atlas_map::Id>,
}
pub fn pending(root: &Path) -> io::Result<Vec<String>> {
    fs::create_dir_all(root)?;
    fs::read_dir(root)?
        .filter_map(|e| match e {
            Ok(e) if e.path().is_dir() => Some(Ok(e.file_name().to_string_lossy().into_owned())),
            Ok(_) => None,
            Err(e) => Some(Err(e)),
        })
        .collect()
}
pub fn retire_job_inputs(files: &JobFiles) -> io::Result<()> {
    for name in [
        "checkpoint",
        "captured.json",
        "request.json",
        "inputs.sqlite",
        "records.sqlite",
    ] {
        match fs::remove_file(files.directory.join(name)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
    }
    Ok(())
}
