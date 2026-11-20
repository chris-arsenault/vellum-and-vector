use crate::postgres_migrations::{legacy_id, legacy_id_value, legacy_ids};
use atlas_map::{CreatorLayer, MapColumn};
use serde_json::{json, Value};
use std::io;

pub(super) fn description(value: &mut Value) {
    legacy_ids(value, &["worldId", "primarySpaceId"]);
    legacy_ids(&mut value["reference"], &["mapId", "revision"]);
    legacy_ids(&mut value["parent"], &["mapId", "revision"]);
    layout(value);
    if let Some(real_scale) = value.get_mut("realScale").filter(|v| !v.is_null()) {
        if let Some(site) = real_scale.get_mut("site") {
            legacy_ids(site, &["buildingId"]);
        }
        if let Some(creator) = real_scale.get_mut("creatorLayers") {
            creator_layers(creator);
        }
        if let Some(latent) = real_scale.pointer_mut("/authoring/latentLayers") {
            layers(latent);
        }
    }
}

fn creator_layers(value: &mut Value) {
    for layer in value.as_array_mut().into_iter().flatten() {
        creator_layer_id(&mut layer["id"]);
    }
}

fn creator_layer_id(value: &mut Value) {
    if value.as_str() == Some("base") {
        *value = CreatorLayer::base().id.into();
    } else {
        legacy_id_value(value);
    }
}

fn layout(value: &mut Value) {
    for space in value["spaces"].as_array_mut().into_iter().flatten() {
        legacy_ids(space, &["id", "parentSpaceId"]);
    }
    layers(&mut value["layers"]);
}

fn layers(value: &mut Value) {
    let Some(layers) = value.as_array_mut() else {
        return;
    };
    layers.retain(|layer| !sample_only(layer));
    for layer in layers {
        legacy_ids(layer, &["spaceId"]);
        for example in layer["catalog"]["examples"]
            .as_array_mut()
            .into_iter()
            .flatten()
        {
            legacy_id_value(example);
        }
    }
}

pub(super) fn feature(value: &mut Value) -> io::Result<Vec<MapColumn>> {
    legacy_ids(value, &["id", "spaceId", "entityId"]);
    if let Some(attributes) = value.get_mut("attributes") {
        legacy_ids(attributes, &["fromPlace", "toPlace", "atPlace", "streetId"]);
        if let Some(layer) = attributes.get_mut("creatorLayer") {
            creator_layer_id(layer);
        }
    }
    for relation in value["relations"].as_array_mut().into_iter().flatten() {
        upgrade_relation(relation);
    }
    let columns = value["catalog"]
        .as_object_mut()
        .and_then(|catalog| catalog.remove("columns"));
    columns
        .map(serde_json::from_value)
        .transpose()
        .map(Option::unwrap_or_default)
        .map_err(io::Error::other)
}

fn upgrade_relation(relation: &mut Value) {
    let foreign = relation["targetId"]
        .as_str()
        .and_then(|id| id.split_once('#'))
        .filter(|(map, feature)| !map.is_empty() && !feature.is_empty());
    if let ("connectsTo", Some((map, feature))) =
        (relation["kind"].as_str().unwrap_or_default(), foreign)
    {
        let (map, feature) = (legacy_id(map), legacy_id(feature));
        relation["targetMapId"] = map.into();
        relation["targetId"] = feature.into();
    } else {
        legacy_ids(relation, &["targetId", "targetMapId"]);
    }
}

pub(super) fn history(value: &mut Value) {
    legacy_ids(value, &["id"]);
    for id in value["featureIds"].as_array_mut().into_iter().flatten() {
        legacy_id_value(id);
    }
}

pub(super) fn view(value: &mut Value) {
    legacy_ids(&mut value["summary"]["reference"], &["mapId", "revision"]);
    for region in value["navigation"]["regions"]
        .as_array_mut()
        .into_iter()
        .flatten()
    {
        legacy_ids(region, &["spaceId"]);
        legacy_ids(&mut region["child"], &["mapId", "revision"]);
    }
}

pub(super) fn edit(value: &mut Value) -> io::Result<()> {
    for side in ["before", "after"] {
        let side = &mut value[side];
        for item in side["features"].as_array_mut().into_iter().flatten() {
            feature(item)?;
        }
        creator_layers(&mut side["layers"]);
        if let Some(spaces) = side.get_mut("spaces").filter(|v| !v.is_null()) {
            layout(spaces);
        }
    }
    Ok(())
}

pub(super) struct SampleBand {
    pub layer: String,
    pub id: String,
    pub name: String,
    pub unit: String,
}

fn sample_only(layer: &Value) -> bool {
    layer["source"]["kind"] == "attributes" && layer["source"]["data"]["assetId"].is_null()
}

/// The packed sample uses a band ordinal across every published layer.
pub(super) fn sample_only_bands(layers: &Value) -> io::Result<Vec<Option<SampleBand>>> {
    let mut result = Vec::new();
    for layer in layers.as_array().into_iter().flatten() {
        let preserve = sample_only(layer);
        for band in layer["source"]["data"]["bands"]
            .as_array()
            .into_iter()
            .flatten()
        {
            result.push(preserve.then(|| sample_band(layer, band)).transpose()?);
        }
    }
    Ok(result)
}

fn sample_band(layer: &Value, band: &Value) -> io::Result<SampleBand> {
    let text = |value: &Value| serde_json::from_value(value.clone()).map_err(io::Error::other);
    Ok(SampleBand {
        layer: text(&layer["id"])?,
        id: text(&band["id"])?,
        name: text(&band["name"])?,
        unit: text(&band["unit"])?,
    })
}

pub(super) fn sample(value: &mut Value, bands: &[Option<SampleBand>]) -> io::Result<()> {
    legacy_ids(value, &["spaceId"]);
    let object = value
        .as_object_mut()
        .ok_or_else(|| io::Error::other("Invalid packed sample"))?;
    let attributes = object.remove("attributes").unwrap_or_else(|| json!([]));
    let records = sample_only_values(&attributes, bands)?;
    if !records.is_empty() {
        let sections = object
            .get_mut("sections")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| io::Error::other("Invalid packed sample sections"))?;
        sections.push(json!({
            "id":"legacy-sample-values","title":"Stored map facts","records":records
        }));
    }
    Ok(())
}

fn sample_only_values(attributes: &Value, bands: &[Option<SampleBand>]) -> io::Result<Vec<Value>> {
    let attributes = attributes
        .as_array()
        .ok_or_else(|| io::Error::other("Invalid packed sample attributes"))?;
    let mut records = Vec::new();
    for attribute in attributes {
        let ordinal = attribute[0]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .filter(|&n| n < bands.len())
            .ok_or_else(|| io::Error::other("Packed sample refers to a missing band"))?;
        if let Some(band) = &bands[ordinal] {
            records.push(json!({
                "layerId":band.layer,"bandId":band.id,"name":band.name,"unit":band.unit,
                "value":attribute[1],"category":attribute[2]
            }));
        }
    }
    Ok(records)
}
