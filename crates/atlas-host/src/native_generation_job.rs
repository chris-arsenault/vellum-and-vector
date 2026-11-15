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
use atlas_map::{MapRef, RegionSelection};
use serde_json::Value;
use std::{fs, io, path::PathBuf, rc::Rc, sync::Arc};

// Arconis: docs/architecture/subsystems.arconis#item=j_be_job — native job that prepares, runs, keeps inputs and publishes.
pub struct NativeJob {
    pub submission: Submission,
    pub source: Option<MapRef>,
    pub expected: Option<MapRef>,
    pub parent: Option<MapRef>,
    pub operation: String,
    pub selection: Option<(RegionSelection, String)>,
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
        if services.maps.find_head(&self.submission.input.area_id)? != self.expected {
            return Err(io::Error::other(
                "The map revision changed before generation started",
            ));
        }
        let directory = services.scratch.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory)?;
        let _cleanup = Directory(directory.clone());
        fs::create_dir_all(&services.resources)?;
        let workspace = Workspace::create(directory.join("records.sqlite"))?;
        if let Some(reference) = &self.source {
            services.inputs.load_records(
                reference,
                &mut workspace.source_features(),
                &mut workspace.source_networks(),
            )?;
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
        let (job, workspace, captured_geography) = self
            .capture(
                &services,
                workspace,
                &directory,
                &resources,
                spatial.as_ref(),
            )
            .await?;
        let cache = BlockCache::with_memory(
            services.memory.clone(),
            BlockScratch::new(NativeScratch::create_new(directory.join("work.blocks"))?),
        );
        job.execute(
            services,
            control,
            (observations, progress),
            (workspace, captured_geography),
            Runtime {
                resources,
                cache,
                spatial,
            },
        )
        .await
    }
    async fn capture(
        mut self,
        services: &Services<'_>,
        workspace: Workspace,
        directory: &std::path::Path,
        resources: &NativeResources,
        spatial: &NativeGeos,
    ) -> io::Result<(Self, Workspace, Vec<Value>)> {
        let Some((selection, name)) = self.selection.take() else {
            return Ok((self, workspace, Vec::new()));
        };
        let parent = services.maps.open(&selection.parent)?;
        let captured = regional_capture::capture(
            regional_capture::Selection {
                parent: &parent,
                selection: &selection,
                id: &self.submission.input.area_id,
                name: &name,
                operation: &self.operation,
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
        observations: (impl Observations, Progress),
        captured: (Workspace, Vec<Value>),
        runtime: Runtime,
    ) -> io::Result<MapRef> {
        let (observations, progress) = observations;
        let (workspace, mut captured_geography) = captured;
        let Runtime {
            resources,
            spatial,
            cache,
        } = runtime;
        let finished = generation_execution::run(
            self.submission,
            &self.operation,
            generation_execution::Services {
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
            map_id: finished.snapshot.scope.located.area_id.clone(),
            revision: uuid::Uuid::new_v4().to_string(),
        };
        captured_geography.extend(finished.output.geography.iter().cloned());
        services.inputs.store(
            &reference,
            &finished.snapshot,
            &workspace.features(),
            &workspace.networks(),
            &captured_geography,
        )?;
        let map = finished_map::Request::from_document(
            finished.snapshot,
            reference.clone(),
            self.expected,
            self.parent,
        )?;
        let published = publish(
            map,
            &mut services,
            &workspace,
            Runtime {
                resources,
                cache,
                spatial,
            },
            control,
        )
        .await;
        if published.is_err() {
            services.inputs.unbind(&reference)?;
        }
        published
    }
}
struct Runtime {
    resources: Rc<NativeResources>,
    cache: SharedCache,
    spatial: Rc<NativeGeos>,
}
async fn publish(
    map: finished_map::Request,
    services: &mut Services<'_>,
    workspace: &Workspace,
    runtime: Runtime,
    control: &impl GenerationControl,
) -> io::Result<MapRef> {
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
    let product = map.prepare(
        resources,
        cache.clone(),
        &geography,
        &workspace.features(),
        spatial.as_ref(),
    )?;
    let mut assets = NativeMapAssets::new(services.assets.clone(), cache);
    product
        .publish(
            &workspace.features(),
            spatial.as_ref(),
            &mut crate::observed_publication::Observed {
                publisher: services.maps,
                visible: false,
                changed: services.published,
            },
            &mut assets,
            control,
        )
        .await
}
struct Directory(PathBuf);
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}
