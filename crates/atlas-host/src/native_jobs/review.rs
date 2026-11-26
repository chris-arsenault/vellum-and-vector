use super::{Action, Settings};
use crate::{
    generation_application::Configuration, generation_review::Descriptors,
    native_resources::NativeResources, private_inputs::PrivateInputs, record_store::Workspace,
    regional_capture,
};
use atlas_gis::{geometry::NativeGeos, postgres_maps::PostgresMaps};
use atlas_map::MapRef;
use serde_json::Value;
use std::{fs, io, path::PathBuf};

pub(super) fn configuration(settings: &Settings, reference: &MapRef) -> io::Result<Value> {
    let maps = PostgresMaps::connect(&settings.database_url)?;
    let inputs = PrivateInputs::connect(&settings.generation_url)?;
    Ok(serde_json::to_value(Configuration::from_map(
        &inputs.document(reference)?,
        &maps.open(reference)?,
    )?)?)
}
pub(super) fn review(settings: &Settings, mut action: Action) -> io::Result<Value> {
    let configuration = match &mut action {
        Action::Create(c)
        | Action::Regenerate {
            configuration: c, ..
        } => c,
        Action::Refine(r) => &mut r.configuration,
    };
    if configuration.name.trim().is_empty() {
        configuration.name = "Untitled map".into();
    }
    let maps = PostgresMaps::connect(&settings.database_url)?;
    let inputs = PrivateInputs::connect(&settings.generation_url)?;
    let operation = crate::generation_world::random_id();
    let mut job = super::run::prepare(action, &maps, &inputs, operation)?;
    let resources = NativeResources::new(settings.resources.clone());
    let spatial = NativeGeos::new(
        job.submission.source.world["reference"]["precision"]
            .as_f64()
            .unwrap_or(1e-6),
    )
    .map_err(io::Error::other)?;
    let mut captured = Vec::new();
    if let Some(child) = job.selection.take() {
        let real_scale = child.real_scale(job.submission.input.quality);
        let city = child.city;
        let (selection, name) = (child.selection, child.name);
        let directory = settings.scratch.join(operation.to_string());
        fs::create_dir_all(&directory)?;
        let _cleanup = Directory(directory.clone());
        let records = Workspace::create(directory.join("review.sqlite"))?;
        inputs.load_records(
            &selection.parent,
            &mut records.source_features(),
            &mut records.source_networks(),
        )?;
        let parent = maps.open(&selection.parent)?;
        let capture = regional_capture::capture(
            regional_capture::Selection {
                parent: &parent,
                selection: &selection,
                id: job.submission.input.area_id,
                name: &name,
                operation: job.operation,
                real_scale,
                city,
            },
            job.submission.source,
            &crate::private_inputs::CaptureInputs {
                resources: &resources,
                private: &inputs,
            },
            regional_capture::PublishedMap {
                maps: &maps,
                files: &settings.assets,
            },
            &records.source_features(),
            &spatial,
        )?;
        job.submission.source = capture.document;
        captured = capture.resources;
    }
    job.submission
        .request(&spatial)?
        .resolve(
            &spatial,
            &Descriptors {
                captured: &captured,
                store: &resources,
            },
        )?
        .review(&spatial)
}
struct Directory(PathBuf);
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}
