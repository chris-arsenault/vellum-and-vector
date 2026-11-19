//! Population-only workload for the local atlas harness, on its retained world.
use atlas_generation::{
    answers::QuestionBook,
    atlas::context::{Epoch, HumanEra},
    execution::{ExecutionError, ExecutionResult, Executor},
    field::{
        inheritance::{self, Inputs},
        people::{classifier, era_places, land_processes, questions, travel, work},
        Field, FieldSeed,
    },
    lattice::WorldLatticeOptions,
    rock::ground::observers::GroundObservers,
    scale::MapScale,
    storage::{BlockCache, BlockScratch, Coverage, SharedCache},
};
use atlas_gis::geometry::NativeGeos;
use atlas_host::{
    native::NativeScratch,
    native_resources::NativeResources,
    numerical_resource::{Store, WorkingSet},
};
use atlas_map::{Bounds, MapRef};
use serde::Deserialize;
use std::{collections::BTreeMap, fs, io, path::Path, rc::Rc};

#[derive(Deserialize)]
struct Kept {
    reference: MapRef,
}
#[derive(Deserialize)]
struct Action {
    request: Request,
}
#[derive(Deserialize)]
struct Request {
    recipe: Recipe,
}
#[derive(Deserialize)]
struct Recipe {
    parameters: Parameters,
    settings: History,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Parameters {
    city_reach: f64,
    town_threshold: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct History {
    epochs: Vec<Epoch>,
    human_eras: Vec<HumanEra>,
}

fn captured(root: &Path, reference: &MapRef, cache: SharedCache) -> io::Result<Inputs> {
    let store = Rc::new(NativeResources::new(root.into()));
    let mut reader = WorkingSet::new(store.clone(), cache);
    let mut parent = BTreeMap::new();
    let mut surface = None;
    let layout = format!("{}:layout:0", reference.revision);
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let id = entry.file_name();
        let Some(id) = id.to_str().filter(|s| uuid::Uuid::parse_str(s).is_ok()) else {
            continue;
        };
        let descriptor = store.describe(id)?;
        let Some(field) = descriptor.field else {
            continue;
        };
        if descriptor.scope.area_id != reference.map_id || field.layout_resource_id != layout {
            continue;
        }
        let names: Vec<_> = field.channels.into_keys().collect();
        let resource = reader.load(id, &names)?;
        if resource.channels.contains_key("Elevation") {
            surface = Some(resource.clone());
        }
        for name in names {
            parent.insert(name, resource.clone());
        }
    }
    Ok(Inputs {
        surface: surface
            .ok_or_else(|| io::Error::other("Kept revision has no captured elevation"))?,
        parent,
    })
}

fn run(home: &Path, reference_width: bool) -> ExecutionResult<()> {
    let reference = serde_json::from_slice::<Kept>(&fs::read(home.join("world.json"))?)
        .map_err(io::Error::other)?
        .reference;
    let root = home.join("generation-resources");
    let recipe = serde_json::from_slice::<Action>(&fs::read(
        root.join(".jobs")
            .join(reference.revision.to_string())
            .join("action.json"),
    )?)
    .map_err(io::Error::other)?
    .request
    .recipe;
    let scratch =
        NativeScratch::create_new(std::env::temp_dir().join(uuid::Uuid::new_v4().to_string()))?;
    let cache = BlockCache::with_memory(
        atlas_host::host_memory::generation_budget()?,
        BlockScratch::new(scratch),
    );
    let inputs = captured(&root, &reference, cache.clone())?;
    let grid = &inputs.surface.grid;
    let [west, south, east, north] = grid.bounds;
    let width = east - west;
    let height = north - south;
    let span = inputs
        .surface
        .resolution
        .ok_or_else(|| io::Error::other("Missing world resolution"))?;
    let factor = if reference_width {
        MapScale::REFERENCE_WIDTH / width
    } else {
        1.0
    };
    let cells = width * height * factor.powi(2) / span.powi(2);
    let lattice = |scale: f64| {
        WorldLatticeOptions {
            wrap_x: grid.periodic_width.is_some(),
            coordinate_width: grid.periodic_width.map(|period| period * scale),
            ..Default::default()
        }
        .build(
            Bounds(west * scale, south * scale, east * scale, north * scale),
            cells,
            0.0,
            |_, _| true,
        )
        .map(Rc::new)
        .map_err(io::Error::other)
    };
    let source_mesh = lattice(1.)?;
    let mesh = if reference_width {
        lattice(factor)?
    } else {
        source_mesh.clone()
    };
    if mesh.len() != source_mesh.len() {
        return Err(io::Error::other("Census charts have different cell layouts").into());
    }
    println!(
        "Census on {:.0} × {:.0} km, {} cells",
        width * factor / 1000.,
        height * factor / 1000.,
        mesh.len()
    );
    let mut seed = FieldSeed::new(
        mesh.clone(),
        MapScale::new(width * factor, height * factor, mesh.spacing()).map_err(io::Error::other)?,
        cache.clone(),
    );
    let spatial = NativeGeos::new(1e-6).map_err(io::Error::other)?;
    let mut imported = Coverage::new(source_mesh.clone(), cache);
    let samples = inputs.sample_all(&source_mesh, &mut imported, &spatial)?;
    samples.import_seed(&mut seed, &mesh)?;
    let datum = |name: &str| {
        inputs
            .source(name)
            .channels
            .get(name)
            .ok_or_else(|| io::Error::other(name.to_owned()))?
            .values
            .get(0)
    };
    seed.ground.sea_level = datum("EffectiveSeaLevel")?;
    let mut executor = Executor::new(seed.finish(Box::<GroundObservers>::default())?);
    executor.run_with(
        &inheritance::complete(),
        &inheritance::Completion {
            samples: &samples,
            base_sea_level: datum("BaseSeaLevel")?,
            effective_sea_level: datum("EffectiveSeaLevel")?,
            retained_rivers: None,
        },
    )?;
    let rivers = travel::river_orders(vec![]);
    let mut book = QuestionBook::default();
    atlas_generation::atlas::questions::register_people(&mut book, rivers.clone())?;
    let questions = Rc::new(questions::Questions::new(Rc::new(book)));
    questions.select(&mut executor);
    executor.select(&rivers);
    let operations = land_processes::Operations::new(
        questions.clone(),
        Rc::new(Field::human_operations()),
        rivers.clone(),
    );
    let census = |executor: &Executor<Field>, label: &str| -> ExecutionResult<()> {
        let field = executor.state();
        let travel = travel::Travel::new(
            field,
            executor.query(&questions.friction)?.values(),
            executor.query(&questions.climbing)?.values(),
            executor.query(&rivers)?,
        )?;
        let presence = executor.query(&questions.presence)?.values();
        let range = travel::length(field, recipe.parameters.city_reach)?;
        let background = era_places::surrounding_density(field, &travel, range, &presence)?;
        let zones = classifier::dense_zones(
            field,
            &background.read_only(),
            recipe.parameters.town_threshold,
            Some(&presence),
        )?;
        let mut total = 0.;
        for cell in 0..mesh.len() {
            total += field.people().people(cell)? * work::km2(field, cell);
        }
        let top: Vec<_> = zones
            .iter()
            .take(3)
            .map(|z| z.town_people.round() as u64)
            .collect();
        println!(
            "{label}: population {total:.0}, {} settlements above {:.0}, largest {top:?}",
            zones.len(),
            recipe.parameters.town_threshold
        );
        let mut bands = [0; 7];
        for zone in &zones {
            let band = [10_000., 50_000., 100_000., 300_000., 500_000., 2_000_000.]
                .partition_point(|&minimum| zone.town_people >= minimum);
            bands[band] += 1;
        }
        println!("  Reported settlements by population (<10k, 10–50k, 50–100k, 100–300k, 300–500k, 500k–2m, 2m+): {bands:?}");
        Ok(())
    };
    census(&executor, "Captured terrain and people")?;
    let present = recipe.settings.epochs.last().map(|e| e.id.as_str());
    for era in recipe.settings.human_eras {
        if era.physical_epoch.is_some()
            && era
                .bound_epoch(&recipe.settings.epochs)
                .map(|e| e.id.as_str())
                != present
        {
            continue;
        }
        executor.run_with(
            &operations.era,
            &land_processes::Era {
                years: era.years,
                mobility: era.mobility,
            },
        )?;
        census(&executor, &era.id)?;
    }
    Ok(())
}
fn main() -> Result<(), ExecutionError> {
    let home = std::env::args_os()
        .nth(1)
        .ok_or_else(|| io::Error::other("Expected local atlas directory"))?;
    run(
        Path::new(&home),
        std::env::args_os().nth(2).as_deref() == Some("--reference-width".as_ref()),
    )
}
