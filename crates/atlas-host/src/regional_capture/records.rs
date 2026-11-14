use super::{Capture, Region};
use atlas_generation::features::{
    network::{Node, Position, Reach},
    Feature, State,
};
use atlas_map::Geometry;
use serde_json::json;
use std::{collections::BTreeMap, io};

pub(super) fn capture(
    region: &Region<'_>,
    features: Vec<Feature>,
    ids: &BTreeMap<String, String>,
    output: &mut Capture,
) -> io::Result<()> {
    for mut feature in features {
        if output.document.world["magic"]
            .as_array()
            .is_some_and(|sources| sources.iter().any(|source| source["id"] == feature.id))
        {
            continue;
        }
        let shape = if matches!(
            feature.geometry,
            Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
        ) {
            region.polygon(&feature.geometry)?
        } else {
            region.clip(&feature.geometry)?
        };
        let Some(shape) = shape else {
            continue;
        };
        feature.place_id = Some(feature.place_id.unwrap_or_else(|| feature.id.clone()));
        feature.id = ids[&feature.id].clone();
        feature.area_id = region.area.into();
        feature.geometry = shape;
        feature.footprint = feature
            .footprint
            .as_ref()
            .map(|f| region.polygon(f))
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
            if let Some(id) = ids.get(&relation.target_id) {
                relation.target_id.clone_from(id);
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
            let id = region.id("node", &format!("{}:{x}:{y}", feature.layer_id))?;
            if !output.nodes.iter().any(|node| node.id == id) {
                output.nodes.push(Node {
                    id: id.clone(),
                    kind: format!("network:{}", feature.layer_id),
                    position: Position { x, y, z },
                    space_id: Some(output.document.scope.located.space_id.clone()),
                    water_level: None,
                });
            }
            ends.push(id);
        }
        output.reaches.push(Reach {
            id: region.id("reach", &format!("{}:{part}", feature.id))?,
            feature_id: feature.id.clone(),
            start: ends[0].clone(),
            end: ends[1].clone(),
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
