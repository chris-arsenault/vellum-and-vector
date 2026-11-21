//! The terrain of an authored map (ADR 0019): the published terrain raster read as a height
//! grid, edited, conformed to the coast polygons and written back in place. Terrain steps
//! keep their own undo history beside the feature steps; it lives as long as the host.
use atlas_generation::publication::authored::{
    HeightArea, HeightLine, HeightPeak, Rect, Stroke, Terrain,
};
use atlas_gis::{
    map_files::MapFiles,
    map_store::{FeatureQuery, MapAccess, Page},
};
use atlas_map::{Geometry, Id, LayerSource, MapDescriptor, MapRef, Position};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io, sync::Mutex};
use ts_rs::TS;

pub const TERRAIN_LAYER: &str = "terrain";
pub const LAND_LAYER: &str = "vector:landmasses";

/// One change to the height grid of an authored map.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum TerrainEdit {
    Stroke(Stroke),
    Line(HeightLine),
    Area(HeightArea),
    Peak(HeightPeak),
    /// Bring the heights back into line with the coasts, as after redrawing a landmass.
    Conform,
}
/// What a terrain edit changed. `version` grows with every terrain write so the viewer can
/// reload the raster.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TerrainOutcome {
    pub rect: Option<Rect>,
    #[ts(type = "number")]
    pub version: u64,
    pub can_undo: bool,
    pub can_redo: bool,
}

struct Step {
    rect: Rect,
    before: Vec<f32>,
    after: Vec<f32>,
}
#[derive(Default)]
struct Steps {
    done: Vec<Step>,
    undone: Vec<Step>,
    version: u64,
}
impl Steps {
    fn outcome(&self, rect: Option<Rect>) -> TerrainOutcome {
        TerrainOutcome {
            rect,
            version: self.version,
            can_undo: !self.done.is_empty(),
            can_redo: !self.undone.is_empty(),
        }
    }
}
/// Terrain undo steps per map, held in memory.
#[derive(Default)]
pub struct TerrainHistory(Mutex<BTreeMap<Id, Steps>>);
/// The one history of this host process, shared by the LAN service and the browser worker.
pub fn history() -> &'static TerrainHistory {
    static HISTORY: std::sync::OnceLock<TerrainHistory> = std::sync::OnceLock::new();
    HISTORY.get_or_init(TerrainHistory::default)
}

fn other(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}
struct Loaded {
    map: MapDescriptor,
    terrain: Terrain,
    location: String,
}
fn load<S: MapAccess + ?Sized>(
    store: &S,
    files: &MapFiles,
    reference: &MapRef,
) -> io::Result<Loaded> {
    let map = store.open(reference)?;
    let layer = map
        .layers
        .iter()
        .find(|layer| layer.id == TERRAIN_LAYER)
        .ok_or_else(|| other("This map has no terrain to edit"))?;
    let LayerSource::Raster(source) = &layer.source else {
        return Err(other("The terrain layer is not a raster"));
    };
    let grid = atlas_generation::publication::raster::RasterGrid {
        width: source.width,
        height: source.height,
        bounds: layer.bounds,
    };
    let location = store.asset(reference, &source.asset_id)?.location;
    let terrain = Terrain::decode(grid, &files.read(&location)?)?;
    Ok(Loaded {
        map,
        terrain,
        location,
    })
}
fn save(files: &MapFiles, loaded: &Loaded) -> io::Result<()> {
    let encoded = loaded.terrain.encode()?;
    std::fs::write(files.path(&loaded.location)?, encoded.bytes)
}
fn polygon(rings: &[Vec<Position>]) -> Vec<Vec<[f64; 2]>> {
    rings
        .iter()
        .map(|ring| {
            ring.iter()
                .map(|position| {
                    let [x, y, _] = position.coordinates();
                    [x, y]
                })
                .collect()
        })
        .collect()
}
/// One landmass outline: its rings, outer first, then holes.
type Rings = Vec<Vec<[f64; 2]>>;
/// The landmass polygons of a map, each as its rings.
pub fn coasts<S: MapAccess + ?Sized>(store: &S, map: &MapDescriptor) -> io::Result<Vec<Rings>> {
    let mut query = FeatureQuery {
        space_id: map.primary_space_id,
        layer_ids: Some(vec![LAND_LAYER.into()]),
        ..Default::default()
    };
    let mut land = Vec::new();
    loop {
        let Page { items, next } = store.features(&map.reference, &query)?;
        for feature in items {
            match feature.geometry {
                Geometry::Polygon { coordinates } => land.push(polygon(&coordinates)),
                Geometry::MultiPolygon { coordinates } => {
                    land.extend(coordinates.iter().map(|rings| polygon(rings)))
                }
                _ => {}
            }
        }
        if next.is_none() {
            return Ok(land);
        }
        query.cursor = next;
    }
}
fn union(a: Rect, b: Rect) -> Rect {
    Rect {
        col0: a.col0.min(b.col0),
        row0: a.row0.min(b.row0),
        col1: a.col1.max(b.col1),
        row1: a.row1.max(b.row1),
    }
}
impl TerrainHistory {
    fn steps(&self) -> io::Result<std::sync::MutexGuard<'_, BTreeMap<Id, Steps>>> {
        self.0
            .lock()
            .map_err(|_| other("Terrain history is unavailable"))
    }
    /// Apply one edit, conform the touched ground to the coasts and keep the step for undo.
    pub fn edit<S: MapAccess + ?Sized>(
        &self,
        store: &S,
        files: &MapFiles,
        reference: &MapRef,
        edit: &TerrainEdit,
    ) -> io::Result<TerrainOutcome> {
        let mut loaded = load(store, files, reference)?;
        let old = loaded.terrain.clone();
        let rect = match edit {
            TerrainEdit::Stroke(stroke) => loaded.terrain.brush(stroke)?,
            TerrainEdit::Line(line) => loaded.terrain.apply_line(line)?,
            TerrainEdit::Area(area) => loaded.terrain.apply_area(area)?,
            TerrainEdit::Peak(peak) => loaded.terrain.apply_peak(peak)?,
            TerrainEdit::Conform => loaded.terrain.full(),
        };
        let all = coasts(store, &loaded.map)?;
        let rect = union(rect, loaded.terrain.conform(&all, Some(rect))?);
        save(files, &loaded)?;
        let mut held = self.steps()?;
        let steps = held.entry(reference.map_id).or_default();
        steps.done.push(Step {
            rect,
            before: old.patch(rect),
            after: loaded.terrain.patch(rect),
        });
        steps.undone.clear();
        steps.version += 1;
        Ok(steps.outcome(Some(rect)))
    }
    /// Undo the last terrain step, or redo the last one undone.
    pub fn step<S: MapAccess + ?Sized>(
        &self,
        store: &S,
        files: &MapFiles,
        reference: &MapRef,
        redo: bool,
    ) -> io::Result<TerrainOutcome> {
        let mut held = self.steps()?;
        let steps = held.entry(reference.map_id).or_default();
        let Some(step) = (if redo {
            steps.undone.pop()
        } else {
            steps.done.pop()
        }) else {
            return Ok(steps.outcome(None));
        };
        let mut loaded = load(store, files, reference)?;
        let heights = if redo { &step.after } else { &step.before };
        loaded.terrain.restore(step.rect, heights)?;
        save(files, &loaded)?;
        let rect = step.rect;
        if redo {
            steps.done.push(step);
        } else {
            steps.undone.push(step);
        }
        steps.version += 1;
        Ok(steps.outcome(Some(rect)))
    }
}
/// Bring the whole terrain of an authored map into line with its coasts, after an edit or
/// undo that may have moved a landmass.
pub fn reconform<S: MapAccess + ?Sized>(
    store: &S,
    files: &MapFiles,
    history: &TerrainHistory,
    reference: &MapRef,
) -> io::Result<()> {
    history.edit(store, files, reference, &TerrainEdit::Conform)?;
    Ok(())
}
