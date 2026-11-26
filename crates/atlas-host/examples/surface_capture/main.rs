//! Manual generation and ordinary finished-map publication, outside routine tests.
mod publish;
use atlas_generation::{
    atlas::{
        history::{Diagnostic, GenerationEpoch},
        preview::Preview,
    },
    control::CancellationToken,
    execution::ExecutionResult,
    storage::{BlockCache, BlockScratch},
};
use atlas_gis::geometry::NativeGeos;
use atlas_host::{
    generation_execution::{self, Services},
    generation_output::Observations,
    generation_submission::Submission,
    generation_world::{generation_defaults, CreateWorld},
    native::NativeScratch,
    native_control::NativeControl,
    native_resources::NativeResources,
    record_store::Workspace,
};
use std::{io, path::Path, rc::Rc, time::Instant};

struct Observe {
    census: bool,
}
impl Observations for Observe {
    fn completed_state(
        &mut self,
        state: &atlas_generation::atlas::state::State,
        ancestry: Option<&[GenerationEpoch]>,
    ) -> ExecutionResult<()> {
        if !self.census {
            return Ok(());
        }
        let field = state.field();
        let places = state.people.places.borrow();
        let mut towns = Vec::new();
        let mut footprints = Vec::new();
        for place in places
            .known
            .iter()
            .filter(|p| p.abandoned.is_none() && p.absorbed_by.is_none())
        {
            towns.push(place.town_people.round() as u64);
            let mut residents = 0.0;
            for &cell in &place.cells {
                residents += field.people().people(cell)?
                    * atlas_generation::field::people::work::km2(field, cell);
            }
            footprints.push(residents.round() as u64);
        }
        towns.sort_unstable_by(|a, b| b.cmp(a));
        footprints.sort_unstable_by(|a, b| b.cmp(a));
        let ancestry = ancestry.map(|v| v.iter().map(|e| &e.id).collect::<Vec<_>>());
        println!(
            "{}",
            serde_json::json!({"eras":ancestry, "residents":atlas_generation::field::refinement::people::people_on(field)?.round() as u64, "towns":towns, "largest_settlement_footprint":footprints.first()})
        );
        Ok(())
    }
    fn diagnostic(&mut self, _: &Diagnostic) -> ExecutionResult<()> {
        Ok(())
    }
    async fn preview(&mut self, _: &Preview, _: Option<&[GenerationEpoch]>) -> ExecutionResult<()> {
        Ok(())
    }
}
fn main() -> io::Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [mode, root, width, height] if mode == "generate" => futures::executor::block_on(generate(
            Path::new(root),
            width.parse().map_err(io::Error::other)?,
            height.parse().map_err(io::Error::other)?,
            None,
        )),
        [mode, root, action] if mode == "history" => {
            futures::executor::block_on(generate(Path::new(root), 0., 0., Some(Path::new(action))))
        }
        [mode, root] if mode == "publish" => {
            futures::executor::block_on(publish::saved(Path::new(root)))
        }
        _ => Err(io::Error::other(
            "surface_capture history directory saved-action.json | generate directory width-metres height-metres | publish directory",
        )),
    }
}
async fn generate(root: &Path, width: f64, height: f64, action: Option<&Path>) -> io::Result<()> {
    std::fs::create_dir_all(root.join("resources"))?;
    let submission = if let Some(path) = action {
        let action: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
        let config: atlas_host::generation_application::Configuration =
            serde_json::from_value(action["request"].clone())?;
        let input = config.input(atlas_map::Id::NIL)?;
        let source = CreateWorld {
            id: config
                .world_id
                .ok_or_else(|| io::Error::other("Missing saved world id"))?,
            name: config.name.clone(),
            width: config.width,
            height: config.height,
            settings: input.settings,
            seed: input.seed,
            boundary_mode: None,
        }
        .create()?;
        Submission {
            input: config.input(source.scope.located.area_id)?,
            source,
        }
    } else {
        let source = CreateWorld {
            id: atlas_host::generation_world::random_id(),
            name: "Published surface verification".into(),
            seed: 104729,
            width,
            height,
            settings: None,
            boundary_mode: Some("cylinder".into()),
        }
        .create()?;
        let mut defaults: serde_json::Value = serde_json::from_str(&generation_defaults())?;
        let recipe = &mut defaults["recipe"];
        recipe.as_object_mut().unwrap().remove("schemaVersion");
        recipe["areaId"] = source.scope.located.area_id.into();
        recipe["quality"] = "draft".into();
        Submission {
            source,
            input: serde_json::from_value(recipe.clone())?,
        }
    };
    let resources = Rc::new(NativeResources::new(root.join("resources")));
    let cache = BlockCache::with_memory(
        atlas_host::host_memory::generation_budget()?,
        BlockScratch::new(NativeScratch::create_new(root.join("work.blocks"))?),
    );
    let records = Workspace::open(Rc::new(atlas_gis::sql::Database::open(
        root.join("records.sqlite"),
    )?))?;
    let spatial = Rc::new(NativeGeos::new(1e-6).map_err(io::Error::other)?);
    let control = NativeControl::new(CancellationToken::default(), |p| {
        if p.message.starts_with("Starting ") {
            eprintln!("{}", p.message);
        }
    });
    let started = Instant::now();
    let mut checkpoint = action
        .map(|_| atlas_host::job_files::JobFiles::new(root, "history"))
        .transpose()?;
    let finished = generation_execution::run(
        submission,
        "surface-check",
        Services {
            experiment: None,
            resources,
            spatial,
            cache,
            records: &records,
            progress: Rc::new(|_, message| eprintln!("{message}")),
            completed_at: || "2026-11-17T00:00:00Z".into(),
            recovery: checkpoint
                .as_mut()
                .map(|files| files as &mut dyn atlas_generation::checkpoint::Recovery),
        },
        &control,
        Observe {
            census: action.is_some(),
        },
        &mut NativeResources::new(root.join("resources")),
    )
    .await?;
    if let Some(files) = checkpoint {
        files.retire_checkpoint()?;
    }
    eprintln!("Generation and capture: {:?}", started.elapsed());
    let saved = publish::Saved {
        document: finished.snapshot,
        geography: finished.output.geography,
    };
    std::fs::write(root.join("completed.json"), serde_json::to_vec(&saved)?)?;
    if action.is_some() {
        return Ok(());
    }
    drop(records);
    publish::saved(root).await
}
