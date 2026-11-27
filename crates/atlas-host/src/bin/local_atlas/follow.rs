//! Follows a generation job to its end: each step with the seconds since the job started,
//! a picture of the land at each stage, and the town observations it sends.
use crate::{client::Bytes, picture::Canvas, read_json, slug, town, write_json, Harness};
use atlas_generation::{GenerationState, GenerationStatus};
use atlas_map::MapRef;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs, io,
    path::Path,
    time::{Duration, Instant},
};

/// The job a later `resume` continues, and what kind of map it makes.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastJob {
    pub kind: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub job_id: Option<String>,
}
/// One picture a job's report lists.
#[derive(Clone, Serialize, Deserialize)]
pub struct Picture {
    pub file: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lowest: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highest: Option<f64>,
}
/// A resumed observation stream restarts its numbering, so a land picture is kept by its
/// stage and the latest one of a stage wins; town pictures are kept by file.
pub fn index(pictures: Vec<Picture>) -> Vec<Picture> {
    let mut kept: Vec<Picture> = Vec::new();
    for picture in pictures {
        let key = |p: &Picture| {
            if p.file.starts_with("town-") {
                p.file.clone()
            } else {
                p.label.clone()
            }
        };
        match kept.iter_mut().find(|p| key(p) == key(&picture)) {
            Some(existing) => *existing = picture,
            None => kept.push(picture),
        }
    }
    kept
}

#[derive(Deserialize)]
struct Page {
    events: Vec<Event>,
    next: usize,
    status: GenerationStatus,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Event {
    /// An epoch's preview was retained; its bytes are fetched by job and epoch.
    Preview { epoch: usize },
    #[serde(other)]
    Other,
}
#[derive(Deserialize)]
struct Preview {
    grid: Grid,
    ancestry: Option<Vec<Epoch>>,
}
#[derive(Deserialize)]
struct Epoch {
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Grid {
    width: usize,
    height: usize,
    active: Vec<u8>,
    // hpc-exempt: preview planes keyed by channel name.
    channels: BTreeMap<String, Channel>,
    town_fabric: Option<serde_json::Value>,
}
#[derive(Deserialize)]
struct Channel {
    values: Vec<Option<f64>>,
}

/// How a followed job ended when it did not complete.
pub enum Ended {
    Completed(MapRef),
    /// Cancelled on reaching the `--until` stage.
    Stopped,
}

/// One followed job: where its pictures go, what it printed and which pictures it made.
struct Run<'a> {
    harness: &'a Harness,
    job: String,
    directory: std::path::PathBuf,
    started: Instant,
    log: Vec<String>,
    pictures: Vec<Picture>,
}
impl Run<'_> {
    fn print(&mut self, line: impl std::fmt::Display) {
        let line = format!(
            "{:>6} {line}",
            format!("{}s", self.started.elapsed().as_secs())
        );
        println!("{line}");
        self.log.push(line);
    }
    fn call<T: serde::de::DeserializeOwned>(&self, method: &str, after: usize) -> io::Result<T> {
        self.harness.server.call(
            "generation",
            &json!({"method": method, "request": {"job_id": self.job, "after": after}}),
        )
    }
    /// An epoch's retained preview, or none when the job no longer keeps it.
    fn fetch(&self, epoch: usize) -> io::Result<Option<Preview>> {
        let reply: io::Result<Bytes> = self.harness.server.call(
            "generation",
            &json!({"method": "preview", "request": {"job_id": self.job, "epoch": epoch}}),
        );
        match reply {
            Ok(bytes) => {
                let mut preview: Preview =
                    ciborium::from_reader(bytes.0.as_slice()).map_err(io::Error::other)?;
                // CBOR keeps a missing value as NaN, where JSON wrote null.
                for channel in preview.grid.channels.values_mut() {
                    for value in &mut channel.values {
                        *value = value.filter(|v| v.is_finite());
                    }
                }
                Ok(Some(preview))
            }
            Err(error) if error.to_string().contains("no longer kept") => Ok(None),
            Err(error) => Err(error),
        }
    }
    /// Draws a stage picture and keeps its town observation; true when it is the `until` stage.
    fn preview(&mut self, epoch: usize, preview: Preview, until: Option<&str>) -> io::Result<bool> {
        if let Some(fabric) = &preview.grid.town_fabric {
            town::retain(&self.directory, fabric)?;
        }
        let picture = land(&preview, epoch, &self.directory)?;
        self.print(format_args!(
            "terrain preview {}",
            self.directory.join(&picture.file).display()
        ));
        let reached = until.is_some_and(|label| picture.label.contains(label));
        self.pictures.push(picture);
        Ok(reached)
    }
    /// Draws the town pictures and writes the step log and picture listing.
    fn close(&mut self) -> io::Result<()> {
        let directory = self.directory.clone();
        for (file, label) in town::pictures(&directory, &directory, "")? {
            self.print(format_args!("picture {}", directory.join(&file).display()));
            self.pictures.push(Picture {
                file,
                label,
                lowest: None,
                highest: None,
            });
        }
        let steps = self.log.join("\n") + "\n";
        fs::write(self.harness.runtime.join("last-job-steps.txt"), &steps)?;
        fs::write(directory.join("steps.txt"), &steps)?;
        let listing = directory.join("previews.json");
        let temporary = listing.with_extension("json.tmp");
        write_json(&temporary, &index(std::mem::take(&mut self.pictures)))?;
        fs::rename(temporary, &listing)
    }
    /// A failed poll is retried while the server process lives; once it is gone the run
    /// closes with the server's exit record instead of polling a dead address.
    fn failed_poll(&mut self, error: &io::Error, after: &mut usize) -> io::Result<()> {
        // A restarted server keeps job status but starts a new observation stream.
        if error
            .to_string()
            .contains("Unknown generation event cursor")
        {
            *after = 0;
        }
        let Some(ending) = server_gone(&self.harness.runtime) else {
            self.print(format_args!("poll failed, retrying: {error}"));
            return Ok(());
        };
        self.print(format_args!("the server is gone: {ending}"));
        self.close()?;
        println!(
            "Server log: {}\nFix the cause, then make local-up and make local-resume (job {}).",
            self.harness.runtime.join("server.log").display(),
            self.job
        );
        std::process::exit(1);
    }
}

pub fn follow(
    harness: &Harness,
    mut status: GenerationStatus,
    record: LastJob,
    until: Option<&str>,
) -> io::Result<Ended> {
    let job = status.job_id.clone();
    write_json(
        &harness.last_job_file(),
        &LastJob {
            job_id: Some(job.clone()),
            ..record
        },
    )?;
    let directory = harness.reports.join("previews").join(&job);
    fs::create_dir_all(&directory)?;
    let mut run = Run {
        harness,
        pictures: read_json(&directory.join("previews.json")).unwrap_or_default(),
        job: job.clone(),
        directory,
        started: Instant::now(),
        log: Vec::new(),
    };
    let mut after = 0;
    let mut step = String::new();
    loop {
        std::thread::sleep(Duration::from_secs(1));
        // A server busy publishing can be slow to answer; a dropped poll is retried.
        let page: Page = match run.call("observe", after) {
            Ok(page) => page,
            Err(error) => {
                run.failed_poll(&error, &mut after)?;
                continue;
            }
        };
        let drained = after == page.next;
        after = page.next;
        status = page.status;
        if !status.step.is_empty() && status.step != step {
            step.clone_from(&status.step);
            run.print(&step);
        }
        for event in page.events {
            if let Event::Preview { epoch } = event {
                let Some(preview) = run.fetch(epoch)? else {
                    run.print(format_args!("preview {epoch} is no longer kept"));
                    continue;
                };
                if run.preview(epoch, preview, until)? {
                    status = run.call("cancel", 0)?;
                }
            }
        }
        if status.state != GenerationState::Running && drained {
            break;
        }
    }
    let state = serde_json::to_value(&status.state)?;
    run.print(format_args!(
        "{} {}",
        state.as_str().unwrap_or_default(),
        status.message.clone().unwrap_or_default()
    ));
    run.close()?;
    match (status.state, status.result) {
        (GenerationState::Cancelled, _) if until.is_some() => Ok(Ended::Stopped),
        (GenerationState::Completed, Some(result)) => Ok(Ended::Completed(result)),
        _ => {
            println!("Fix the cause, then make local-up and make local-resume (job {job}).");
            std::process::exit(1);
        }
    }
}

/// How the server ended when its process is gone: the supervisor's exit record, or the
/// server log's last line when there is none. A slow but living server is retried, and so is
/// a missing process file during a restart. An explicit shutdown closes the follower.
fn server_gone(home: &Path) -> Option<String> {
    let pid = fs::read_to_string(home.join("server.pid")).ok();
    if let Some(pid) = &pid {
        if fs::read_to_string(Path::new("/proc").join(pid.trim()).join("comm"))
            .is_ok_and(|name| name.trim() == "atlas_server")
        {
            return None;
        }
    }
    let log = fs::read_to_string(home.join("server.log")).unwrap_or_default();
    if pid.is_none()
        && !log
            .lines()
            .rev()
            .find(|line| line.contains("\"server.stop-request\""))
            .is_some_and(|line| line.contains("\"command\":\"down\""))
    {
        return None;
    }
    Some(
        log.lines()
            .rev()
            .find(|line| line.contains("\"server.exit\""))
            .or_else(|| log.lines().last())
            .unwrap_or("no server log")
            .to_owned(),
    )
}

/// The land at one stage, shaded by height with sea and lakes blue, four pixels per sample.
fn land(preview: &Preview, epoch: usize, directory: &Path) -> io::Result<Picture> {
    let label = preview
        .ancestry
        .as_ref()
        .map(|epochs| {
            epochs
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|label| !label.is_empty())
        .unwrap_or_else(|| "final".into());
    let grid = &preview.grid;
    let elevation = &grid
        .channels
        .get("Elevation")
        .ok_or_else(|| io::Error::other("A stage picture needs elevation"))?
        .values;
    let water = grid
        .channels
        .get("Water Kind Codes")
        .or_else(|| grid.channels.get("WaterKindCodes"))
        .map(|c| &c.values);
    let active = |cell: usize| grid.active.get(cell).is_some_and(|a| *a != 0);
    let land = (0..elevation.len())
        .filter(|&cell| active(cell))
        .filter_map(|cell| elevation[cell].filter(|v| v.is_finite()));
    let (low, high) = land.fold((f64::INFINITY, -f64::INFINITY), |(l, h), v| {
        (l.min(v), h.max(v))
    });
    const SCALE: usize = 4;
    let mut canvas = Canvas::sheet(
        (grid.width * SCALE) as u32,
        (grid.height * SCALE) as u32,
        "#282828",
    )?;
    for y in 0..grid.height * SCALE {
        for x in 0..grid.width * SCALE {
            let cell = (grid.height - 1 - y / SCALE) * grid.width + x / SCALE;
            if !active(cell) {
                continue;
            }
            let value = elevation[cell].unwrap_or(low);
            let shade = (255. * (value - low) / (high - low).max(1e-9))
                .round()
                .clamp(0., 255.);
            let wet = water.is_some_and(|w| w.get(cell).copied().flatten().unwrap_or(0.) > 0.);
            let rgb = if wet {
                [60, 110, (200. - shade / 4.) as u8]
            } else {
                [shade as u8; 3]
            };
            canvas.set(x as u32, y as u32, rgb);
        }
    }
    let file = format!("{epoch:02}-{}.png", slug(&label, &[]));
    canvas.save(&directory.join(&file))?;
    Ok(Picture {
        file,
        label,
        lowest: Some(low),
        highest: Some(high),
    })
}
