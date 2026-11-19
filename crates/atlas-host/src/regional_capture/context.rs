use super::{Capture, Region};
use atlas_generation::{
    spatial::Predicate,
    water::captured::{DrainageNetwork, RetainedNetwork},
};
use atlas_map::{Geometry, Id, Position};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io};

pub(super) fn capture(
    region: &Region<'_>,
    owners: &[Id],
    ids: &BTreeMap<Id, Id>,
    output: &mut Capture,
) -> io::Result<()> {
    let world = &mut output.document.world;
    capture_drainage(region, owners, ids, world)?;
    capture_sources(region, owners, ids, world)
}
// Arconis: docs/architecture/subsystems.arconis#item=rg_ctx — incoming rivers; capture_sources takes landmarks and magic.
fn capture_drainage(
    region: &Region<'_>,
    owners: &[Id],
    ids: &BTreeMap<Id, Id>,
    world: &mut Value,
) -> io::Result<()> {
    // The world document keys its drainage by area identity text.
    let drainage = owners
        .iter()
        .find_map(|id| world["drainage"].get(id.to_string()))
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
                .filter_map(|id| ids.get(id).copied())
                .collect();
        }
        network.reaches = kept;
        network.area_id = region.area;
        network.input = true;
        network.kept = network
            .kept
            .map(|water| capture_water(region, water))
            .transpose()?;
        world["drainage"][&region.area.to_string()] = json!(network);
    }
    Ok(())
}
fn capture_sources(
    region: &Region<'_>,
    owners: &[Id],
    ids: &BTreeMap<Id, Id>,
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
        let old = identity(&landmark)?;
        let id = local_id(region, ids, "landmark", old);
        landmark_ids.insert(old, id);
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
        let old = identity(&entry)?;
        magic_ids.insert(old, local_id(region, ids, "magic", old));
        captured_magic.push(entry);
    }
    for entry in &mut captured_magic {
        entry["id"] = magic_ids[&identity(entry)?].into();
        entry["areaId"] = region.area.into();
        let landmark = optional_id(&entry["landmarkId"]).and_then(|id| landmark_ids.get(&id));
        let landmark = landmark.copied();
        entry.as_object_mut().unwrap().remove("landmarkId");
        if let Some(id) = landmark {
            entry["landmarkId"] = id.into();
        }
        entry["dependsOn"] = entry["dependsOn"]
            .as_array()
            .map(|values| {
                json!(values
                    .iter()
                    .filter_map(|v| optional_id(v).and_then(|id| magic_ids.get(&id)))
                    .collect::<Vec<_>>())
            })
            .unwrap_or(Value::Null);
    }
    world["landmarks"] = json!(captured_landmarks);
    world["magic"] = json!(captured_magic);
    Ok(())
}
fn scoped(world: &Value, key: &str, owners: &[Id], parent: Id) -> io::Result<Vec<Value>> {
    Ok(world[key]
        .as_array()
        .ok_or_else(|| io::Error::other(format!("Private {key} is an array")))?
        .iter()
        .filter(|v| owners.contains(&optional_id(&v["areaId"]).unwrap_or(parent)))
        .cloned()
        .collect())
}
/// An identity held in the world document.
fn optional_id(value: &Value) -> Option<Id> {
    serde_json::from_value(value.clone()).ok()
}
fn identity(record: &Value) -> io::Result<Id> {
    optional_id(&record["id"]).ok_or_else(|| io::Error::other("Captured context has an identity"))
}
fn local_id(region: &Region<'_>, ids: &BTreeMap<Id, Id>, kind: &str, id: Id) -> Id {
    ids.get(&id).copied().unwrap_or_else(|| region.id(kind, id))
}
fn intersects(region: &Region<'_>, shape: &Geometry) -> io::Result<bool> {
    region
        .spatial
        .relation(shape, &region.footprint, Predicate::Intersects)
        .map_err(io::Error::other)
}
fn touches(region: &Region<'_>, coordinates: &[Position]) -> io::Result<bool> {
    // A carried former course can collapse onto one parent cell. It still has a
    // location, but repeated profile vertices do not make a valid spatial line.
    if let Some(first) = coordinates.first() {
        let xy = first.coordinates();
        if coordinates
            .iter()
            .all(|point| point.coordinates()[..2] == xy[..2])
        {
            return intersects(
                region,
                &Geometry::Point {
                    coordinates: *first,
                },
            );
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_gis::geometry::NativeGeos;
    use atlas_map::{regions::rectangle, Bounds};

    #[test]
    fn a_collapsed_former_course_has_point_coverage_without_becoming_an_invalid_line() {
        let spatial = NativeGeos::new(1e-6).unwrap();
        let region = Region {
            world: atlas_map::Id::from_name("world"),
            area: atlas_map::Id::from_name("child"),
            parent: atlas_map::Id::from_name("parent"),
            operation: atlas_map::Id::from_name("capture"),
            footprint: rectangle(Bounds(0.0, 0.0, 100.0, 100.0)),
            version: 1,
            spatial: &spatial,
        };
        assert!(touches(&region, &[Position::xy(50.0, 50.0); 4]).unwrap());
        assert!(!touches(&region, &[Position::xy(150.0, 50.0); 3]).unwrap());
        assert!(!touches(&region, &[]).unwrap());
    }
}
