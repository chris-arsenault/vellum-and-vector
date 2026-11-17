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

struct Observe;
impl Observations for Observe {
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
        )),
        [mode, root] if mode == "publish" => {
            futures::executor::block_on(publish::saved(Path::new(root)))
        }
        _ => Err(io::Error::other(
            "surface_capture generate directory width-metres height-metres | publish directory",
        )),
    }
}
async fn generate(root: &Path, width: f64, height: f64) -> io::Result<()> {
    std::fs::create_dir_all(root.join("resources"))?;
    let source = CreateWorld {
        id: uuid::Uuid::new_v4().to_string(),
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
    recipe["areaId"] = source.scope.located.area_id.clone().into();
    recipe["quality"] = "draft".into();
    let submission = Submission {
        source,
        input: serde_json::from_value(recipe.clone())?,
    };
    let resources = Rc::new(NativeResources::new(root.join("resources")));
    let cache = BlockCache::new(
        256 * 1024 * 1024,
        BlockScratch::new(NativeScratch::create_new(root.join("work.blocks"))?),
    );
    let records = Workspace::create(root.join("records.sqlite"))?;
    let spatial = Rc::new(NativeGeos::new(1e-6).map_err(io::Error::other)?);
    let control = NativeControl::new(CancellationToken::default(), |p| {
        if p.message.starts_with("Starting ") {
            eprintln!("{}", p.message);
        }
    });
    let started = Instant::now();
    let finished = generation_execution::run(
        submission,
        "surface-check",
        Services {
            resources,
            spatial,
            cache,
            records: &records,
            progress: Rc::new(|_, message| eprintln!("{message}")),
            completed_at: || "2026-11-17T00:00:00Z".into(),
            recovery: None,
        },
        &control,
        Observe,
        &mut NativeResources::new(root.join("resources")),
    )
    .await?;
    eprintln!("Generation and capture: {:?}", started.elapsed());
    let saved = publish::Saved {
        document: finished.snapshot,
        geography: finished.output.geography,
    };
    std::fs::write(root.join("completed.json"), serde_json::to_vec(&saved)?)?;
    drop(records);
    publish::saved(root).await
}
