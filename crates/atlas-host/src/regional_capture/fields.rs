use super::{Capture, Region, Source};
use crate::{
    numerical_input::Alias,
    numerical_resource::{Descriptor, State},
};
use atlas_map::Geometry;
use serde_json::{json, Value};
use std::{collections::BTreeMap, io};

pub(super) fn capture(
    region: &Region<'_>,
    owners: &[atlas_map::Id],
    source: &impl Source,
    output: &mut Capture,
) -> io::Result<()> {
    // The world document holds area identities as text.
    let owners: Vec<String> = owners.iter().map(ToString::to_string).collect();
    let fields = output.document.world["fields"]
        .as_array()
        .ok_or_else(|| io::Error::other("Private fields are an array"))?
        .clone();
    let mut layouts = BTreeMap::new();
    let mut captured = Vec::new();
    let patches = std::mem::take(&mut output.document.field_patches);
    for field in fields
        .into_iter()
        .filter(|f| owners.iter().any(|id| f["areaId"] == id.as_str()))
    {
        let Some(resource_id) = field["resourceId"].as_str() else {
            continue;
        };
        let original = source.resource(resource_id)?;
        let Some(described) = &original.field else {
            continue;
        };
        if region.clip(&described.scope.footprint)?.is_none() {
            continue;
        }
        let layout = layout(region, &original, source, &mut layouts, output)?;
        let field_id = string(&field, "id")?;
        // Numerical resources stay keyed by text; their keys are the captured identities.
        let id = region.keyed("field", field_id.as_bytes()).to_string();
        let resource_id = region
            .keyed(
                "samples",
                format!("{}:{field_id}", region.operation).as_bytes(),
            )
            .to_string();
        let mut resource = alias(region, original, &resource_id)?;
        let footprint = {
            let field = resource
                .field
                .as_mut()
                .expect("A field resource keeps its field");
            field.id = id.clone();
            field.layout_resource_id = layout.clone();
            field.geography_id = layout;
            field.scope.footprint.clone()
        };
        let mut local = field.clone();
        local["id"] = id.clone().into();
        local["areaId"] = region.area.into();
        local["input"] = true.into();
        local["state"] = "generated".into();
        local["resourceId"] = resource_id.into();
        local["footprint"] = json!(footprint);
        captured.push(local);
        output.resources.push(resource);
        for patch in patches.iter().filter(|p| {
            p["fieldId"] == field_id && owners.iter().any(|owner| p["areaId"] == owner.as_str())
        }) {
            let geometry = serde_json::from_value(patch["footprint"].clone())?;
            let Some(footprint) = region.clip(&geometry)? else {
                continue;
            };
            let mut patch = patch.clone();
            patch["id"] = region
                .keyed("patch", string(&patch, "id")?.as_bytes())
                .to_string()
                .into();
            patch["fieldId"] = id.clone().into();
            patch["areaId"] = region.area.into();
            patch["input"] = true.into();
            patch["protected"] = false.into();
            patch["footprint"] = json!(footprint);
            patch.as_object_mut().unwrap().remove("mapOnly");
            output.document.field_patches.push(patch);
        }
    }
    output.document.world["fields"] = json!(captured);
    Ok(())
}
fn layout(
    region: &Region<'_>,
    original: &Descriptor,
    source: &impl Source,
    layouts: &mut BTreeMap<String, String>,
    output: &mut Capture,
) -> io::Result<String> {
    let field = original
        .field
        .as_ref()
        .ok_or_else(|| io::Error::other("A layout belongs to a field resource"))?;
    let geography = &field.geography_id;
    if let Some(id) = layouts.get(geography) {
        return Ok(id.clone());
    }
    let id = region
        .keyed(
            "layout",
            format!("{}:{geography}", region.operation).as_bytes(),
        )
        .to_string();
    let layout = source.resource(&field.layout_resource_id)?;
    let alias = alias(region, layout, &id)?;
    let mut geography_record = source.geography(&original.scope, geography)?;
    geography_record["id"] = id.clone().into();
    geography_record["scope"] = serde_json::to_value(&alias.scope)?;
    if let Some(ocean) = geography_record.get("ocean").filter(|v| !v.is_null()) {
        geography_record["ocean"] = json!(region.polygon(&serde_json::from_value(ocean.clone())?)?);
    }
    clip_collection(region, &mut geography_record, "lakes", "geometry")?;
    clip_collection(region, &mut geography_record, "waterBodies", "footprint")?;
    if let Some(bodies) = geography_record["waterBodies"].as_array_mut() {
        for body in bodies {
            if let Some(slices) = body["slices"].as_array_mut() {
                for slice in slices {
                    let footprint = if slice["footprint"].is_null() {
                        None
                    } else {
                        region.polygon(&serde_json::from_value(slice["footprint"].clone())?)?
                    };
                    slice["footprint"] = json!(footprint);
                }
            }
        }
    }
    output.resources.push(alias);
    output.geography.push(geography_record);
    layouts.insert(geography.clone(), id.clone());
    Ok(id)
}
fn clip_collection(
    region: &Region<'_>,
    record: &mut Value,
    key: &str,
    geometry_key: &str,
) -> io::Result<()> {
    let Some(values) = record.get_mut(key).and_then(Value::as_array_mut) else {
        return Ok(());
    };
    let mut captured = Vec::new();
    for mut value in std::mem::take(values) {
        let geometry: Geometry = serde_json::from_value(value[geometry_key].clone())?;
        if let Some(geometry) = region.polygon(&geometry)? {
            value[geometry_key] = json!(geometry);
            captured.push(value);
        }
    }
    *values = captured;
    Ok(())
}
// Arconis: docs/architecture/subsystems.arconis#item=rg_fields — aliases parent number grids by reference, never copying them.
fn alias(region: &Region<'_>, mut resource: Descriptor, id: &str) -> io::Result<Descriptor> {
    if resource.state != State::Ready {
        return Err(io::Error::other("Capture completed immutable resources"));
    }
    let original = std::mem::replace(&mut resource.id, id.into());
    resource.revision = 1;
    resource.scope.area_id = region.area;
    for array in &mut resource.arrays {
        if array.source.is_none() {
            array.source = Some(Alias {
                resource_id: original.clone(),
                array: array.name.clone(),
            });
        }
    }
    if let Some(field) = &mut resource.field {
        let footprint = region
            .clip(&field.scope.footprint)?
            .ok_or_else(|| io::Error::other("Captured field intersects the child"))?;
        field.scope.located.area_id = region.area;
        field.scope.footprint = footprint;
        field.scope.revision = region.version;
    }
    Ok(resource)
}
fn string<'a>(value: &'a Value, key: &str) -> io::Result<&'a str> {
    value[key]
        .as_str()
        .ok_or_else(|| io::Error::other(format!("Captured resource requires {key}")))
}
