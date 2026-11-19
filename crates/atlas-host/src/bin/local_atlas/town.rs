//! Pictures of each town at its observed development stages. The town, frame and scale stay
//! fixed across a town's pictures, including when a holding disappears or a street changes.
use crate::picture::{Canvas, Extent, Frame, Point};
use atlas_map::Geometry;
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
};

/// One observation the generator sends after a completed town development stage.
#[derive(Deserialize)]
pub struct Overview {
    pub stage: Stage,
    pub settlements: Vec<Settlement>,
    pub fields: Vec<Geometry>,
}
#[derive(Clone, Deserialize)]
pub struct Stage {
    pub phase: String,
    pub round: usize,
}
#[derive(Deserialize)]
pub struct Settlement {
    key: String,
    name: String,
    centre: Point,
    walls: Vec<Vec<Point>>,
    crossings: Vec<(String, [Point; 2])>,
    works: Vec<(String, Vec<Geometry>)>,
    streets: Vec<(Vec<Point>, Vec<f64>, bool)>,
    passages: Vec<Geometry>,
    footpaths: Vec<([Point; 2], f64)>,
    plots: Vec<Geometry>,
    buildings: Vec<(Geometry, String, Option<String>)>,
}

pub const BACKGROUND: &str = "#d9ddc7";
pub const FIELD: (&str, &str) = ("#d4c9a5", "#b3a682");
pub const PLOT: (&str, &str) = ("#e7ddbf", "#ae9f81");
pub const STREET: &str = "#82796b";
pub const FOOTPATH: &str = "#866e53";
pub const BUILDING_EDGE: &str = "#65584f";
/// Roof colour by a building's function: residential, civic or economic.
pub fn roof(function: &str) -> &'static str {
    match function {
        "civic" => "#587689",
        "economic" => "#bc883a",
        _ => "#ab6e58",
    }
}
/// Pixels across one stage picture, and across a panel of the development comparison.
const PICTURE: u32 = 1600;
const PANEL: u32 = 800;
/// Width in metres of the close-up of a town's centre at its last observed stage.
const CENTRE: f64 = 1_200.;

/// Saves the stage observation under `directory`, replacing an earlier one of that round.
pub fn retain(directory: &Path, fabric: &serde_json::Value) -> io::Result<()> {
    let round = fabric["stage"]["round"].as_u64().unwrap_or_default();
    let path = directory.join(format!("fabric-{round}.json"));
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec(fabric)?)?;
    fs::rename(temporary, path)
}

/// Draws every retained stage in `observed` into `output`, each file named with `prefix`;
/// returns `(file, label)` pairs, the files without the prefix.
pub fn pictures(observed: &Path, output: &Path, prefix: &str) -> io::Result<Vec<(String, String)>> {
    let overviews = retained(observed)?;
    // hpc-exempt: each town's observations, by its stable key in first-seen order.
    let mut towns = BTreeMap::<&str, Vec<Observed<'_>>>::new();
    let mut order = Vec::new();
    for overview in &overviews {
        for town in &overview.settlements {
            if !towns.contains_key(town.key.as_str()) {
                order.push(town.key.as_str());
            }
            towns.entry(&town.key).or_default().push(Observed {
                town,
                fields: &overview.fields,
                stage: &overview.stage,
            });
        }
    }
    let mut output = Output {
        directory: output,
        prefix,
        written: Vec::new(),
    };
    for (index, key) in order.iter().enumerate() {
        let name = crate::slug(&towns[key][0].town.name, &['.', '-']);
        let id = if order.len() == 1 {
            String::new()
        } else {
            format!("-{}", index + 1)
        };
        series(&towns[key], &format!("{name}{id}"), &mut output)?;
    }
    Ok(output.written)
}
/// The retained stage observations in `observed`, in round order.
fn retained(observed: &Path) -> io::Result<Vec<Overview>> {
    let mut overviews = Vec::new();
    for entry in fs::read_dir(observed)? {
        let path = entry?.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if name.starts_with("fabric-") && name.ends_with(".json") {
            overviews.push(serde_json::from_slice::<Overview>(&fs::read(&path)?)?);
        }
    }
    overviews.sort_by_key(|o| o.stage.round);
    Ok(overviews)
}
struct Observed<'a> {
    town: &'a Settlement,
    fields: &'a [Geometry],
    stage: &'a Stage,
}
/// One town's pictures: each stage, the stages side by side, and its last centre.
fn series(series: &[Observed<'_>], name: &str, output: &mut Output<'_>) -> io::Result<()> {
    let frame = extent(series);
    let mut sheet = Canvas::sheet(PANEL * series.len() as u32, PANEL * 3 / 4 * 2, "#ffffff")?;
    for (column, observed) in series.iter().enumerate() {
        let Stage { phase, round } = observed.stage;
        let mut canvas = Canvas::new(PICTURE, frame, BACKGROUND)?;
        draw(&mut canvas, observed, false);
        output.save(
            &canvas,
            &format!("town-{name}-{round:02}-{phase}.png"),
            format!("{name} {phase} (round {round})"),
        )?;
        for (row, buildings_only) in [true, false].into_iter().enumerate() {
            let mut panel = Canvas::new(PANEL, frame, BACKGROUND)?;
            draw(&mut panel, observed, buildings_only);
            let (x, y) = (column as u32 * PANEL, row as u32 * panel.height());
            sheet.place(&panel, x as i32, y as i32);
        }
    }
    output.save(
        &sheet,
        &format!("town-{name}-development.png"),
        format!("{name} development: buildings only above, all ground below"),
    )?;
    let Some(last) = series.last() else {
        return Ok(());
    };
    let Stage { phase, round } = last.stage;
    let frame = Frame::centred(last.town.centre, CENTRE, 4. / 3.);
    let mut close = Canvas::new(PICTURE, frame, BACKGROUND)?;
    draw(&mut close, last, false);
    output.save(
        &close,
        &format!("town-{name}-{round:02}-{phase}-centre.png"),
        format!("{name} centre, {CENTRE} m across (round {round})"),
    )
}
struct Output<'a> {
    directory: &'a Path,
    prefix: &'a str,
    written: Vec<(String, String)>,
}
impl Output<'_> {
    fn save(&mut self, canvas: &Canvas, file: &str, label: String) -> io::Result<()> {
        let path: PathBuf = self.directory.join(format!("{}{file}", self.prefix));
        canvas.save(&path)?;
        self.written.push((file.to_owned(), label));
        Ok(())
    }
}
/// One frame for all of a town's stages: everything it ever occupied, at 4:3.
fn extent(series: &[Observed<'_>]) -> Frame {
    let mut extent = Extent::default();
    for Observed { town, .. } in series {
        extent.include(town.centre);
        town.plots.iter().for_each(|p| extent.include_geometry(p));
        for (points, _, through) in &town.streets {
            if !through {
                points.iter().for_each(|&p| extent.include(p));
            }
        }
        for ([a, b], _) in &town.footpaths {
            extent.include(*a);
            extent.include(*b);
        }
    }
    Frame::around(extent.0, 4. / 3., 0.16, 40.)
}
fn draw(canvas: &mut Canvas, observed: &Observed<'_>, buildings_only: bool) {
    if !buildings_only {
        ground(canvas, observed);
        ways(canvas, observed.town);
    }
    for (building, function, _) in &observed.town.buildings {
        canvas.fill(building, roof(function), Some((BUILDING_EDGE, 0.6)));
    }
}
/// Fields and plots, the land the town works and holds.
fn ground(canvas: &mut Canvas, observed: &Observed<'_>) {
    for field in observed.fields {
        canvas.fill(field, FIELD.0, Some((FIELD.1, 0.6)));
    }
    for plot in &observed.town.plots {
        canvas.fill(plot, PLOT.0, Some((PLOT.1, 0.6)));
    }
}
/// Streets at their widths, footpaths, passages, walls, crossings and major works.
fn ways(canvas: &mut Canvas, town: &Settlement) {
    for (points, widths, _) in &town.streets {
        for (i, pair) in points.windows(2).enumerate() {
            let width = (widths.get(i).unwrap_or(&6.) + widths.get(i + 1).unwrap_or(&6.)) / 2.;
            canvas.line(pair, width, 0.8, STREET);
        }
    }
    for (ends, width) in &town.footpaths {
        canvas.line(ends, *width, 0.5, FOOTPATH);
    }
    for passage in &town.passages {
        canvas.outline(passage, 1.5, 0.5, "#9e9182");
    }
    for wall in &town.walls {
        canvas.line(wall, 2.5, 1., "#594d38");
    }
    for (_, ends) in &town.crossings {
        canvas.dashed(ends, 1.5, "#426a75");
    }
    for component in town.works.iter().flat_map(|(_, components)| components) {
        canvas.outline(component, 1.8, 1., "#81672b");
    }
}
