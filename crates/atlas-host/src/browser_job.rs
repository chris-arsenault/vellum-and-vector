//! Browser application job. Geometry and SQL execute directly in the Rust module.
// owner-direction(2026-11-12): computation uses one Rust core for native and WASM
mod prepare;
mod publication;
use crate::{
    browser_control::BrowserControl, browser_generation::BrowserGenerationHost,
    generation_application::Configuration, generation_execution, generation_submission::Submission,
    local_inputs::LocalInputs, native::NativeScratch, native_resources::NativeResources,
    record_store::Workspace,
};
use atlas_generation::storage::{BlockCache, BlockScratch};
use atlas_generation::RefinementRequest;
use atlas_gis::{geometry::NativeGeos, map_files::MapFiles, map_store::MapStore, sql::Database};
use atlas_map::{MapRef, RegionSelection};
use serde::Deserialize;
use serde_json::Value;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

#[derive(serde::Serialize, Deserialize)]
#[serde(tag = "method", content = "request", rename_all = "camelCase")]
pub enum Action {
    Create(Configuration),
    Refine(RefinementRequest<Configuration>),
    Regenerate {
        reference: MapRef,
        configuration: Configuration,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Run {
    action: Option<Action>,
    operation: String,
    revision: String,
    cache_bytes: usize,
}
#[derive(serde::Serialize, Deserialize)]
pub(super) struct Prepared {
    submission: Submission,
    expected: Option<MapRef>,
    parent: Option<MapRef>,
    selection: Option<(RegionSelection, String)>,
    /// Refinement publishes the captured child; Regenerate on that child generates it.
    creates_child: bool,
    geography: Vec<Value>,
    resources: Vec<Value>,
}
// Arconis: docs/architecture/subsystems.arconis#item=j_bw_job — browser job that prepares, runs, keeps inputs and publishes.
#[wasm_bindgen]
pub struct BrowserJob {
    private: LocalInputs,
    records: Workspace,
    maps: MapStore,
    resources: Rc<NativeResources>,
    output: NativeResources,
    assets: MapFiles,
    scratch: std::path::PathBuf,
    pub(crate) running: Option<(
        Rc<std::cell::RefCell<std::collections::BTreeSet<String>>>,
        String,
    )>,
}
#[wasm_bindgen]
impl BrowserJob {
    #[wasm_bindgen(constructor)]
    pub fn new(
        private: &str,
        records: &str,
        maps: &MapStore,
        resources: &str,
        assets: &str,
        scratch: &str,
    ) -> Result<BrowserJob, JsValue> {
        std::fs::create_dir_all(resources).map_err(error)?;
        std::fs::create_dir_all(scratch).map_err(error)?;
        Ok(Self {
            private: LocalInputs::open(Rc::new(Database::open(private).map_err(error)?))
                .map_err(error)?,
            records: Workspace::open(Rc::new(Database::open(records).map_err(error)?))
                .map_err(error)?,
            maps: maps.clone(),
            resources: Rc::new(NativeResources::new(resources.into())),
            output: NativeResources::new(resources.into()),
            assets: MapFiles::new(assets),
            scratch: scratch.into(),
            running: None,
        })
    }
    pub async fn run(
        &mut self,
        request: &str,
        host: BrowserGenerationHost,
    ) -> Result<String, JsValue> {
        let request: Run = serde_json::from_str(request).map_err(error)?;
        let files = crate::job_files::JobFiles::new(
            std::path::Path::new(super::browser_workspace::JOBS),
            &request.operation,
        )
        .map_err(error)?;
        let started = js_sys::Date::now();
        let result = self.execute(request, host).await;
        if let Some(mut status) = files
            .read::<atlas_generation::GenerationStatus>("status.json")
            .map_err(error)?
        {
            if let Some(details) = &mut status.details {
                details.finished_at = Some(crate::job_files::now());
                details.elapsed_seconds += (js_sys::Date::now() - started) / 1000.0;
            }
            match &result {
                Ok(reference) => {
                    status.result = Some(serde_json::from_str(reference).map_err(error)?);
                    status.state = atlas_generation::GenerationState::Completed;
                    status.step = "Map published".into();
                    status.progress = Some(1.0);
                }
                Err(message) => {
                    status.state = atlas_generation::GenerationState::Interrupted;
                    status.message = Some(format!("{message:?}"));
                }
            }
            files.write("status.json", &status).map_err(error)?;
            if status.state == atlas_generation::GenerationState::Completed {
                crate::context_files::retire_job_inputs(&files).map_err(error)?;
            }
        }
        if let Some((running, id)) = &self.running {
            running.borrow_mut().remove(id);
        }
        result
    }
}
impl BrowserJob {
    async fn execute(
        &mut self,
        request: Run,
        host: BrowserGenerationHost,
    ) -> Result<String, JsValue> {
        let Run {
            action,
            operation,
            revision,
            cache_bytes,
        } = request;
        let mut recovery = crate::job_files::JobFiles::new(
            std::path::Path::new(super::browser_workspace::JOBS),
            &operation,
        )
        .map_err(error)?;
        let prepared = match recovery.read::<Prepared>("captured.json").map_err(error)? {
            Some(prepared) => {
                let source = Workspace::open(Rc::new(
                    Database::open(recovery.directory.join("records.sqlite")).map_err(error)?,
                ))
                .map_err(error)?;
                self.records.copy_sources(&source).map_err(error)?;
                prepared
            }
            None => {
                let action = action
                    .or(recovery.read("action.json").map_err(error)?)
                    .ok_or_else(|| error("Saved job request is missing"))?;
                let prepared = self.prepare(action, &operation)?;
                crate::regional_capture::write_resources(&prepared.resources, &mut self.output)
                    .await
                    .map_err(error)?;
                let source = Workspace::open(Rc::new(
                    Database::open(recovery.directory.join("records.sqlite")).map_err(error)?,
                ))
                .map_err(error)?;
                source.copy_sources(&self.records).map_err(error)?;
                recovery.write("captured.json", &prepared).map_err(error)?;
                prepared
            }
        };
        let intended = MapRef {
            map_id: prepared.submission.input.area_id.clone(),
            revision: revision.clone(),
        };
        if self
            .maps
            .find_head(&intended.map_id)
            .map_err(error)?
            .as_ref()
            == Some(&intended)
            && self.maps.open(&intended).map_err(error)?.state
                == atlas_map::PublicationState::Complete
        {
            recovery.retire_checkpoint().map_err(error)?;
            return serde_json::to_string(&intended).map_err(error);
        }
        self.maps.restart_publication(&intended).map_err(error)?;
        if self
            .maps
            .find_head(&prepared.submission.input.area_id)
            .map_err(error)?
            != prepared.expected
        {
            return Err(error("The map revision changed before generation started"));
        }
        if cache_bytes == 0 {
            return Err(error("Generation requires a positive block-cache budget"));
        }
        if prepared.creates_child {
            self.publish_capture(prepared, &intended, cache_bytes, &host)
                .await?;
            recovery.retire_checkpoint().map_err(error)?;
            return serde_json::to_string(&intended).map_err(error);
        }
        let spatial = Rc::new(
            NativeGeos::new(
                prepared.submission.source.world["reference"]["precision"]
                    .as_f64()
                    .unwrap_or(1e-6),
            )
            .map_err(error)?,
        );
        let progress_host = host.clone();
        let finished = generation_execution::run(
            prepared.submission,
            &operation,
            generation_execution::Services {
                recovery: Some(&mut recovery),
                resources: self.resources.clone(),
                spatial,
                cache: BlockCache::new(
                    cache_bytes,
                    BlockScratch::new(
                        NativeScratch::create_new(self.scratch.join("generation.blocks"))
                            .map_err(error)?,
                    ),
                ),
                records: &self.records,
                progress: Rc::new(move |fraction, message| {
                    progress_host.work_progress(fraction, message)
                }),
                completed_at: || String::from(js_sys::Date::new_0().to_iso_string()),
            },
            &BrowserControl::new(host.control()?),
            host.clone(),
            &mut self.output,
        )
        .await
        .map_err(error)?;
        let reference = MapRef {
            map_id: finished.snapshot.scope.located.area_id.clone(),
            revision,
        };
        let mut geography = prepared.geography;
        geography.extend(finished.output.geography);
        host.work_progress(0.0, "Retaining completed generation inputs");
        self.private
            .store(
                &reference,
                &finished.snapshot,
                &self.records.features(),
                &self.records.networks(),
                &geography,
            )
            .map_err(error)?;
        host.work_progress(0.0, "Preparing finished map publication");
        let records = self.records.features();
        let result = self
            .publish(
                (
                    crate::finished_map::Request::from_document(
                        finished.snapshot,
                        reference.clone(),
                        prepared.expected,
                        prepared.parent,
                    )
                    .map_err(error)?,
                    None,
                ),
                cache_bytes,
                &host,
                &records,
            )
            .await;
        result?;
        recovery.retire_checkpoint().map_err(error)?;
        serde_json::to_string(&reference).map_err(error)
    }
}
#[wasm_bindgen]
impl BrowserJob {
    pub async fn review(&self, action: &str, operation: &str) -> Result<String, JsValue> {
        let mut action: Action = serde_json::from_str(action).map_err(error)?;
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
        let prepared = self.prepare(action, operation)?;
        let descriptors = crate::generation_review::Descriptors {
            captured: &prepared.resources,
            store: self.resources.as_ref(),
        };
        let geography: crate::generation_frame::Geography =
            serde_json::from_value(prepared.submission.source.world.clone()).map_err(error)?;
        let spatial =
            atlas_gis::geometry::NativeGeos::new(geography.reference.precision.unwrap_or(1e-6))
                .map_err(error)?;
        let request = prepared
            .submission
            .request(&spatial)
            .map_err(error)?
            .resolve(&spatial, &descriptors)
            .map_err(error)?;
        serde_json::to_string(&request.review(&spatial).map_err(error)?).map_err(error)
    }
    pub fn configuration(&self, reference: &str) -> Result<String, JsValue> {
        let reference = serde_json::from_str(reference).map_err(error)?;
        let document = self.private.document(&reference).map_err(error)?;
        let map = self.maps.open(&reference).map_err(error)?;
        serde_json::to_string(&Configuration::from_map(&document, &map).map_err(error)?)
            .map_err(error)
    }
}
fn error(value: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&value.to_string()).into()
}
