use super::{capture::with_record, measurement::distance, placement::Placed};
use crate::{
    field::Field,
    magic::sources::placed::PlacedSource,
    scale::{LengthUnit, MapScale},
    storage::ReadBand,
};
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::io;
#[derive(Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(rename = "SourcePosition")]
pub struct Position {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
#[derive(Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename = "LocatedMagicSource")]
pub struct Source {
    pub id: atlas_map::Id,
    pub name: String,
    pub system_id: Option<String>,
    pub landmark_id: Option<atlas_map::Id>,
    pub area_id: Option<atlas_map::Id>,
    pub space_id: Option<atlas_map::Id>,
    pub scope: Option<Geometry>,
    pub source: Position,
    pub radius: f64,
    pub strength: f64,
    pub propagation: String,
    pub effect: String,
    pub decay: f64,
    pub storage: f64,
    pub depends_on: Option<Vec<String>>,
    pub starts_at_epoch: i32,
}
impl Source {
    pub fn placed(&self) -> PlacedSource {
        PlacedSource {
            id: self.id,
            system_id: self.system_id.clone().unwrap_or_default(),
            space_id: self.space_id,
            starts_at_epoch: self.starts_at_epoch,
            strength: self.strength,
            radius: self.radius,
            position: [self.source.x, self.source.y],
        }
    }
}
#[derive(Clone)]
pub struct System {
    pub id: String,
    pub enabled: bool,
    pub activity: f64,
    pub intensity: ReadBand<f64>,
}
#[derive(Clone)]
pub struct Scene {
    pub world: atlas_map::Id,
    pub area: atlas_map::Id,
    pub space: atlas_map::Id,
    pub systems: Vec<System>,
}
impl Scene {
    fn system(&self, id: &str) -> Option<&System> {
        self.systems.iter().find(|s| s.id == id && s.enabled)
    }
}
pub fn measure(field: &Field, placed: &Placed<'_>, scene: &Scene) -> io::Result<f64> {
    let Some(system) = placed
        .landmark
        .kind
        .system()
        .and_then(|id| scene.system(id))
    else {
        return Ok(f64::NAN);
    };
    let Some(center) = field.mesh.cell_at(placed.center[0], placed.center[1]) else {
        return Ok(0.0);
    };
    let mut maximum = system.intensity.get(center)?.max(0.0);
    for edge in 0..3 {
        if let Some(cell) = field.mesh.neighbor(center, edge) {
            if distance(field, cell, placed.center) <= field.scale.cells(1.1) {
                maximum = maximum.max(system.intensity.get(cell)?);
            }
        }
    }
    Ok((maximum + 0.5).floor())
}
fn description(system: &str) -> (&'static str, &'static str) {
    match system {
        "fire" => ("Great wellspring", "heat"),
        "aurora" => ("Great vault", "cold"),
        "pressure" => ("Deep locus", "pressure"),
        "greenwood" => ("Heartwood", "fertility"),
        "salt" => ("Great salt pan", "erosionResistance"),
        _ => ("Source", "heat"),
    }
}
fn upsert(
    field: &mut Field,
    placed: &Placed<'_>,
    scene: &Scene,
    system: &str,
    strength: f64,
    epoch: i32,
) -> io::Result<()> {
    let mut name = b"landmark-source".to_vec();
    name.extend_from_slice(&placed.landmark.id.to_bytes());
    let id = atlas_map::Id::v5(scene.world, &name);
    let previous = field.magic_sources.iter().position(|s| s.id == id);
    let origin = field.mesh.origin();
    let (label, effect) = description(system);
    let source = Source {
        id,
        name: if placed.landmark.name.is_empty() {
            label.into()
        } else {
            placed.landmark.name.clone()
        },
        system_id: Some(system.into()),
        landmark_id: Some(placed.landmark.id),
        area_id: Some(scene.area),
        space_id: Some(scene.space),
        scope: None,
        source: Position {
            x: placed.center[0] + origin[0],
            y: placed.center[1] + origin[1],
            z: 0.0,
        },
        radius: MapScale::metres(placed.landmark.parameters["reach"], LengthUnit::Kilometre),
        strength,
        propagation: "radial".into(),
        effect: effect.into(),
        decay: 0.0,
        storage: 0.0,
        depends_on: None,
        starts_at_epoch: previous.map_or(epoch, |at| {
            field.magic_sources[at].starts_at_epoch.min(epoch)
        }),
    };
    if let Some(at) = previous {
        field.magic_sources[at] = source;
    } else {
        field.magic_sources.push(source);
    }
    Ok(())
}
pub fn apply(
    field: &mut Field,
    placed: &Placed<'_>,
    scene: &Scene,
    epoch: i32,
    shortfall: Option<f64>,
) -> io::Result<()> {
    let Some(id) = placed.landmark.kind.system() else {
        return Ok(());
    };
    with_record(field, placed.landmark.id, |field, record| {
        let Some(system) = scene.system(id) else {
            if shortfall.is_none() {
                record.note(&format!(
                    "{id} is not generated in this run; no source formed."
                ));
            }
            return Ok(());
        };
        let activity = system.activity.max(1e-6);
        let initial = (placed.landmark.parameters["intensity"] / activity)
            .ceil()
            .clamp(50.0, 1000.0);
        let strength = if let Some(needed) = shortfall {
            let current = record.strength.unwrap_or(initial);
            (current + needed / activity).ceil().clamp(current, 1000.0)
        } else {
            initial
        };
        upsert(field, placed, scene, id, strength, epoch)?;
        record.strength = Some(strength);
        if strength >= 1000.0 && shortfall.is_some_and(|n| n > 0.0) {
            record.note(&format!("{id}'s activity caps the source at full strength; the intensity falls {:.0} short.",shortfall.unwrap()));
        }
        Ok(())
    })
}
impl Field {
    pub fn magic_sources(&self) -> &[Source] {
        &self.magic_sources
    }
}
