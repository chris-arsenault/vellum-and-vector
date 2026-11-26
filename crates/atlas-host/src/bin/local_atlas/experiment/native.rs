use super::{map, measure::Frame, Harness, Source, Spec, Trial};
use atlas_generation::{
    atlas::{
        dispatch::experiment::{Experiment, Target},
        history::{Diagnostic, GenerationEpoch},
        preview::Preview,
        state::State,
        workflow::{Boundary, Output},
    },
    control::CancellationToken,
    execution::ExecutionResult,
    parameters::Values,
    storage::{BlockCache, BlockScratch},
};
use atlas_gis::geometry::NativeGeos;
use atlas_host::{
    generation_application::Configuration,
    generation_execution::{self, Services},
    generation_output::Observations,
    generation_submission::Submission,
    generation_world::{random_id, CreateWorld},
    native::NativeScratch,
    native_control::NativeControl,
    native_resources::NativeResources,
    private_inputs::PrivateInputs,
    record_store::Workspace,
};
use atlas_map::{Bounds, MapDescriptor, MapRef};
use std::{
    fs, io,
    path::{Path, PathBuf},
    rc::Rc,
};

pub(super) struct Input {
    submission: Vec<u8>,
    reference: Option<MapRef>,
    records: Option<Workspace>,
    resources: PathBuf,
}
impl Input {
    pub fn reference(&self) -> Option<&MapRef> {
        self.reference.as_ref()
    }
    pub fn load(harness: &Harness, source: &Source, output: &Path) -> io::Result<Self> {
        let resources = harness.home.join("generation-resources");
        let (submission, reference, records) = match source {
            Source::Captured {
                map: name,
                revision,
                configuration,
            } => {
                let map = map(harness, name)?;
                let map = match revision {
                    Some(revision) => super::open_revision(
                        harness,
                        &MapRef {
                            map_id: map.reference.map_id,
                            revision: *revision,
                        },
                    )?,
                    None => map,
                };
                let url = std::env::var("ATLAS_EXPERIMENT_GENERATION_URL").map_err(|_| {
                    io::Error::other(
                        "Use scripts/local-atlas.sh experiment to open the retained local capture",
                    )
                })?;
                let private = PrivateInputs::connect(&url)?;
                let source = private.document(&map.reference)?;
                let config = match configuration {
                    Some(path) => configuration_for(path, Some(&map.reference))?,
                    None => Configuration::from_map(&source, &map)?,
                };
                let input = config.input(map.reference.map_id)?;
                let records = Workspace::create(output.join("source-records.sqlite"))?;
                private.load_records(
                    &map.reference,
                    &mut records.source_features(),
                    &mut records.source_networks(),
                )?;
                (
                    Submission { source, input },
                    Some(map.reference),
                    Some(records),
                )
            }
            Source::Job { id } => {
                let jobs = resources.join(".jobs");
                let job =
                    atlas_host::native_generation_job::NativeJob::retained_capture(&jobs, *id)?;
                let path = output.join("source-records.sqlite");
                fs::copy(jobs.join(id.to_string()).join("inputs.sqlite"), &path)?;
                let records = Workspace::open(Rc::new(atlas_gis::sql::Database::open(&path)?))?;
                (job.submission, job.source, Some(records))
            }
            Source::Create { configuration } => {
                let config = configuration_for(configuration, None)?;
                let input = config.input(atlas_map::Id::NIL)?;
                let source = CreateWorld {
                    id: config.world_id.unwrap_or_else(random_id),
                    name: config.name.clone(),
                    seed: input.seed,
                    width: config.width,
                    height: config.height,
                    settings: input.settings,
                    boundary_mode: None,
                }
                .create()?;
                let input = config.input(source.scope.located.area_id)?;
                (Submission { source, input }, None, None)
            }
            Source::Inspect { .. } => {
                unreachable!("Saved map inspection uses the published raster reader")
            }
        };
        Ok(Self {
            submission: serde_json::to_vec(&submission)?,
            reference,
            records,
            resources,
        })
    }
    fn workspace(&self, folder: &Path, full_recipe: bool) -> io::Result<Workspace> {
        let path = folder.join("records.sqlite");
        // owner-direction(2026-11-25): the harness itself retains the feature records needed to inspect full-map trials.
        let workspace = if full_recipe {
            Workspace::open(Rc::new(atlas_gis::sql::Database::open(path)?))?
        } else {
            Workspace::create(path)?
        };
        if let Some(source) = &self.records {
            workspace.copy_sources(source)?;
        }
        Ok(workspace)
    }
}

fn configuration_for(path: &Path, capture: Option<&MapRef>) -> io::Result<Configuration> {
    let value: serde_json::Value = super::read_json(path)?;
    if value.get("method").is_none() {
        return Ok(serde_json::from_value(value)?);
    }
    match serde_json::from_value(value)? {
        atlas_host::native_jobs::Action::Create(config) if capture.is_none() => Ok(config),
        atlas_host::native_jobs::Action::Regenerate {
            reference,
            configuration,
        } if capture == Some(&reference) => Ok(configuration),
        _ => Err(io::Error::other(
            "Select a configuration or an action recorded for this experiment source",
        )),
    }
}

pub(super) fn run(
    input: &Input,
    spec: &Spec,
    footprint: Option<&MapDescriptor>,
    folder: &Path,
    trial: &mut Trial,
) -> io::Result<()> {
    fs::create_dir(folder)?;
    let workspace = input.workspace(folder, spec.only.is_none())?;
    let submission: Submission = serde_json::from_slice(&input.submission)?;
    let spatial = Rc::new(NativeGeos::new(1e-6).map_err(io::Error::other)?);
    let frame = footprint
        .map(|map| Frame::map(map, spec.observe.samples_across, spatial.as_ref()))
        .transpose()?;
    let services = Services {
        resources: Rc::new(NativeResources::new(input.resources.clone())),
        spatial,
        cache: BlockCache::with_memory(
            atlas_host::host_memory::generation_budget()?,
            BlockScratch::new(NativeScratch::create_new(folder.join("work.blocks"))?),
        ),
        records: &workspace,
        progress: Rc::new(|_, _| {}),
        completed_at: || chrono::Utc::now().to_rfc3339(),
        recovery: None,
        experiment: Some(Experiment {
            only: spec.only.clone(),
            changes: trial.changes.clone(),
        }),
    };
    let control = NativeControl::new(CancellationToken::default(), |_| {});
    let mut output = Recorder { spec, frame, trial };
    if spec.only.is_some() {
        futures::executor::block_on(generation_execution::run_selected(
            &submission,
            services,
            &control,
            &mut output,
        ))?;
    } else {
        let resources = folder.join("resources");
        fs::create_dir(&resources)?;
        let mut sink = NativeResources::new(resources);
        let finished = futures::executor::block_on(generation_execution::run(
            submission,
            &random_id().to_string(),
            services,
            &control,
            output,
            &mut sink,
        ))?;
        super::write_json(&folder.join("completed.json"), &finished)?;
    }
    Ok(())
}

struct Recorder<'a> {
    spec: &'a Spec,
    frame: Option<Frame>,
    trial: &'a mut Trial,
}
impl Recorder<'_> {
    fn measure(&mut self, state: &State, label: String, values: Values) -> ExecutionResult<()> {
        if self.frame.is_none() {
            let [w, s, e, n] = state.physical.surface.grid().bounds;
            self.frame = Some(Frame::new(
                Bounds(w, s, e, n),
                &state.scope.footprint,
                self.spec.observe.samples_across,
                state.spatial.as_ref(),
            )?);
        }
        let observation =
            self.frame
                .as_ref()
                .unwrap()
                .state(state, &self.spec.observe.channel, label, values)?;
        self.trial.observations.push(observation);
        Ok(())
    }
    fn process(
        &mut self,
        state: &State,
        id: &str,
        path: &[String],
        parameters: &Values,
    ) -> ExecutionResult<()> {
        let changed = self
            .trial
            .changes
            .iter()
            .any(|change| change.target.observes(id, path));
        let watch = |target: &Target| target.observes(id, path);
        if changed || self.spec.observe.watch.iter().any(watch) {
            self.measure(state, path.join("/"), parameters.clone())?;
        }
        Ok(())
    }
    fn final_state(&mut self, state: &State) -> ExecutionResult<()> {
        self.measure(state, "final".into(), Values::new())?;
        if self
            .trial
            .observations
            .last()
            .is_some_and(|o| o.metrics.covered_km2 == 0.)
        {
            return Err(io::Error::other(
                "The live channel has no data on the comparison footprint",
            )
            .into());
        }
        Ok(())
    }
}
impl Output for Recorder<'_> {
    fn validate(&mut self, _: &State) -> ExecutionResult<()> {
        Ok(())
    }
    fn process(
        &mut self,
        state: &State,
        id: &str,
        path: &[String],
        parameters: &Values,
    ) -> ExecutionResult<()> {
        Recorder::process(self, state, id, path, parameters)
    }
    async fn completed(&mut self, state: &State, boundary: Boundary<'_>) -> ExecutionResult<()> {
        if matches!(boundary, Boundary::Final) {
            self.final_state(state)?;
        }
        Ok(())
    }
}
impl Observations for Recorder<'_> {
    fn process(
        &mut self,
        state: &State,
        id: &str,
        path: &[String],
        parameters: &Values,
    ) -> ExecutionResult<()> {
        Recorder::process(self, state, id, path, parameters)
    }
    fn completed_state(
        &mut self,
        state: &State,
        ancestry: Option<&[GenerationEpoch]>,
    ) -> ExecutionResult<()> {
        if ancestry.is_none() {
            self.final_state(state)?;
        }
        Ok(())
    }
    fn diagnostic(&mut self, diagnostic: &Diagnostic) -> ExecutionResult<()> {
        eprintln!("{}: {}", diagnostic.invocation, diagnostic.message);
        Ok(())
    }
    async fn preview(&mut self, _: &Preview, _: Option<&[GenerationEpoch]>) -> ExecutionResult<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_trial_records_survive_the_workspace() -> io::Result<()> {
        let folder = std::env::temp_dir().join(random_id().to_string());
        fs::create_dir(&folder)?;
        let input = Input {
            submission: Vec::new(),
            reference: None,
            records: None,
            resources: folder.clone(),
        };
        let path = folder.join("records.sqlite");
        drop(input.workspace(&folder, false)?);
        assert!(!path.exists());
        drop(input.workspace(&folder, true)?);
        assert!(path.is_file());
        let db = atlas_gis::sql::Database::open(&path)?;
        assert!(db
            .value(
                "SELECT name FROM sqlite_master WHERE name='working_features'",
                &[]
            )?
            .is_some());
        drop(db);
        fs::remove_dir_all(folder)
    }
}
