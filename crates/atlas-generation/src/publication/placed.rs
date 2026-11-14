//! Canonical authored sources are still preserved while their editing tools are deferred.
use crate::{
    features::{context::Context, Feature, State},
    field::landmarks::catalogue::Landmark,
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Position};
use serde::{Deserialize, Serialize};
use serde_json::json;
// hpc-exempt: canonical authored feature metadata, not numerical field storage.
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicSource {
    pub id: String,
    pub name: String,
    pub area_id: Option<String>,
    pub system_id: Option<String>,
    pub source: crate::features::context::Origin,
    pub effect: serde_json::Value,
    pub radius: f64,
    pub strength: f64,
}
fn feature(
    id: &str,
    name: &str,
    area: &str,
    layer: &str,
    kind: &str,
    geometry: Geometry,
) -> Feature {
    Feature {
        id: id.into(),
        name: name.into(),
        area_id: area.into(),
        layer_id: layer.into(),
        kind: kind.into(),
        geometry,
        // hpc-exempt: canonical authored feature metadata, not numerical field storage.
        detail: BTreeMap::new(),
        attributes: Default::default(),
        relations: Vec::new(),
        state: State::Authored,
        actor: "user".into(),
        protected: true,
        generation_id: None,
        causes: Vec::new(),
        map_only: None,
        place_id: None,
        footprint: None,
        generation_domain: None,
    }
}
pub fn records(
    context: &Context,
    magic: &[MagicSource],
    landmarks: &[Landmark],
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Vec<Feature>> {
    let root = context
        .areas
        .values()
        .find(|a| a.parent_id.is_none())
        .ok_or("Missing root map context")?;
    let mut result = Vec::new();
    for source in magic {
        let mut value = feature(
            &source.id,
            &source.name,
            source.area_id.as_deref().unwrap_or(&root.id),
            "magic",
            "magicSource",
            Geometry::Point {
                coordinates: Position::xy(source.source.x, source.source.y),
            },
        );
        value.attributes = json!({
            "system": source.system_id.as_deref().unwrap_or("placed"), "rule": "source", "effect": source.effect,
            "radius": source.radius, "strength": source.strength, "nameStatus": "proper",
        }).as_object().expect("Object literal").clone();
        result.push(value);
    }
    for landmark in landmarks {
        let layer = if landmark.kind.system().is_some() {
            "magic"
        } else {
            "geology"
        };
        let mut value = feature(
            &landmark.id,
            &landmark.name,
            landmark.area_id.as_deref().unwrap_or(&root.id),
            layer,
            "landmark",
            landmark.geometry.clone(),
        );
        value.footprint = Some(
            spatial
                .buffer(
                    &landmark.geometry,
                    landmark.kind.reach(&landmark.parameters),
                )?
                .unwrap_or_else(|| landmark.geometry.clone()),
        );
        value.attributes.extend(
            landmark
                .parameters
                .iter()
                .map(|(key, value)| (key.clone(), (*value).into())),
        );
        value.attributes.extend(json!({"landmarkKind": landmark.kind, "emplacedAtEpoch": landmark.emplaced_at_epoch, "signature": "authored", "nameStatus": "proper"}).as_object().expect("Object literal").clone());
        result.push(value);
    }
    Ok(result)
}
