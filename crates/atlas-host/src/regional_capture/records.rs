use super::{Capture, Region};
use atlas_generation::features::{
    network::{Node, Position, Reach},
    Feature, State,
};
use atlas_map::{Geometry, Id};
use serde_json::json;
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
};

// Arconis: docs/architecture/subsystems.arconis#item=rg_feat — clips feature records and gives them new source-naming ids.
pub(super) fn capture(
    region: &Region<'_>,
    features: Vec<Feature>,
    ids: &BTreeMap<Id, Id>,
    output: &mut Capture,
) -> io::Result<()> {
    // Placed magic sources are carried by the world document, not as captured features.
    let sources: BTreeSet<String> = output.document.world["magic"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|source| source["id"].as_str().map(String::from))
        .collect();
    for mut feature in features {
        if sources.contains(&feature.id.to_string()) {
            continue;
        }
        let shape = if matches!(
            feature.geometry,
            Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
        ) {
            region.polygon(&feature.geometry).map_err(|error| {
                io::Error::other(format!("{} {} geometry: {error}", feature.kind, feature.id))
            })?
        } else {
            region.clip(&feature.geometry).map_err(|error| {
                io::Error::other(format!("{} {} geometry: {error}", feature.kind, feature.id))
            })?
        };
        let Some(shape) = shape else {
            continue;
        };
        feature.place_id = Some(feature.place_id.unwrap_or(feature.id));
        feature.id = ids[&feature.id];
        feature.area_id = region.area;
        feature.geometry = shape;
        feature.footprint = feature
            .footprint
            .as_ref()
            .map(|f| {
                region.polygon(f).map_err(|error| {
                    io::Error::other(format!(
                        "{} {} footprint: {error}",
                        feature.kind, feature.id
                    ))
                })
            })
            .transpose()?
            .flatten();
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
        let layer = &output.document.world["layers"][&feature.layer_id];
        if layer["representation"] == "network"
            || layer["representations"]
                .as_array()
                .is_some_and(|r| r.iter().any(|v| v == "network"))
        {
            network(region, &feature, output)?;
        }
        output.features.push(feature);
    }
    Ok(())
}
fn network(region: &Region<'_>, feature: &Feature, output: &mut Capture) -> io::Result<()> {
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
            if !output.nodes.iter().any(|node| node.id == id) {
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
