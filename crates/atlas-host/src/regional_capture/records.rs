use super::{Capture, Region};
use atlas_generation::features::{
    network::{Node, Position, Reach},
    Feature, State,
};
use atlas_map::{regions::polygon, Geometry, Id};
use serde_json::json;
// hpc-exempt: record identities and layer names of the captured parent records.
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::io;

/// Features clipped to the child in one overlay pass each.
const BATCH: usize = 256;

// Arconis: docs/architecture/subsystems.arconis#item=rg_feat — clips feature records and gives them new source-naming ids.
pub(super) fn capture(
    region: &Region<'_>,
    features: Vec<Feature>,
    ids: &BTreeMap<Id, Id>,
    output: &mut Capture,
) -> io::Result<()> {
    // Placed magic sources are carried by the world document, not as captured features.
    let sources: BTreeSet<Id> = output.document.world["magic"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|source| serde_json::from_value(source["id"].clone()).ok())
        .collect();
    let mut networks = BTreeMap::new();
    let mut nodes: HashSet<Id> = output.nodes.iter().map(|node| node.id).collect();
    let features: Vec<Feature> = features
        .into_iter()
        .filter(|feature| !sources.contains(&feature.id))
        .collect();
    for batch in features.chunks(BATCH) {
        let shapes: Vec<Option<Geometry>> =
            clipped(region, batch, |_, f| Some(&f.geometry), "geometry")?
                .into_iter()
                .zip(batch)
                .map(|(shape, feature)| {
                    let polygonal = matches!(
                        feature.geometry,
                        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
                    );
                    if polygonal {
                        shape.and_then(polygon)
                    } else {
                        shape
                    }
                })
                .collect();
        // Only a feature the child keeps has its footprint clipped.
        let footprints = clipped(
            region,
            batch,
            |i, f| f.footprint.as_ref().filter(|_| shapes[i].is_some()),
            "footprint",
        )?;
        for ((feature, shape), footprint) in batch.iter().zip(shapes).zip(footprints) {
            let Some(shape) = shape else {
                continue;
            };
            let feature = rebind(region, feature.clone(), shape, footprint, ids);
            let network = *networks
                .entry(feature.layer_id.clone())
                .or_insert_with(|| is_network(output, &feature.layer_id));
            if network {
                self::network(region, &feature, &mut nodes, output)?;
            }
            output.features.push(feature);
        }
    }
    Ok(())
}
/// One geometry of each feature clipped to the child: the batch in one pass, or feature by
/// feature when the batch fails, so the error names the feature whose shape is invalid.
fn clipped(
    region: &Region<'_>,
    batch: &[Feature],
    shape: impl Fn(usize, &Feature) -> Option<&Geometry>,
    part: &str,
) -> io::Result<Vec<Option<Geometry>>> {
    let held: Vec<(usize, Geometry)> = batch
        .iter()
        .enumerate()
        .filter_map(|(i, feature)| Some((i, shape(i, feature)?.clone())))
        .collect();
    let geometries: Vec<Geometry> = held.iter().map(|(_, g)| g.clone()).collect();
    let clipped = match region.clip_all(&geometries) {
        Ok(clipped) => clipped,
        Err(_) => held
            .iter()
            .map(|(i, geometry)| {
                let feature = &batch[*i];
                region.clip(geometry).map_err(|error| {
                    io::Error::other(format!("{} {} {part}: {error}", feature.kind, feature.id))
                })
            })
            .collect::<io::Result<_>>()?,
    };
    let mut result = vec![None; batch.len()];
    for ((i, _), shape) in held.into_iter().zip(clipped) {
        result[i] = shape;
    }
    Ok(result)
}
/// The parent's record as the child's: its new identity, area, shapes and generated state.
fn rebind(
    region: &Region<'_>,
    mut feature: Feature,
    shape: Geometry,
    footprint: Option<Geometry>,
    ids: &BTreeMap<Id, Id>,
) -> Feature {
    feature.place_id = Some(feature.place_id.unwrap_or(feature.id));
    feature.id = ids[&feature.id];
    feature.area_id = region.area;
    feature.geometry = shape;
    feature.footprint = footprint.and_then(polygon);
    feature.detail.clear();
    feature.state = State::Generated;
    feature.protected = false;
    feature.map_only = None;
    feature.attributes.remove("developedBy");
    if feature.kind == "landmark" {
        feature
            .attributes
            .insert("causeId".into(), json!(format!("landmark:{}", feature.id)));
    }
    feature.relations.retain(|r| {
        !["follows", "dependsOn"].contains(&r.kind.as_str()) || ids.contains_key(&r.target_id)
    });
    for relation in &mut feature.relations {
        if let Some(&id) = ids.get(&relation.target_id) {
            relation.target_id = id;
        }
    }
    feature
}
fn is_network(output: &Capture, layer_id: &str) -> bool {
    let layer = &output.document.world["layers"][layer_id];
    layer["representation"] == "network"
        || layer["representations"]
            .as_array()
            .is_some_and(|r| r.iter().any(|v| v == "network"))
}
fn network(
    region: &Region<'_>,
    feature: &Feature,
    nodes: &mut HashSet<Id>,
    output: &mut Capture,
) -> io::Result<()> {
    let lines = match &feature.geometry {
        Geometry::LineString { coordinates } => vec![coordinates.as_slice()],
        Geometry::MultiLineString { coordinates } => {
            coordinates.iter().map(Vec::as_slice).collect()
        }
        _ => Vec::new(),
    };
    for (part, coordinates) in lines.into_iter().enumerate() {
        let (Some(first), Some(last)) = (coordinates.first(), coordinates.last()) else {
            continue;
        };
        let mut ends = Vec::new();
        for point in [first, last] {
            let [x, y, z] = point.coordinates();
            let mut key = feature.layer_id.as_bytes().to_vec();
            key.extend_from_slice(&x.to_be_bytes());
            key.extend_from_slice(&y.to_be_bytes());
            let id = region.keyed("node", &key);
            if nodes.insert(id) {
                output.nodes.push(Node {
                    id,
                    kind: format!("network:{}", feature.layer_id),
                    position: Position { x, y, z },
                    space_id: Some(output.document.scope.located.space_id),
                    water_level: None,
                });
            }
            ends.push(id);
        }
        let mut key = feature.id.to_bytes().to_vec();
        key.extend_from_slice(&(part as u64).to_be_bytes());
        output.reaches.push(Reach {
            id: region.keyed("reach", &key),
            feature_id: feature.id,
            start: ends[0],
            end: ends[1],
            geometry: Geometry::LineString {
                coordinates: coordinates.to_vec(),
            },
            flow: feature
                .attributes
                .get("discharge")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            end_flow: None,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_gis::geometry::NativeGeos;
    use atlas_map::{regions::rectangle, Bounds};

    fn feature(name: &str, layer: &str, geometry: serde_json::Value) -> Feature {
        serde_json::from_value(json!({
            "id":Id::from_name(name),"name":name,"kind":"thing","layerId":layer,
            "areaId":Id::from_name("parent"),"geometry":geometry,"detail":{},"attributes":{},
            "relations":[],"state":"authored","protected":true,"actor":"generator",
            "generationId":null,"causes":[],"generationDomain":null
        }))
        .unwrap()
    }
    /// Features are clipped to the child, a placed magic source stays with the world
    /// document, and network reaches that meet share their node.
    #[test]
    fn parent_features_are_clipped_rebound_and_networked_once() {
        let spatial = NativeGeos::new(1e-6).unwrap();
        let region = Region {
            world: Id::from_name("world"),
            area: Id::from_name("child"),
            parent: Id::from_name("parent"),
            operation: Id::from_name("capture"),
            footprint: rectangle(Bounds(0.0, 0.0, 100.0, 100.0)),
            version: 1,
            spatial: &spatial,
        };
        let document = serde_json::from_value(json!({
            "world":{"version":1,"fields":[],"magic":[{"id":Id::from_name("well")}],
                "layers":{"roads":{"representation":"network"}}},
            "scope":{"worldId":Id::from_name("world"),"areaId":Id::from_name("child"),
                "spaceId":Id::from_name("surface"),
                "footprint":{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]},
                "crsId":Id::from_name("planar"),"resolution":1,"revision":1,"time":"present"},
            "coverage":[],"fieldPatches":[]
        }))
        .unwrap();
        let mut output = Capture {
            document,
            features: Vec::new(),
            nodes: Vec::new(),
            reaches: Vec::new(),
            resources: Vec::new(),
            geography: Vec::new(),
        };
        let line = |a: [f64; 2], b: [f64; 2]| json!({"type":"LineString","coordinates":[a,b]});
        let features = vec![
            feature("west", "roads", line([10.0, 10.0], [50.0, 50.0])),
            feature("east", "roads", line([50.0, 50.0], [150.0, 50.0])),
            feature(
                "field",
                "land",
                json!({"type":"Polygon","coordinates":[[[90,90],[120,90],[120,120],[90,120],[90,90]]]}),
            ),
            feature(
                "far",
                "land",
                json!({"type":"Point","coordinates":[500,500]}),
            ),
            feature("well", "magic", json!({"type":"Point","coordinates":[5,5]})),
        ];
        let ids: BTreeMap<Id, Id> = features
            .iter()
            .map(|f| (f.id, region.id("feature", f.id)))
            .collect();
        capture(&region, features, &ids, &mut output).unwrap();
        let names: Vec<_> = output.features.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["west", "east", "field"]);
        let east = &output.features[1];
        assert_eq!(east.id, ids[&Id::from_name("east")]);
        assert_eq!(east.place_id, Some(Id::from_name("east")));
        assert!(!east.protected && east.area_id == region.area);
        let Geometry::LineString { coordinates } = &east.geometry else {
            panic!("A clipped road stays a line")
        };
        assert_eq!(coordinates.last().unwrap().coordinates()[0], 100.0);
        // Three ends: the shared node at (50, 50) is made once.
        assert_eq!(output.nodes.len(), 3);
        assert_eq!(output.reaches.len(), 2);
        assert_eq!(output.reaches[0].end, output.reaches[1].start);
    }
}
