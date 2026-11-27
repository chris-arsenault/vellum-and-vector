//! The local atlas harness (docs/local-atlas.md). It drives the native server's generation
//! and map services the way the frontend does: one kept verification world, maps refined
//! from it, and each map's report and pictures read from its published GIS storage.
mod client;
mod experiment;
mod follow;
mod picture;
mod report;
mod town;

use atlas_generation::GenerationStatus;
use atlas_map::MapRef;
use client::Server;
use follow::{Ended, LastJob, Picture};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    env, fs, io,
    path::{Path, PathBuf},
    process::Command,
};

pub struct Harness {
    pub server: Server,
    /// The checkout that built this harness; reports and pictures go under it.
    checkout: PathBuf,
    /// The one atlas every worktree shares, in the main checkout.
    pub home: PathBuf,
    /// Process status, logs and the last followed job belong to one listener.
    runtime: PathBuf,
    pub reports: PathBuf,
}
impl Harness {
    fn new() -> io::Result<Self> {
        let checkout = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()?;
        let common = Command::new("git")
            .arg("-C")
            .arg(&checkout)
            .args(["rev-parse", "--git-common-dir"])
            .output()?;
        let common = String::from_utf8_lossy(&common.stdout).trim().to_owned();
        let main = checkout.join(common).join("..").canonicalize()?;
        let home = env::var_os("ATLAS_LOCAL_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| main.join(".artifacts/local-atlas"));
        let port = env::var("ATLAS_LOCAL_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(44138);
        // The launcher names the address it bound: loopback, or a development node's LAN.
        let host = env::var("ATLAS_LOCAL_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let runtime = env::var_os("ATLAS_SERVER_RUNTIME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let listener = home.join("listeners").join(port.to_string());
                if listener.is_dir() {
                    listener
                } else {
                    home.clone()
                }
            });
        Ok(Self {
            server: Server::new(&host, port),
            reports: checkout.join(".artifacts/local-atlas"),
            checkout,
            home,
            runtime,
        })
    }
    fn world_file(&self) -> PathBuf {
        self.home.join("world.json")
    }
    pub fn last_job_file(&self) -> PathBuf {
        self.runtime.join("last-job.json")
    }
    fn map_folder(&self, name: &str) -> PathBuf {
        self.reports.join("maps").join(slug(name, &['.', '-']))
    }
    fn existing_map(&self, name: &str) -> PathBuf {
        let local = self.reports.join("maps").join(name);
        if local.join("map.json").is_file() {
            local
        } else {
            self.home.join("maps").join(name)
        }
    }
    fn generation<T: DeserializeOwned>(&self, method: &str, request: Value) -> io::Result<T> {
        self.server
            .call("generation", &json!({"method": method, "request": request}))
    }
    fn open(&self, reference: &MapRef) -> io::Result<Value> {
        self.server
            .call("maps/read", &json!({"method": "open", "args": [reference]}))
    }
}

/// Text with each run of other characters replaced by one `-`; letters, digits, `_` and
/// the `keep` characters stay.
pub fn slug(text: &str, keep: &[char]) -> String {
    let mut out = String::new();
    let mut joined = false;
    for c in text.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || keep.contains(&c) {
            out.push(c);
            joined = false;
        } else if !joined {
            out.push('-');
            joined = true;
        }
    }
    out
}
pub fn read_json<T: DeserializeOwned>(path: &Path) -> io::Result<T> {
    serde_json::from_slice(&fs::read(path)?).map_err(io::Error::other)
}
pub fn write_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    fs::write(path, serde_json::to_vec_pretty(value)?)
}

#[derive(Serialize, Deserialize)]
struct Kept {
    reference: MapRef,
}

/// Options after the command: `--name value` pairs and the flags that take no value.
struct Options {
    positionals: Vec<String>,
    // hpc-exempt: command-line options by name.
    values: BTreeMap<String, String>,
}
const FLAGS: [&str; 5] = [
    "fresh",
    "reference-width",
    "full-history",
    "outline",
    "capture-only",
];
impl Options {
    fn parse(arguments: impl Iterator<Item = String>) -> io::Result<Self> {
        let mut positionals = Vec::new();
        let mut values = BTreeMap::new();
        let mut arguments = arguments.peekable();
        while let Some(argument) = arguments.next() {
            match argument.strip_prefix("--") {
                Some(flag) if FLAGS.contains(&flag) => {
                    values.insert(flag.to_owned(), "true".to_owned());
                }
                Some(name) => {
                    let value = arguments
                        .next()
                        .ok_or_else(|| io::Error::other(format!("--{name} needs a value")))?;
                    values.insert(name.to_owned(), value);
                }
                None => positionals.push(argument),
            }
        }
        Ok(Self {
            positionals,
            values,
        })
    }
    fn get(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }
    fn flag(&self, name: &str) -> bool {
        self.values.contains_key(name)
    }
    fn positional(&self, index: usize) -> Option<&str> {
        self.positionals.get(index).map(String::as_str)
    }
}

const HEX_METRES: [(&str, f64); 6] = [
    ("1.5m", 1.5),
    ("3m", 3.),
    ("10m", 10.),
    ("30m", 30.),
    ("100m", 100.),
    ("300m", 300.),
];

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
fn run() -> io::Result<()> {
    let options = Options::parse(env::args().skip(1))?;
    let harness = Harness::new()?;
    let argument = options.positional(1);
    match (options.positional(0), argument) {
        (Some("world"), _) if options.get("name").is_some() => {
            named_world(&harness, options.get("name").unwrap_or_default(), &options)
        }
        (Some("world"), _) => world(&harness, options.flag("fresh")),
        (Some("running"), None) => {
            let jobs: Vec<GenerationStatus> = harness.generation("jobs", Value::Null)?;
            for job in jobs
                .iter()
                .filter(|job| job.state == atlas_generation::GenerationState::Running)
            {
                println!("{} {}", job.job_id, job.step);
            }
            Ok(())
        }
        (Some("real"), _) if options.get("at").is_some() => real_scale(&harness, &options),
        (Some("city"), _) if options.get("at").is_some() => real_scale(&harness, &options),
        (Some("region"), _)
            if options.get("at").is_some()
                && (options.get("width").is_some() || options.flag("outline")) =>
        {
            real_scale(&harness, &options)
        }
        (Some("resume"), job) => resume(&harness, job, options.get("name")),
        (Some("cancel"), Some(job)) => harness
            .generation::<Value>("cancel", json!({"job_id": job}))
            .map(drop),
        (Some("places"), _) => places(&harness, options.get("parent")),
        (Some("census"), _) => census(&harness, &options),
        // owner-direction(2026-11-25): dynamic process experiments belong in the existing harness with no Web UI
        (Some("experiment"), _) => experiment::command(&harness, &options),
        (Some("town-previews"), Some(job)) => town_previews(&harness, job, options.get("name")),
        (Some("history"), Some(name)) => history(&harness, name),
        (Some("city-view-inputs"), Some(name)) => city_view_inputs(&harness, name),
        (Some("raster"), Some(name)) if options.positionals.len() > 2 => {
            raster(&harness, name, &options.positionals[2..])
        }
        (Some("summary"), Some(name)) => {
            let directory = harness.reports.join("maps").join(name);
            let kept: Kept = read_json(&directory.join("map.json"))?;
            report::report(&harness.server, &kept.reference, &directory)
        }
        _ => {
            eprintln!("{}", usage(&harness));
            std::process::exit(2);
        }
    }
}
fn usage(harness: &Harness) -> String {
    let maps = harness.reports.join("maps");
    format!(
        "Usage: scripts/local-atlas.sh <command>
  world [--fresh]
  world --name name [--width metres] [--height metres] [--quality draft|standard|fine] [--seed n]
  places [--parent world folder]
  census [--reference-width] [--full-history [--seed <integer>]]
  experiment processes | run <experiment.json> | render <results.json> [--metric <name>] [--colors linear|log]
  summary|history <map folder under {maps}>
  city-view-inputs <published City map folder>
  raster <map folder> <layer id>...
  real --at x,y|Settlement [--hex 100m] [--across 50] [--kind ground|structure]
       [--detail draft|standard|fine] [--name name] [--parent map folder]
       [--template template-name] [--major-work work-type]
       [--until \"<stage picture label, e.g. Initial regional detail>\"]
  region --at x,y|Settlement --width metres --name name [--parent map folder]
  region --at x,y|Settlement --outline [--choice n] --name name [--parent map folder]
  city --at Settlement --name name [--parent map folder] [--capture-only]
  real --outline [--choice n] --at x,y|Settlement --parent city map folder --name name
       [--hex 30m] opens a district of a city map as its own map
  running
  cancel <jobId>
  resume [jobId] [--name map folder]
  town-previews <jobId> [--name <existing map folder>]
Hex sizes: {sizes}",
        maps = maps.display(),
        sizes = HEX_METRES.map(|(name, _)| name).join(", ")
    )
}

/// A named world of a chosen size, kept as a map folder beside the kept world, which it
/// leaves untouched; regions refine it with `region --parent <name>`.
fn named_world(harness: &Harness, name: &str, options: &Options) -> io::Result<()> {
    let metres = |key: &str, default: f64| -> io::Result<f64> {
        options
            .get(key)
            .map_or(Ok(default), |value| value.parse().map_err(io::Error::other))
    };
    let choices: Vec<Value> = harness.generation("configurations", Value::Null)?;
    let choice = choices
        .first()
        .ok_or_else(|| io::Error::other("The server offers no world configuration"))?;
    let mut request = choice["values"].clone();
    request["name"] = json!(name);
    request["worldId"] = json!(uuid::Uuid::new_v4().to_string());
    request["width"] = json!(metres("width", 4_000_000.0)?);
    request["height"] = json!(metres("height", 3_000_000.0)?);
    request["recipe"]["quality"] = json!(options.get("quality").unwrap_or("draft"));
    request["recipe"]["seed"] = json!(metres("seed", 42.0)? as u64);
    let configuration: Value = harness.generation("validate", request)?;
    let status: GenerationStatus = harness.generation("create", configuration)?;
    let record = LastJob {
        kind: "world".into(),
        name: Some(name.into()),
        job_id: None,
    };
    if let Ended::Completed(reference) = follow::follow(harness, status, record, None)? {
        save(harness, &reference)?;
        let directory = harness.reports.join("maps").join(name);
        fs::create_dir_all(&directory)?;
        write_json(
            &directory.join("map.json"),
            &Kept {
                reference: reference.clone(),
            },
        )?;
        report::report(&harness.server, &reference, &directory)?;
    }
    Ok(())
}
fn world(harness: &Harness, fresh: bool) -> io::Result<()> {
    if !fresh {
        if let Ok(kept) = read_json::<Kept>(&harness.world_file()) {
            if let Ok(map) = harness.open(&kept.reference) {
                println!(
                    "Kept world: {} {}",
                    map["name"].as_str().unwrap_or_default(),
                    serde_json::to_string(&kept.reference)?
                );
                return Ok(());
            }
        }
    }
    let choices: Vec<Value> = harness.generation("configurations", Value::Null)?;
    let choice = choices
        .first()
        .ok_or_else(|| io::Error::other("The server offers no world configuration"))?;
    let mut request = choice["values"].clone();
    request["name"] = json!("Local verification world");
    request["worldId"] = json!(uuid::Uuid::new_v4().to_string());
    request["width"] = json!(1_000_000);
    request["height"] = json!(750_000);
    request["recipe"]["quality"] = json!("draft");
    request["recipe"]["seed"] = json!(42);
    let configuration: Value = harness.generation("validate", request)?;
    let status: GenerationStatus = harness.generation("create", configuration)?;
    let record = LastJob {
        kind: "world".into(),
        name: None,
        job_id: None,
    };
    if let Ended::Completed(reference) = follow::follow(harness, status, record, None)? {
        keep_world(harness, &reference)?;
    }
    Ok(())
}
fn keep_world(harness: &Harness, reference: &MapRef) -> io::Result<()> {
    save(harness, reference)?;
    write_json(
        &harness.world_file(),
        &Kept {
            reference: reference.clone(),
        },
    )?;
    report::report(&harness.server, reference, &harness.reports.join("world"))
}

/// Keeps the map in the server library, as Save map does.
fn save(harness: &Harness, reference: &MapRef) -> io::Result<()> {
    let saved: Option<Value> = harness.server.call(
        "maps/library",
        &json!({"method": "find", "args": [reference.map_id]}),
    )?;
    let saved = saved.unwrap_or(Value::Null);
    if saved["reference"]["revision"] == json!(reference.revision) {
        return Ok(());
    }
    let or = |value: &Value, default: Value| {
        if value.is_null() {
            default
        } else {
            value.clone()
        }
    };
    harness.server.call::<Value>(
        "maps/library",
        &json!({"method": "save", "args": [{
            "reference": reference,
            "expectedVersion": saved["version"],
            "navigation": or(&saved["navigation"], json!({"version": 0, "regions": [], "views": []})),
            "settings": or(&saved["settings"], json!({})),
        }]}),
    )?;
    Ok(())
}

struct Place {
    id: atlas_map::Id,
    name: String,
    position: [f64; 2],
    population: f64,
    /// Its built ground, square kilometres.
    built_km2: f64,
    /// Its role (capital, market town, settlement) and the kind of site it stands on.
    role: String,
    site: String,
}
/// The map's settlements, largest first, each with the point it is drawn at.
fn settlements(harness: &Harness, reference: &MapRef) -> io::Result<Vec<Place>> {
    let map = harness.open(reference)?;
    let space = map["primarySpaceId"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let mut places = Vec::new();
    report::features(
        &harness.server,
        reference,
        &space,
        Some(&["vector:settlements"]),
        |feature| {
            if let atlas_map::Geometry::Point { coordinates } = feature.geometry {
                let [x, y, _] = coordinates.coordinates();
                let number = |key: &str| {
                    feature
                        .attributes
                        .get(key)
                        .and_then(|p| p.as_f64().or_else(|| p.as_str()?.parse().ok()))
                        .unwrap_or(0.)
                };
                let text = |key: &str| {
                    feature
                        .attributes
                        .get(key)
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
                        .to_owned()
                };
                places.push(Place {
                    id: feature.id,
                    name: feature.name.clone().unwrap_or_default(),
                    position: [x, y],
                    population: number("population"),
                    built_km2: number("builtKm2"),
                    role: text("settlementRole"),
                    site: text("siteKind"),
                });
            }
        },
    )?;
    places.sort_by(|a, b| b.population.total_cmp(&a.population));
    Ok(places)
}
/// `x,y` in world metres, or the name of one of the map's settlements.
fn point(harness: &Harness, reference: &MapRef, at: &str) -> io::Result<[f64; 2]> {
    let numbers: Vec<f64> = at
        .split(',')
        .filter_map(|n| n.trim().parse().ok())
        .collect();
    if let [x, y] = numbers[..] {
        if at.split(',').count() == 2 {
            return Ok([x, y]);
        }
    }
    settlements(harness, reference)?
        .into_iter()
        .find(|place| place.name == at)
        .map(|place| place.position)
        .ok_or_else(|| {
            io::Error::other(format!(
                "No settlement named {at}; run scripts/local-atlas.sh places"
            ))
        })
}
fn places(harness: &Harness, parent: Option<&str>) -> io::Result<()> {
    let file = match parent {
        Some(name) => harness.reports.join("maps").join(name).join("map.json"),
        None => harness.world_file(),
    };
    let kept: Kept = read_json(&file)?;
    println!(
        "{:<28} {:>17} {:>10} {:>9} {:>10}  {:<11} site",
        "place", "position", "people", "built km2", "per km2", "role"
    );
    for place in settlements(harness, &kept.reference)? {
        println!(
            "{:<28} {:>17} {:>10} {:>9.1} {:>10.0}  {:<11} {}",
            place.name,
            format!(
                "{},{}",
                place.position[0].round(),
                place.position[1].round()
            ),
            place.population,
            place.built_km2,
            place.population / place.built_km2.max(f64::EPSILON),
            place.role,
            place.site
        );
    }
    Ok(())
}

/// The parent map's first region choice at a point, as the viewer offers it on a click,
/// with its outline's bounds. It is refined as a new region of the parent.
fn region_at(
    harness: &Harness,
    reference: &MapRef,
    space: Value,
    [x, y]: [f64; 2],
    choice: Option<usize>,
) -> io::Result<(Value, [f64; 4])> {
    let map = harness.open(reference)?;
    let choices: Value = harness.server.call(
        "maps/navigation",
        &json!({"method": "choices", "args": [
            reference,
            {"version": 0, "regions": [], "views": []},
            {"spaceId": space, "parentId": null, "editingId": null, "position": [x, y],
             "viewport": map["bounds"], "cuts": []},
        ]}),
    )?;
    let candidates = choices["candidates"]
        .as_array()
        .filter(|all| !all.is_empty())
        .ok_or_else(|| io::Error::other("The parent map offers no region at that point"))?;
    fn visit(value: &Value, bounds: &mut [f64; 4]) {
        match value.as_array() {
            Some(pair) if pair.len() >= 2 && pair[0].is_number() => {
                let (x, y) = (pair[0].as_f64().unwrap(), pair[1].as_f64().unwrap());
                *bounds = [
                    bounds[0].min(x),
                    bounds[1].min(y),
                    bounds[2].max(x),
                    bounds[3].max(y),
                ];
            }
            Some(items) => items.iter().for_each(|item| visit(item, bounds)),
            None => {}
        }
    }
    let extent = |candidate: &Value| {
        let mut bounds = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        visit(&candidate["geometry"]["coordinates"], &mut bounds);
        bounds
    };
    for (index, candidate) in candidates.iter().enumerate() {
        let b = extent(candidate);
        println!(
            "  choice {index}: {} ({:.0} × {:.0} m)",
            candidate["name"].as_str().unwrap_or("unnamed"),
            b[2] - b[0],
            b[3] - b[1]
        );
    }
    let Some(index) = choice.filter(|&n| n < candidates.len()) else {
        return Err(io::Error::other(
            "Choose one of these regions with --choice n",
        ));
    };
    let candidate = &candidates[index];
    let bounds = extent(candidate);
    println!(
        "Refining choice {index}, {}",
        candidate["name"].as_str().unwrap_or("unnamed")
    );
    let region = json!({
        "id": uuid::Uuid::new_v4().to_string(), "name": candidate["name"], "spaceId": space,
        "parentId": null, "geometry": candidate["geometry"], "child": null,
    });
    Ok((region, bounds))
}
/// With `--outline`, the parent's own region at the point, refined as its organic outline.
fn outline_choice(
    harness: &Harness,
    options: &Options,
    reference: &MapRef,
    parent: &Value,
    point: [f64; 2],
) -> io::Result<Option<(Value, [f64; 4])>> {
    if !options.flag("outline") {
        return Ok(None);
    }
    let choice = options
        .get("choice")
        .map(|n| n.parse().map_err(io::Error::other))
        .transpose()?;
    region_at(
        harness,
        reference,
        parent["primarySpaceId"].clone(),
        point,
        choice,
    )
    .map(Some)
}
/// What the refine request selects: a region's outline (a district when `real`), a city
/// map at a settlement, a real-scale map at a point, or a drawn rectangle.
fn shape(
    harness: &Harness,
    options: &Options,
    reference: &MapRef,
    request: &mut Value,
    outline: Option<(Value, [f64; 4])>,
    region: Option<f64>,
) -> io::Result<()> {
    let command = options.positional(0);
    let real = json!({
        "kind": options.get("kind").unwrap_or("ground"),
        "hexSize": options.get("hex").unwrap_or("100m"),
        "hexesAcross": options.get("across").unwrap_or("50").parse::<u32>().map_err(io::Error::other)?,
    });
    if let Some((region, _)) = outline {
        request["selection"]["geometry"] = region["geometry"].clone();
        request["selection"]["regionPath"] = json!([region]);
        if command == Some("real") {
            request["realScale"] = real;
        }
    } else if command == Some("city") {
        request["city"] = city_choice(harness, options, reference)?;
    } else if region.is_none() {
        request["realScale"] = real;
    }
    Ok(())
}
/// A city map is refined over the named settlement's surroundings.
fn city_choice(harness: &Harness, options: &Options, reference: &MapRef) -> io::Result<Value> {
    let at = options.get("at").unwrap_or_default();
    let settlement = settlements(harness, reference)?
        .into_iter()
        .find(|place| place.name == at)
        .ok_or_else(|| io::Error::other(format!("No settlement named {at} on the parent")))?;
    Ok(json!({"settlement": settlement.id}))
}
fn real_scale(harness: &Harness, options: &Options) -> io::Result<()> {
    let parent_file = match options.get("parent") {
        Some(parent) => harness.existing_map(parent).join("map.json"),
        None => harness.world_file(),
    };
    let reference = read_json::<Kept>(&parent_file)
        .map_err(|e| {
            io::Error::other(format!("Cannot read parent {}: {e}", parent_file.display()))
        })?
        .reference;
    let parent = harness.open(&reference)?;
    let [x, y] = point(harness, &reference, options.get("at").unwrap_or_default())?;
    let kind = options.get("kind").unwrap_or("ground");
    let hex = options.get("hex").unwrap_or("100m");
    let across: u32 = options
        .get("across")
        .unwrap_or("50")
        .parse()
        .map_err(io::Error::other)?;
    let detail = options.get("detail").unwrap_or("draft");
    let outline = outline_choice(harness, options, &reference, &parent, [x, y])?;
    let region: Option<f64> = match &outline {
        Some((_, [w, _, e, _])) => Some(e - w),
        None => options
            .get("width")
            .map(|w| w.parse().map_err(io::Error::other))
            .transpose()?,
    };
    let metres = HEX_METRES
        .iter()
        .find(|(name, _)| *name == hex)
        .map(|(_, m)| *m)
        .ok_or_else(|| io::Error::other(format!("Unknown hex size {hex}")))?;
    let width = region.unwrap_or(f64::from(across) * metres);
    let name = options
        .get("name")
        .map_or_else(|| format!("{kind} {hex} {across}"), str::to_owned);
    if harness.map_folder(&name).join("map.json").exists() {
        return Err(io::Error::other(format!(
            "A result named {name} already exists; choose a new --name"
        )));
    }
    let mut configuration: Value = harness.generation("configuration", json!(reference))?;
    configuration["name"] = json!(name);
    configuration["width"] = json!(width);
    configuration["height"] = json!(width * 0.75);
    configuration["recipe"]["quality"] = json!(detail);
    // A region is the rectangle itself; a real-scale map is centred on a tiny outline.
    let (half_x, half_y) = match region {
        Some(width) => (width / 2., width * 0.375),
        None => (1e-3, 1e-3),
    };
    let ring = [
        [x - half_x, y - half_y],
        [x + half_x, y - half_y],
        [x + half_x, y + half_y],
        [x - half_x, y + half_y],
        [x - half_x, y - half_y],
    ];
    let mut request = json!({
        "selection": {
            "parent": reference,
            "spaceId": parent["primarySpaceId"],
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "featureIds": [],
            "regionPath": [],
        },
        "configuration": configuration,
    });
    shape(harness, options, &reference, &mut request, outline, region)?;
    let review: Value =
        harness.generation("review", json!({"method": "refine", "request": request}))?;
    refuse_errors(&review)?;
    if !review["input"]["settings"].is_null() {
        request["configuration"]["recipe"]["settings"] = review["input"]["settings"].clone();
    }
    let status: GenerationStatus = harness.generation("refine", request)?;
    let record = LastJob {
        kind: "real".into(),
        name: Some(name.clone()),
        job_id: None,
    };
    let Ended::Completed(captured) = follow::follow(harness, status, record.clone(), None)? else {
        return Ok(());
    };
    save(harness, &captured)?;
    if options.flag("capture-only") {
        return report::report(&harness.server, &captured, &harness.map_folder(&name));
    }
    let mut developed: Value = harness.generation("configuration", json!(captured))?;
    developed["recipe"]["quality"] = json!(detail);
    for (flag, choice) in [("template", "template"), ("major-work", "majorWork")] {
        if let Some(value) = options.get(flag) {
            developed["recipe"]["features"]["built.layout"]["configuration"][choice] = json!(value);
        }
    }
    if let Some(setting) = options.get("set") {
        let (feature, key, value) = feature_setting(setting)?;
        developed["recipe"]["features"][feature]["settings"][key] = json!(value);
    }
    let regeneration = json!({"reference": captured, "configuration": developed});
    let review: Value = harness.generation(
        "review",
        json!({"method": "regenerate", "request": regeneration}),
    )?;
    refuse_errors(&review)?;
    let running: GenerationStatus = harness.generation("regenerate", regeneration)?;
    let job = running.job_id.clone();
    if let Ended::Completed(result) =
        follow::follow(harness, running, record, options.get("until"))?
    {
        finish(harness, &result, &name, &job)?;
    }
    Ok(())
}
/// A feature setting given as `feature.key=number`, such as
/// `built.layout.districtCatchmentScale=1.8`. The feature id may itself contain dots.
fn feature_setting(setting: &str) -> io::Result<(&str, &str, f64)> {
    let malformed = || io::Error::other(format!("--set needs feature.key=number, got {setting}"));
    let (name, value) = setting.split_once('=').ok_or_else(malformed)?;
    let (feature, key) = name.rsplit_once('.').ok_or_else(malformed)?;
    let value: f64 = value.parse().map_err(|_| malformed())?;
    if feature.is_empty() || key.is_empty() || !value.is_finite() {
        return Err(malformed());
    }
    Ok((feature, key, value))
}
fn refuse_errors(review: &Value) -> io::Result<()> {
    let errors: Vec<_> = review["diagnostics"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["severity"] == "error")
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(io::Error::other(serde_json::to_string_pretty(&errors)?))
    }
}
/// Saves a finished map and writes its report, steps and stage pictures beside it.
fn finish(harness: &Harness, result: &MapRef, name: &str, job: &str) -> io::Result<()> {
    save(harness, result)?;
    let directory = harness.map_folder(name);
    report::report(&harness.server, result, &directory)?;
    let observed = harness.reports.join("previews").join(job);
    fs::copy(observed.join("steps.txt"), directory.join("steps.txt"))?;
    let pictures: Vec<Picture> = read_json(&observed.join("previews.json"))?;
    for picture in &pictures {
        fs::copy(
            observed.join(&picture.file),
            directory.join(format!("preview-{}", picture.file)),
        )?;
    }
    write_json(&directory.join("previews.json"), &pictures)
}
fn resume(harness: &Harness, job: Option<&str>, name: Option<&str>) -> io::Result<()> {
    let last: LastJob = read_json(&harness.last_job_file()).unwrap_or(LastJob {
        kind: "real".into(),
        name: None,
        job_id: None,
    });
    let id = job
        .map(str::to_owned)
        .or_else(|| last.job_id.clone())
        .ok_or_else(|| io::Error::other("No job to resume"))?;
    let current: GenerationStatus = harness.generation("status", json!({"job_id": id}))?;
    use atlas_generation::GenerationState::{Completed, Running};
    // A job that completed while its driver was gone only needs its report.
    let status = if matches!(current.state, Completed | Running) {
        current
    } else {
        harness.generation("resume", json!({"job_id": id}))?
    };
    let mut record = if last.job_id.as_deref() == Some(id.as_str()) {
        last
    } else {
        LastJob {
            kind: "real".into(),
            name: Some(id.clone()),
            job_id: None,
        }
    };
    if let Some(name) = name {
        record.name = Some(name.to_owned());
    }
    let kind = record.kind.clone();
    let folder = record.name.clone().unwrap_or_else(|| id.clone());
    let Ended::Completed(result) = follow::follow(harness, status, record, None)? else {
        return Ok(());
    };
    if kind == "world" {
        keep_world(harness, &result)
    } else {
        finish(harness, &result, &folder, &id)
    }
}

fn census(harness: &Harness, options: &Options) -> io::Result<()> {
    let cargo = |arguments: Vec<String>| -> io::Result<()> {
        let status = Command::new("cargo")
            .args([
                "run",
                "--quiet",
                "--release",
                "-p",
                "atlas-host",
                "--example",
            ])
            .args(arguments)
            .current_dir(&harness.checkout)
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(io::Error::other(format!("census exited with {status}")))
        }
    };
    if !options.flag("full-history") {
        let mut arguments = vec!["local_census".into(), "--".into()];
        arguments.push(harness.home.display().to_string());
        if options.flag("reference-width") {
            arguments.push("--reference-width".into());
        }
        return cargo(arguments);
    }
    let kept: Kept = read_json(&harness.world_file())?;
    let mut action: Value = read_json(
        &harness
            .home
            .join("generation-resources/.jobs")
            .join(kept.reference.revision.to_string())
            .join("action.json"),
    )?;
    if action["method"] != "create" {
        return Err(io::Error::other("Expected a saved world creation recipe"));
    }
    if let Some(seed) = options.get("seed") {
        let seed: i64 = seed
            .parse()
            .map_err(|_| io::Error::other("Expected an integer seed"))?;
        action["request"]["recipe"]["seed"] = json!(seed);
    }
    if options.flag("reference-width") {
        let width = action["request"]["width"].as_f64().unwrap_or(1.);
        let height = action["request"]["height"].as_f64().unwrap_or(1.);
        action["request"]["height"] = json!(height * 4_000_000. / width);
        action["request"]["width"] = json!(4_000_000);
    }
    let directory = harness
        .reports
        .join(format!("history-census-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&directory)?;
    let config = directory.join("action.json");
    write_json(&config, &action)?;
    println!(
        "Full history for seed {} in {}",
        action["request"]["recipe"]["seed"],
        directory.display()
    );
    cargo(vec![
        "surface_capture".into(),
        "--".into(),
        "history".into(),
        directory.display().to_string(),
        config.display().to_string(),
    ])
}
fn town_previews(harness: &Harness, job: &str, name: Option<&str>) -> io::Result<()> {
    let observed = harness.reports.join("previews").join(job);
    let Some(name) = name else {
        for (file, _) in town::pictures(&observed, &observed, "")? {
            println!("{}", observed.join(file).display());
        }
        return Ok(());
    };
    let output = harness.reports.join("maps").join(name);
    let listing = output.join("previews.json");
    let mut pictures: Vec<Picture> = read_json(&listing)?;
    for (file, label) in town::pictures(&observed, &output, "preview-")? {
        println!("{}", output.join(format!("preview-{file}")).display());
        pictures.push(Picture {
            file,
            label,
            lowest: None,
            highest: None,
        });
    }
    write_json(&listing, &follow::index(pictures))
}
/// Writes what each process recorded doing to a kept map, in run order.
fn history(harness: &Harness, name: &str) -> io::Result<()> {
    let directory = harness.reports.join("maps").join(name);
    let kept: Kept = read_json(&directory.join("map.json"))?;
    let entries: Value = harness.server.call(
        "maps/read",
        &json!({"method": "history", "args": [kept.reference, null]}),
    )?;
    write_json(&directory.join("history.json"), &entries)?;
    println!("{}", directory.join("history.json").display());
    Ok(())
}
/// Export the finished map facade's features and two field overlays for offline drawing.
fn city_view_inputs(harness: &Harness, name: &str) -> io::Result<()> {
    let directory = harness.existing_map(name);
    let map: atlas_map::MapDescriptor = read_json(&directory.join("map.json"))?;
    let mut features = Vec::new();
    report::features(
        &harness.server,
        &map.reference,
        &map.primary_space_id.to_string(),
        None,
        |feature| features.push(feature),
    )?;
    raster(
        harness,
        name,
        &["terrain".into(), "raster:Population".into()],
    )?;
    write_json(&directory.join("city-view-features.json"), &features)
}

/// Saves raster layers of a kept map as GeoTIFFs beside its report.
fn raster(harness: &Harness, name: &str, layers: &[String]) -> io::Result<()> {
    let directory = harness.existing_map(name);
    let map: Value = read_json(&directory.join("map.json"))?;
    let kept: Kept = serde_json::from_value(json!({"reference": map["reference"]}))?;
    for id in layers {
        let layer = map["layers"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|layer| layer["id"] == json!(id) && layer["source"]["kind"] == "raster")
            .ok_or_else(|| io::Error::other(format!("No raster layer {id}")))?;
        let asset = layer["source"]["data"]["assetId"]
            .as_str()
            .unwrap_or_default();
        let bytes = harness.server.get(&format!(
            "/api/maps/{}/{}/assets/{asset}",
            kept.reference.map_id, kept.reference.revision
        ))?;
        let file = directory.join(format!("{}.tif", slug(id, &['.', '-'])));
        fs::write(&file, bytes)?;
        println!("{}", file.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_slug_joins_each_run_of_other_characters() {
        assert_eq!(slug("Kesworcester city", &['.', '-']), "Kesworcester-city");
        assert_eq!(slug("ground 100m 50", &['.', '-']), "ground-100m-50");
        assert_eq!(
            slug("Initial regional detail · round 1", &[]),
            "Initial-regional-detail-round-1"
        );
        assert_eq!(slug("a--b.c", &[]), "a-b-c");
    }
    #[test]
    fn a_feature_setting_names_the_feature_its_key_and_a_number() {
        assert_eq!(
            feature_setting("built.layout.districtCatchmentScale=1.8").unwrap(),
            ("built.layout", "districtCatchmentScale", 1.8)
        );
        for malformed in [
            "districtCatchmentScale=1.8",
            "built.layout.scale",
            "a.b=wide",
        ] {
            assert!(feature_setting(malformed).is_err());
        }
    }
    #[test]
    fn options_take_values_and_flags() {
        let options = Options::parse(
            ["real", "--at", "Kesworcester", "--fresh", "--hex", "30m"]
                .into_iter()
                .map(String::from),
        )
        .unwrap();
        assert_eq!(options.positional(0), Some("real"));
        assert_eq!(options.get("at"), Some("Kesworcester"));
        assert_eq!(options.get("hex"), Some("30m"));
        assert!(options.flag("fresh"));
    }
    #[test]
    fn a_resumed_stream_keeps_the_latest_picture_of_each_stage() {
        let picture = |file: &str, label: &str| Picture {
            file: file.into(),
            label: label.into(),
            lowest: None,
            highest: None,
        };
        let kept = follow::index(vec![
            picture("03-round-1.png", "round 1"),
            picture("town-A-01-early.png", "A early"),
            picture("01-round-1.png", "round 1"),
        ]);
        let files: Vec<_> = kept.iter().map(|p| p.file.as_str()).collect();
        assert_eq!(files, ["01-round-1.png", "town-A-01-early.png"]);
    }
}
