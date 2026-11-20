//! Complete native application job: private preparation, generation, capture and GIS publication.
use crate::{
    finished_map, generation_execution, generation_output::Observations,
    generation_submission::Submission, native::NativeScratch, native_map_assets::NativeMapAssets,
    native_resources::NativeResources, numerical_resource::Store, private_inputs::PrivateInputs,
    record_store::Workspace, regional_capture,
};
use atlas_generation::{
    atlas::regional::work::Progress,
    control::GenerationControl,
    features::{network::NetworkWorkspace, FeatureWorkspace},
    storage::{BlockCache, BlockScratch, MemoryBudget, SharedCache},
};
use atlas_gis::{geometry::NativeGeos, map_files::MapFiles, postgres_maps::PostgresMaps};
use atlas_map::MapRef;
use serde_json::Value;
use std::{fs, io, path::PathBuf, rc::Rc, sync::Arc};

// Arconis: docs/architecture/subsystems.arconis#item=j_be_job — native job that prepares, runs, keeps inputs and publishes.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct NativeJob {
    pub submission: Submission,
    pub source: Option<MapRef>,
    pub expected: Option<MapRef>,
    pub parent: Option<MapRef>,
    /// The job's identity, which the map revision it publishes takes.
    pub operation: atlas_map::Id,
    pub selection: Option<regional_capture::Child>,
    /// Refinement publishes the captured child; Regenerate on that child generates it.
    pub creates_child: bool,
}
#[derive(serde::Serialize, serde::Deserialize)]
struct CapturedJob {
    request: NativeJob,
    geography: Vec<Value>,
}
pub struct Services<'a> {
    pub maps: &'a mut PostgresMaps,
    pub inputs: &'a PrivateInputs,
    pub resources: PathBuf,
    pub scratch: PathBuf,
    pub assets: MapFiles,
    pub memory: Arc<MemoryBudget>,
    pub published: &'a dyn Fn(&MapRef) -> io::Result<()>,
}
impl NativeJob {
    pub async fn run(
        self,
        services: Services<'_>,
        control: &impl GenerationControl,
        observations: impl Observations,
        progress: Progress,
    ) -> io::Result<MapRef> {
        let intended = MapRef {
            map_id: self.submission.input.area_id,
            revision: self.operation,
        };
        if services.maps.find_head(intended.map_id)?.as_ref() == Some(&intended)
            && services.maps.open(&intended)?.state == atlas_map::PublicationState::Complete
        {
            crate::job_files::JobFiles::new(
                &services.resources.join(".jobs"),
                &self.operation.to_string(),
            )?
            .retire_checkpoint()?;
            return Ok(intended);
        }
        services.maps.restart_publication(&intended)?;
        if services.maps.find_head(self.submission.input.area_id)? != self.expected {
            return Err(io::Error::other(
                "The map revision changed before generation started",
            ));
        }
        let directory = services.scratch.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory)?;
        let _cleanup = Directory(directory.clone());
        fs::create_dir_all(&services.resources)?;
        let workspace = Workspace::create(directory.join("records.sqlite"))?;
        let mut recovery = crate::job_files::JobFiles::new(
            &services.resources.join(".jobs"),
            &self.operation.to_string(),
        )?;
        let captured: Option<CapturedJob> = recovery.read("captured.json")?;
        if captured.is_none() {
            if let Some(reference) = &self.source {
                services.inputs.load_records(
                    reference,
                    &mut workspace.source_features(),
                    &mut workspace.source_networks(),
                )?;
            }
        }
        let spatial = Rc::new(
            NativeGeos::new(
                self.submission.source.world["reference"]["precision"]
                    .as_f64()
                    .unwrap_or(1e-6),
            )
            .map_err(io::Error::other)?,
        );
        let resources = Rc::new(NativeResources::new(services.resources.clone()));
        let (job, workspace, captured_geography) = if let Some(captured) = captured {
            let source = Workspace::open(Rc::new(atlas_gis::sql::Database::open(
                recovery.directory.join("inputs.sqlite"),
            )?))?;
            workspace.copy_sources(&source)?;
            (captured.request, workspace, captured.geography)
        } else {
            let (job, workspace, geography) = self
                .capture(
                    &services,
                    workspace,
                    &directory,
                    &resources,
                    spatial.as_ref(),
                )
                .await?;
            let source = Workspace::open(Rc::new(atlas_gis::sql::Database::open(
                recovery.directory.join("inputs.sqlite"),
            )?))?;
            source.copy_sources(&workspace)?;
            let captured = CapturedJob {
                request: job,
                geography,
            };
            recovery.write("captured.json", &captured)?;
            (captured.request, workspace, captured.geography)
        };
        let cache = BlockCache::with_memory(
            services.memory.clone(),
            BlockScratch::new(NativeScratch::create_new(directory.join("work.blocks"))?),
        );
        let result = job
            .execute(
                services,
                control,
                (observations, progress, &mut recovery),
                (workspace, captured_geography),
                Runtime {
                    resources,
                    cache,
                    spatial,
                },
            )
            .await;
        if result.is_ok() {
            recovery.retire_checkpoint()?;
        }
        result
    }
    async fn capture(
        mut self,
        services: &Services<'_>,
        workspace: Workspace,
        directory: &std::path::Path,
        resources: &NativeResources,
        spatial: &NativeGeos,
    ) -> io::Result<(Self, Workspace, Vec<Value>)> {
        let Some(child) = self.selection.take() else {
            return Ok((self, workspace, Vec::new()));
        };
        let parent = services.maps.open(&child.selection.parent)?;
        let captured = regional_capture::capture(
            regional_capture::Selection {
                parent: &parent,
                selection: &child.selection,
                id: self.submission.input.area_id,
                name: &child.name,
                operation: self.operation,
                real_scale: child.real_scale(self.submission.input.quality),
                city: child.city,
            },
            self.submission.source,
            &crate::private_inputs::CaptureInputs {
                resources,
                private: services.inputs,
            },
            services.maps,
            &workspace.source_features(),
            spatial,
        )?;
        captured
            .write_resources(&mut NativeResources::new(services.resources.clone()))
            .await?;
        let destination = Workspace::create(directory.join("child-records.sqlite"))?;
        for feature in captured.features {
            destination.source_features().put(feature)?;
        }
        for node in captured.nodes {
            destination.source_networks().put_node(node)?;
        }
        for reach in captured.reaches {
            destination.source_networks().put_reach(reach)?;
        }
        self.submission.source = captured.document;
        Ok((self, destination, captured.geography))
    }
    async fn execute(
        self,
        mut services: Services<'_>,
        control: &impl GenerationControl,
        observations: (impl Observations, Progress, &mut crate::job_files::JobFiles),
        captured: (Workspace, Vec<Value>),
        runtime: Runtime,
    ) -> io::Result<MapRef> {
        let (observations, progress, recovery) = observations;
        let (workspace, mut captured_geography) = captured;
        if self.creates_child {
            return self
                .publish_capture(services, (workspace, captured_geography), runtime, control)
                .await;
        }
        let Runtime {
            resources,
            spatial,
            cache,
        } = runtime;
        let finished = generation_execution::run(
            self.submission,
            &self.operation.to_string(),
            generation_execution::Services {
                recovery: Some(recovery),
                resources: resources.clone(),
                cache: cache.clone(),
                spatial: spatial.clone(),
                records: &workspace,
                progress,
                completed_at: || {
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                },
            },
            control,
            observations,
            &mut NativeResources::new(services.resources.clone()),
        )
        .await?;
        let reference = MapRef {
            map_id: finished.snapshot.scope.located.area_id,
            revision: self.operation,
        };
        captured_geography.extend(finished.output.geography.iter().cloned());
        publication_start(&reference, "retain-inputs");
        let started = std::time::Instant::now();
        services.inputs.store(
            &reference,
            &finished.snapshot,
            &workspace.features(),
            &workspace.networks(),
            &captured_geography,
        )?;
        publication_timing(&reference, "retain-inputs", started);
        let map = finished_map::Request::from_document(
            finished.snapshot,
            reference.clone(),
            self.expected,
            self.parent,
        )?;
        let published = publish(
            (map, None),
            &mut services,
            &workspace.features(),
            Runtime {
                resources,
                cache,
                spatial,
            },
            control,
        )
        .await;
        published
    }
    /// Retain and publish the captured child as its first revision. Nothing is generated: the
    /// map carries the parent's geography within the child's footprint and the starting records.
    async fn publish_capture(
        self,
        mut services: Services<'_>,
        captured: (Workspace, Vec<Value>),
        runtime: Runtime,
        control: &impl GenerationControl,
    ) -> io::Result<MapRef> {
        let (workspace, geography) = captured;
        let reference = MapRef {
            map_id: self.submission.input.area_id,
            revision: self.operation,
        };
        services.inputs.store(
            &reference,
            &self.submission.source,
            &workspace.source_features(),
            &workspace.source_networks(),
            &geography,
        )?;
        let parent = self
            .parent
            .clone()
            .ok_or_else(|| io::Error::other("A captured child belongs to a parent map"))?;
        let map = finished_map::Request::from_document(
            self.submission.source,
            reference,
            self.expected,
            self.parent,
        )?;
        let copied = Some(&parent);
        publish(
            (map, copied),
            &mut services,
            &workspace.source_features(),
            runtime,
            control,
        )
        .await
    }
}
struct Runtime {
    resources: Rc<NativeResources>,
    cache: SharedCache,
    spatial: Rc<NativeGeos>,
}
/// `copied` names the parent whose published rasters a captured child crops.
async fn publish(
    (map, copied): (finished_map::Request, Option<&MapRef>),
    services: &mut Services<'_>,
    records: &crate::record_store::Features,
    runtime: Runtime,
    control: &impl GenerationControl,
) -> io::Result<MapRef> {
    let reference = map.reference.clone();
    publication_start(&reference, "prepare-map");
    let started = std::time::Instant::now();
    let Runtime {
        resources,
        cache,
        spatial,
    } = runtime;
    let mut geography = Vec::new();
    for (_, reference) in map.references()? {
        let descriptor = resources.describe(&reference.resource_id)?;
        let field = descriptor
            .field
            .ok_or_else(|| io::Error::other("Map fields retain their geography"))?;
        geography.push(serde_json::from_value(
            services
                .inputs
                .geography(&descriptor.scope, &field.geography_id)?,
        )?);
    }
    let mut product = map.prepare(
        resources,
        cache.clone(),
        &geography,
        records,
        spatial.as_ref(),
    )?;
    if let Some(parent) = copied {
        let rasters =
            finished_map::parent_rasters(services.maps.access(), &services.assets, parent)?;
        product = product.with_parent_rasters(rasters);
    }
    publication_timing(&reference, "prepare-map", started);
    let mut assets = NativeMapAssets::new(services.assets.clone(), cache);
    publication_start(&reference, "publish-map");
    let started = std::time::Instant::now();
    let result = product
        .publish(
            records,
            spatial.as_ref(),
            &mut crate::observed_publication::Observed {
                publisher: services.maps,
                visible: false,
                changed: services.published,
            },
            &mut assets,
            control,
        )
        .await;
    publication_timing(&reference, "publish-map", started);
    result
}
fn publication_timing(reference: &MapRef, stage: &str, started: std::time::Instant) {
    eprintln!(
        "{}",
        serde_json::json!({"event":"generation.publication", "mapId":reference.map_id,
        "revision":reference.revision, "stage":stage, "seconds":started.elapsed().as_secs_f64(),
        "memory":crate::host_memory::resident()})
    );
}
/// Names a publication stage as it starts, so a server that dies inside it shows where.
fn publication_start(reference: &MapRef, stage: &str) {
    eprintln!(
        "{}",
        serde_json::json!({"event":"generation.publication.start", "mapId":reference.map_id,
        "revision":reference.revision, "stage":stage, "memory":crate::host_memory::resident()})
    );
}
struct Directory(PathBuf);
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}
