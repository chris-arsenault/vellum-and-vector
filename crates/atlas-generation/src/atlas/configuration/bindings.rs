//! Feature-owned history projections. The physical clock binds before its extensions.
use super::{error, profile, Choices, Settings};
use crate::{
    atlas::{
        context::{EcologyEpoch, Epoch, HumanEra},
        features::Selection,
    },
    magic::{configuration::System, confluences::configuration::Confluence},
    parameters::Values,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct History {
    plate_travel: [f64; 3],
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Clock {
    epochs: Vec<Value>,
    history: Option<History>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Ecology {
    epochs: BTreeMap<String, EcologyEpoch>,
    landscape: Option<EcologyEpoch>,
    #[serde(default)]
    glaciated: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Magic {
    magic_systems: Vec<System>,
    confluences: Vec<Confluence>,
    activity: BTreeMap<String, BTreeMap<String, f64>>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Era {
    id: String,
    years: f64,
    mobility: f64,
    #[serde(default, deserialize_with = "optional_epoch")]
    physical_epoch: Option<Option<String>>,
    political_capacity: Option<f64>,
}
fn optional_epoch<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cultures {
    eras: Vec<Era>,
}

fn object(value: impl Serialize) -> io::Result<Values> {
    serde_json::to_value(value)?
        .as_object()
        .cloned()
        .ok_or_else(|| error("feature_configuration", "Use an object"))
}
fn physical(epoch: &Epoch) -> io::Result<Value> {
    let mut value = object(epoch)?;
    value.remove("ecology");
    value.remove("magicActivity");
    Ok(Value::Object(value))
}
pub fn prepare(choices: &Choices, settings: &mut Settings) -> io::Result<()> {
    if let Some(configuration) = choices
        .get("physical.lifecycle")
        .and_then(|choice| choice.configuration.as_ref())
    {
        let mut defaults = defaults("physical.lifecycle", settings)?.unwrap();
        defaults.extend(configuration.clone());
        project_clock(&defaults, settings, false)?;
        settings.normalize()?;
    }
    Ok(())
}
fn defaults(id: &str, settings: &Settings) -> io::Result<Option<Values>> {
    let value = match id {
        "physical.lifecycle" => {
            json!({"epochs": settings.epochs.iter().map(physical).collect::<io::Result<Vec<_>>>()?})
        }
        "ecology.living" => {
            json!({"epochs": settings.epochs.iter().map(|epoch| (epoch.id.clone(), epoch.ecology.clone().unwrap_or_default())).collect::<BTreeMap<_, _>>()})
        }
        "magic.configured" => {
            json!({"magicSystems": settings.magic_systems, "confluences": settings.confluences, "activity": settings.epochs.iter().map(|epoch| (epoch.id.clone(), epoch.magic_activity.clone().unwrap_or_default())).collect::<BTreeMap<_, _>>()})
        }
        "human.cultures" => json!({"eras": settings.human_eras}),
        _ if !profile::keys(id).is_empty() => json!({"profile": {}}),
        _ => return Ok(None),
    };
    Ok(Some(value.as_object().unwrap().clone()))
}
pub fn configuration(
    id: &str,
    supplied: Option<Values>,
    settings: &Settings,
) -> io::Result<Option<Values>> {
    if id == "built.layout" {
        if let Some(choices) = &supplied {
            crate::atlas::town::validate_choices(choices)?;
        }
        return Ok(supplied);
    }
    let Some(mut result) = defaults(id, settings)? else {
        return if supplied.is_some() {
            Err(error(
                "feature_configuration",
                format!("{id} has no nested configuration"),
            ))
        } else {
            Ok(None)
        };
    };
    result.extend(supplied.unwrap_or_default());
    if !profile::keys(id).is_empty() {
        return Ok(Some(profile::validate(id, &result)?));
    }
    // Validate without applying here: each binding sees the preceding owners' completed settings.
    let mut checked = settings.clone();
    apply(id, &result, &mut checked)?;
    checked.normalize()?;
    Ok(Some(result))
}
pub fn bind(selection: &Selection, settings: &mut Settings) -> io::Result<()> {
    // This is the catalogue's owner order, independent of whether a process was selected.
    for id in [
        "physical.lifecycle",
        "ecology.living",
        "magic.configured",
        "human.cultures",
    ] {
        if let Some(configuration) = selection
            .get(id)
            .and_then(|feature| feature.configuration.as_ref())
        {
            apply(id, configuration, settings)?;
        }
    }
    Ok(())
}
fn apply(id: &str, configuration: &Values, settings: &mut Settings) -> io::Result<()> {
    match id {
        "physical.lifecycle" => project_clock(configuration, settings, true),
        "ecology.living" => ecology(configuration, settings),
        "magic.configured" => magic(configuration, settings),
        "human.cultures" => cultures(configuration, settings),
        _ => Ok(()),
    }
}
fn project_clock(configuration: &Values, settings: &mut Settings, history: bool) -> io::Result<()> {
    let clock: Clock = serde_json::from_value(Value::Object(configuration.clone()))?;
    if clock.epochs.is_empty() {
        return Err(error("generation_settings", "Supply at least one epoch"));
    }
    if clock.history.as_ref().is_some_and(|h| {
        h.plate_travel
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
    }) {
        return Err(error(
            "feature_configuration",
            "Plate travel anchors must be fractions",
        ));
    }
    let count = clock.epochs.len();
    let mut epochs = Vec::new();
    for (index, value) in clock.epochs.into_iter().enumerate() {
        if value.get("ecology").is_some() || value.get("magicActivity").is_some() {
            return Err(error(
                "feature_configuration_ownership",
                "The physical clock does not own ecology or magic activity",
            ));
        }
        let mut epoch: Epoch = serde_json::from_value(value)?;
        let previous = settings.epochs.iter().find(|old| old.id == epoch.id);
        epoch.ecology = previous.and_then(|old| old.ecology.clone());
        epoch.magic_activity = previous.and_then(|old| old.magic_activity.clone());
        if history {
            if let Some(history) = &clock.history {
                epoch.plate_travel = Some(at(history.plate_travel, index, count));
            }
        }
        epochs.push(epoch);
    }
    settings.epochs = epochs;
    Ok(())
}
fn check_epochs<'a>(ids: impl Iterator<Item = &'a String>, settings: &Settings) -> io::Result<()> {
    for id in ids {
        if !settings.epochs.iter().any(|epoch| epoch.id == *id) {
            return Err(error(
                "feature_epoch",
                format!("Bind settings to an existing epoch: {id}"),
            ));
        }
    }
    Ok(())
}
fn ecology(configuration: &Values, settings: &mut Settings) -> io::Result<()> {
    let bound: Ecology = serde_json::from_value(Value::Object(configuration.clone()))?;
    check_epochs(bound.epochs.keys(), settings)?;
    if let Some(landscape) = &bound.landscape {
        landscape.validate().map_err(io::Error::other)?;
    }
    let count = settings.epochs.len();
    for (index, epoch) in settings.epochs.iter_mut().enumerate() {
        let mut ecology = bound
            .epochs
            .get(&epoch.id)
            .cloned()
            .or_else(|| epoch.ecology.clone())
            .unwrap_or_default();
        ecology.validate().map_err(io::Error::other)?;
        landscape(
            &mut ecology,
            bound.landscape.as_ref(),
            bound.glaciated,
            index,
            count,
        );
        epoch.ecology = Some(ecology);
    }
    Ok(())
}
fn magic(configuration: &Values, settings: &mut Settings) -> io::Result<()> {
    let bound: Magic = serde_json::from_value(Value::Object(configuration.clone()))?;
    check_epochs(bound.activity.keys(), settings)?;
    for activity in bound.activity.values() {
        for (id, value) in activity {
            if !bound.magic_systems.iter().any(|system| system.id == *id)
                || !value.is_finite()
                || *value < 0.0
            {
                return Err(error(
                    "magic_activity",
                    format!("Bind nonnegative activity to an existing magical system: {id}"),
                ));
            }
        }
    }
    settings.magic_systems = bound.magic_systems;
    settings.confluences = bound.confluences;
    for epoch in &mut settings.epochs {
        epoch.magic_activity = Some(bound.activity.get(&epoch.id).cloned().unwrap_or_default());
    }
    Ok(())
}
fn cultures(configuration: &Values, settings: &mut Settings) -> io::Result<()> {
    let bound: Cultures = serde_json::from_value(Value::Object(configuration.clone()))?;
    settings.human_eras = bound
        .eras
        .into_iter()
        .map(|era| {
            let previous = settings.human_eras.iter().find(|old| old.id == era.id);
            HumanEra {
                physical_epoch: era
                    .physical_epoch
                    .unwrap_or_else(|| previous.and_then(|old| old.physical_epoch.clone())),
                political_capacity: era
                    .political_capacity
                    .or_else(|| previous.map(|old| old.political_capacity))
                    .unwrap_or(1.0),
                id: era.id,
                years: era.years,
                mobility: era.mobility,
            }
        })
        .collect();
    Ok(())
}
fn at(anchors: [f64; 3], index: usize, count: usize) -> f64 {
    if count == 1 {
        return anchors[2];
    }
    let position = index as f64 * 2.0 / (count - 1) as f64;
    let left = (position.floor() as usize).min(1);
    anchors[left] + (anchors[left + 1] - anchors[left]) * (position - left as f64)
}
fn landscape(
    base: &mut EcologyEpoch,
    landscape: Option<&EcologyEpoch>,
    glaciated: bool,
    index: usize,
    count: usize,
) {
    let cold = if glaciated {
        at([0.0, 1.0, 0.0], index, count)
    } else {
        0.0
    };
    let present = glaciated && index == count - 1;
    let defaults = EcologyEpoch::default();
    let factor = landscape.unwrap_or(&defaults);
    base.rainfall *= factor.rainfall * (1.0 - 0.2 * cold);
    base.seasonality *= factor.seasonality / defaults.seasonality;
    base.productivity *= factor.productivity * if present { 1.2 } else { 1.0 - 0.6 * cold };
    base.fire *= factor.fire * (1.0 - 0.8 * cold);
    base.migration *= factor.migration * if present { 1.5 } else { 1.0 - 0.5 * cold };
    base.recovery *= factor.recovery * if present { 1.5 } else { 1.0 - 0.5 * cold };
}
