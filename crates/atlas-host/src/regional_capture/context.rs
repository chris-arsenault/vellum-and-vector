use super::{Capture, Region};
use atlas_generation::{
    spatial::Predicate,
    water::captured::{DrainageNetwork, RetainedNetwork},
};
use atlas_map::{Geometry, Position};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io};

pub(super) fn capture(
    region: &Region<'_>,
    owners: &[String],
    ids: &BTreeMap<String, String>,
    output: &mut Capture,
) -> io::Result<()> {
    let world = &mut output.document.world;
    capture_drainage(region, owners, ids, world)?;
    capture_sources(region, owners, ids, world)
}
// Arconis: docs/architecture/subsystems.arconis#item=rg_ctx — incoming rivers; capture_sources takes landmarks and magic.
fn capture_drainage(
    region: &Region<'_>,
    owners: &[String],
    ids: &BTreeMap<String, String>,
    world: &mut Value,
) -> io::Result<()> {
    let drainage = owners
        .iter()
        .find_map(|id| world["drainage"].get(id))
        .cloned();
    world["drainage"] = json!({});
    if let Some(value) = drainage {
        let mut network: DrainageNetwork = serde_json::from_value(value)?;
        let mut kept = Vec::new();
        let mut indexes = BTreeMap::new();
        for (index, reach) in network.reaches.into_iter().enumerate() {
            if touches(region, &reach.coordinates)? {
                indexes.insert(index, kept.len());
                kept.push(reach);
            }
        }
        for reach in &mut kept {
            reach.downstream = reach.downstream.and_then(|id| indexes.get(&id).copied());
            reach.feature_ids = reach
                .feature_ids
                .iter()
                .filter_map(|id| ids.get(id).cloned())
                .collect();
        }
        network.reaches = kept;
        network.area_id = region.area.into();
        network.input = true;
        network.kept = network
            .kept
            .map(|water| capture_water(region, water))
            .transpose()?;
        world["drainage"][region.area] = json!(network);
    }
    Ok(())
}
fn capture_sources(
    region: &Region<'_>,
    owners: &[String],
    ids: &BTreeMap<String, String>,
    world: &mut Value,
) -> io::Result<()> {
    let landmarks = scoped(world, "landmarks", owners, region.parent)?;
    let mut captured_landmarks = Vec::new();
    let mut landmark_ids = BTreeMap::new();
    for mut landmark in landmarks {
        let shape: Geometry = serde_json::from_value(landmark["geometry"].clone())?;
        if !intersects(region, &shape)? {
            continue;
        }
        let old = identity(&landmark)?.to_owned();
        let id = local_id(region, ids, "landmark", &old)?;
        landmark_ids.insert(old, id.clone());
        landmark["id"] = id.into();
        landmark["areaId"] = region.area.into();
        captured_landmarks.push(landmark);
    }
    let magic = scoped(world, "magic", owners, region.parent)?;
    let mut captured_magic = Vec::new();
    let mut magic_ids = BTreeMap::new();
    for entry in magic {
        let coordinate = |key| {
            entry["source"][key]
                .as_f64()
                .ok_or_else(|| io::Error::other("Magic has a located source"))
        };
        let point = Geometry::Point {
            coordinates: Position::xy(coordinate("x")?, coordinate("y")?),
        };
        let radius = entry["radius"]
            .as_f64()
            .ok_or_else(|| io::Error::other("Magic source declares its radius"))?;
        let shape = region
            .spatial
            .buffer(&point, radius)
            .map_err(io::Error::other)?;
        if !shape
            .as_ref()
            .map(|s| intersects(region, s))
            .transpose()?
            .unwrap_or(false)
        {
            continue;
        }
        let old = identity(&entry)?.to_owned();
        magic_ids.insert(old.clone(), local_id(region, ids, "magic", &old)?);
        captured_magic.push(entry);
    }
    for entry in &mut captured_magic {
        entry["id"] = magic_ids[identity(entry)?].clone().into();
        entry["areaId"] = region.area.into();
        let landmark = entry["landmarkId"]
            .as_str()
            .and_then(|id| landmark_ids.get(id))
            .cloned();
        entry.as_object_mut().unwrap().remove("landmarkId");
        if let Some(id) = landmark {
            entry["landmarkId"] = id.into();
        }
        entry["dependsOn"] = entry["dependsOn"]
            .as_array()
            .map(|values| {
                json!(values
                    .iter()
                    .filter_map(|v| v.as_str().and_then(|id| magic_ids.get(id)))
                    .collect::<Vec<_>>())
            })
            .unwrap_or(Value::Null);
    }
    world["landmarks"] = json!(captured_landmarks);
    world["magic"] = json!(captured_magic);
    Ok(())
}
fn scoped(world: &Value, key: &str, owners: &[String], parent: &str) -> io::Result<Vec<Value>> {
    Ok(world[key]
        .as_array()
        .ok_or_else(|| io::Error::other(format!("Private {key} is an array")))?
        .iter()
        .filter(|v| {
            owners
                .iter()
                .any(|id| id == v["areaId"].as_str().unwrap_or(parent))
        })
        .cloned()
        .collect())
}
fn identity(record: &Value) -> io::Result<&str> {
    record["id"]
        .as_str()
        .ok_or_else(|| io::Error::other("Captured context has an identity"))
}
fn local_id(
    region: &Region<'_>,
    ids: &BTreeMap<String, String>,
    kind: &str,
    id: &str,
) -> io::Result<String> {
    ids.get(id).cloned().map_or_else(|| region.id(kind, id), Ok)
}
fn intersects(region: &Region<'_>, shape: &Geometry) -> io::Result<bool> {
    region
        .spatial
        .relation(shape, &region.footprint, Predicate::Intersects)
        .map_err(io::Error::other)
}
fn touches(region: &Region<'_>, coordinates: &[Position]) -> io::Result<bool> {
    match coordinates {
        [] => Ok(false),
        [point] => intersects(
            region,
            &Geometry::Point {
                coordinates: *point,
            },
        ),
        _ => intersects(
            region,
            &Geometry::LineString {
                coordinates: coordinates.to_vec(),
            },
        ),
    }
}
fn capture_water(region: &Region<'_>, mut water: RetainedNetwork) -> io::Result<RetainedNetwork> {
    let mut reaches = Vec::new();
    for reach in water.reaches {
        let current = match reach.directed() {
            Some(trace) => touches(region, &trace.course)?,
            None => region
                .spatial
                .covers_points(&region.footprint, &reach.course)
                .map_err(io::Error::other)?
                .into_iter()
                .any(|v| v),
        };
        let mut former = false;
        for course in &reach.former {
            if course.course.len() > 1 && touches(region, &course.course)? {
                former = true;
                break;
            }
        }
        if current || former {
            reaches.push(reach);
        }
    }
    water.reaches = reaches;
    let inside = region
        .spatial
        .covers_points(
            &region.footprint,
            &water.entries.iter().map(|e| e.position).collect::<Vec<_>>(),
        )
        .map_err(io::Error::other)?;
    water.entries = water
        .entries
        .into_iter()
        .zip(inside)
        .filter_map(|(entry, inside)| inside.then_some(entry))
        .collect();
    Ok(water)
}
