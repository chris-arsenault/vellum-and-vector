//! Creator intent patches the existing configuration; it does not run generation.
use super::{error, Choices, Input};
use serde_json::{json, Value};
use std::{collections::BTreeSet, io};

// The bundled catalogue carries the restless-motion and balanced-terrain defaults.
// owner-direction(2026-11-07): plate travel needs to be much bigger; a few cells of travel is not enough.
// owner-direction(2026-11-09, restated 2026-11-12): the default is a good mix of very mountainous parts and large stretches of relatively flat land.
pub const PRESENTATION: &str = include_str!("presentation.json");
pub fn catalogue() -> io::Result<Vec<Value>> {
    Ok(serde_json::from_str(PRESENTATION)?)
}
// Arconis: docs/architecture/subsystems.arconis#item=w_controls — supplies the cartography step-question descriptors to the editor.
pub fn controls() -> io::Result<Vec<Value>> {
    Ok(catalogue()?
        .iter()
        .flat_map(|feature| {
            feature["cartography"]
                .as_array()
                .into_iter()
                .flatten()
                .cloned()
        })
        .collect())
}

/// Objects compose recursively; arrays remain complete authored records.
pub fn merge(current: &mut Value, patch: &Value) {
    if let Some(fields) = patch.as_object() {
        if !current.is_object() {
            *current = json!({});
        }
        for (key, value) in fields {
            merge(&mut current[key], value);
        }
    } else {
        *current = patch.clone();
    }
}
fn contains(current: &Value, expected: &Value) -> bool {
    expected.as_object().map_or_else(
        || current == expected,
        |fields| {
            fields
                .iter()
                .all(|(key, value)| contains(&current[key], value))
        },
    )
}
fn patches(control: &Value, choice: &Value, selection: &Value) -> io::Result<Value> {
    let mut result = choice["features"].clone();
    if choice.get("magicPatch").is_some() {
        let system = control["system"]
            .as_str()
            .ok_or_else(|| error("magic_system", "Choose an existing magic system"))?;
        let mut systems = selection["magic.configured"]["configuration"]["magicSystems"]
            .as_array()
            .cloned()
            .ok_or_else(|| error("magic_system", "Supply configured magic systems"))?;
        let selected = systems
            .iter_mut()
            .find(|entry| entry["id"] == system)
            .ok_or_else(|| {
                error(
                    "magic_system",
                    format!("Choose an existing magic system: {system}"),
                )
            })?;
        for key in ["parameters", "effects"] {
            if let Some(patch) = choice["magicPatch"].get(key) {
                merge(&mut selected[key], patch);
            }
        }
        result = json!({"magic.configured":{"configuration":{"magicSystems":systems}}});
    }
    if choice["landmarkEpochs"] == true {
        let mut epochs = selection["physical.lifecycle"]["configuration"]["epochs"]
            .as_array()
            .cloned()
            .ok_or_else(|| error("generation_settings", "Supply the physical clock"))?;
        let intervals = epochs.len().saturating_sub(1).max(1) as f64;
        for (index, epoch) in epochs.iter_mut().enumerate() {
            epoch["impacts"] = json!(0);
            let anchor = (index as f64 * 2.0 / intervals).round() as usize;
            epoch["volcanism"] = json!([1.0, 0.4, 0.1][anchor.min(2)]);
        }
        result["physical.lifecycle"] = json!({"configuration":{"epochs":epochs}});
    }
    Ok(result)
}

pub fn selected(control: &Value, selection: &Choices) -> io::Result<Option<String>> {
    let selection = serde_json::to_value(selection)?;
    for choice in control["choices"].as_array().into_iter().flatten() {
        if contains(&selection, &patches(control, choice, &selection)?) {
            return Ok(choice["id"].as_str().map(str::to_owned));
        }
    }
    Ok(None)
}

pub fn apply(input: &mut Input, control_id: &str, choice_id: &str) -> io::Result<()> {
    let controls = controls()?;
    let control = controls
        .iter()
        .find(|control| control["id"] == control_id)
        .ok_or_else(|| {
            error(
                "cartographic_control",
                "Choose a supported cartographic control",
            )
        })?;
    let choice = control["choices"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|choice| choice["id"] == choice_id)
        .ok_or_else(|| {
            error(
                "cartographic_choice",
                "Choose a supported cartographic option",
            )
        })?;
    let mut selection = serde_json::to_value(&input.features)?;
    let patch = patches(control, choice, &selection)?;
    merge(&mut selection, &patch);
    input.features = serde_json::from_value(selection)?;
    let definitions = super::super::features::Catalogue::default();
    let mut pending = patch
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, patch)| patch["enabled"] == true)
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let mut visited = BTreeSet::new();
    while let Some(id) = pending.pop() {
        if !visited.insert(id.clone()) {
            continue;
        }
        let feature = definitions
            .features
            .iter()
            .find(|feature| feature.id == id)
            .ok_or_else(|| {
                error(
                    "cartographic_feature",
                    format!("Unknown cartographic feature {id}"),
                )
            })?;
        if !feature
            .domains
            .iter()
            .any(|domain| input.domains.iter().any(|value| value == domain))
        {
            if let Some(domain) = feature.domains.first() {
                input.domains.push((*domain).into());
            }
        }
        for required in feature.requires {
            input
                .features
                .entry((*required).into())
                .or_default()
                .enabled = Some(true);
            pending.push((*required).into());
        }
    }
    Ok(())
}
