//! Runtime inputs and saved results for native local-atlas experiments.
mod land_use;
mod measure;
mod native;
mod render;
mod search;

use super::{read_json, slug, write_json, Harness, Options};
use atlas_generation::atlas::dispatch::{
    experiment::{supported, Change, Target},
    specifications::Catalogue,
};
use atlas_map::{MapDescriptor, MapRef};
use measure::{Measure, Observation};
use search::Search;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::Instant,
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Spec {
    name: String,
    source: Source,
    observe: Measure,
    only: Option<Vec<Target>>,
    #[serde(default)]
    changes: Vec<Change>,
    search: Option<Search>,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Source {
    Inspect {
        maps: Vec<String>,
    },
    Captured {
        map: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        revision: Option<atlas_map::Id>,
        configuration: Option<PathBuf>,
    },
    Job {
        id: atlas_map::Id,
    },
    Create {
        configuration: PathBuf,
    },
}

#[derive(Deserialize, Serialize)]
struct Trial {
    label: String,
    value: Option<f64>,
    seconds: f64,
    reference: Option<MapRef>,
    changes: Vec<Change>,
    observations: Vec<Observation>,
    error: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct Results {
    name: String,
    channel: String,
    parameter: Option<String>,
    metric: measure::Metric,
    trials: Vec<Trial>,
    bracket: Option<[f64; 2]>,
    error: Option<String>,
}

pub(super) fn command(harness: &Harness, options: &Options) -> io::Result<()> {
    match (options.positional(1), options.positional(2)) {
        (Some("processes"), None) => processes(),
        (Some("run"), Some(path)) => run(harness, Path::new(path)),
        (Some("land-use"), Some(path)) => {
            let distance = options.get("near").unwrap_or("300").parse().map_err(io::Error::other)?;
            land_use::inspect(Path::new(path), distance)
        }
        (Some("render"), Some(path)) => {
            let path = Path::new(path);
            let results: Results = read_json(path)?;
            let metric = options.get("metric").map(measure::Metric::parse).transpose()?;
            let logarithmic = match options.get("colors").unwrap_or("linear") {
                "linear" => false,
                "log" => true,
                _ => return Err(io::Error::other("Use --colors linear or --colors log")),
            };
            render::write(&results, path.parent().unwrap_or(Path::new(".")), metric, logarithmic)
        }
        _ => Err(io::Error::other("Usage: local_atlas experiment processes | run <experiment.json> | render <results.json> | land-use <trial-directory> [--near metres]")),
    }
}

fn processes() -> io::Result<()> {
    let catalogue = Catalogue::atlas(
        &Default::default(),
        &[],
        &Default::default(),
        &Default::default(),
        true,
    )?;
    let processes: Vec<_> = catalogue
        .inventory()
        .filter(|spec| supported(spec))
        .map(|spec| {
            json!({
                "process": spec.contract.id,
                "version": spec.contract.version,
                "category": spec.category.name(),
                "numeric": spec.numeric,
            })
        })
        .collect();
    println!("{}", serde_json::to_string_pretty(&processes)?);
    Ok(())
}

fn run(harness: &Harness, path: &Path) -> io::Result<()> {
    let mut spec: Spec = read_json(path)?;
    let path = path.canonicalize()?;
    let configuration = match &mut spec.source {
        Source::Create { configuration } => Some(configuration),
        Source::Captured { configuration, .. } => configuration.as_mut(),
        _ => None,
    };
    if let Some(configuration) = configuration {
        *configuration = path
            .parent()
            .unwrap()
            .join(&*configuration)
            .canonicalize()?;
    }
    if let Some(search) = &spec.search {
        search.validate()?;
    }
    if matches!(spec.source, Source::Inspect { .. })
        && (spec.only.is_some() || !spec.changes.is_empty() || spec.search.is_some())
    {
        return Err(io::Error::other(
            "Saved-map inspections take measurements only",
        ));
    }
    let directory = harness.reports.join("experiments").join(format!(
        "{}-{}",
        slug(&spec.name, &['-']),
        uuid::Uuid::new_v4().simple()
    ));
    fs::create_dir_all(&directory)?;
    write_json(&directory.join("experiment.json"), &spec)?;
    let mut results = Results {
        name: spec.name.clone(),
        channel: spec.observe.channel.clone(),
        parameter: spec.search.as_ref().map(|search| search.parameter().into()),
        metric: spec
            .search
            .as_ref()
            .and_then(Search::metric)
            .unwrap_or_default(),
        trials: Vec::new(),
        bracket: None,
        error: None,
    };
    println!("{}", directory.display());
    let execution = execute(harness, &spec, &directory, &mut results);
    results.error = execution.err().map(|error| error.to_string());
    write_json(&directory.join("results.json"), &results)?;
    render::write(&results, &directory, None, false)?;
    if let Some(error) = results.error {
        return Err(io::Error::other(error));
    }
    if results.trials.iter().any(|trial| trial.error.is_some()) {
        return Err(io::Error::other(
            "Some trials failed. See results.json and measurements.csv",
        ));
    }
    Ok(())
}

fn execute(
    harness: &Harness,
    spec: &Spec,
    directory: &Path,
    results: &mut Results,
) -> io::Result<()> {
    if let Source::Inspect { maps } = &spec.source {
        return measure::inspect(harness, maps, &spec.observe, results);
    }
    let input = native::Input::load(harness, &spec.source, directory)?;
    let footprint = spec
        .observe
        .footprint
        .as_ref()
        .map(|name| map(harness, name))
        .transpose()?;
    let metric = results.metric;
    let mut run = |change: Option<Change>| {
        let value = change.as_ref().map(|change| change.value);
        let mut trial = Trial {
            label: value.map_or_else(|| "configured run".into(), |value| value.to_string()),
            value,
            seconds: 0.,
            reference: input.reference().cloned(),
            changes: spec.changes.iter().cloned().chain(change).collect(),
            observations: Vec::new(),
            error: None,
        };
        let folder = directory.join(format!("trial-{}", results.trials.len() + 1));
        let started = Instant::now();
        eprintln!("Trial {} ({})", results.trials.len() + 1, trial.label);
        if let Err(error) = native::run(&input, spec, footprint.as_ref(), &folder, &mut trial) {
            eprintln!("{error}");
            trial.error = Some(error.to_string());
        }
        trial.seconds = started.elapsed().as_secs_f64();
        let measured = trial
            .error
            .is_none()
            .then(|| trial.observations.last()?.metrics.get(metric))
            .flatten();
        results.trials.push(trial);
        // Retain earlier trials if a later run is interrupted.
        write_json(&directory.join("results.json"), results)?;
        Ok(measured)
    };
    if let Some(search) = &spec.search {
        results.bracket = search.run(&mut run)?;
    } else {
        run(None)?;
    }
    Ok(())
}

fn map(harness: &Harness, name: &str) -> io::Result<MapDescriptor> {
    if name == "world" {
        let kept: super::Kept = read_json(&harness.world_file())?;
        return open_revision(harness, &kept.reference);
    }
    read_json(&harness.map_folder(name).join("map.json"))
}

fn open_revision(harness: &Harness, reference: &MapRef) -> io::Result<MapDescriptor> {
    if let Ok(url) = std::env::var("ATLAS_EXPERIMENT_MAP_URL") {
        return atlas_gis::postgres_maps::PostgresMaps::connect(&url)?.open(reference);
    }
    Ok(serde_json::from_value(harness.open(reference)?)?)
}
