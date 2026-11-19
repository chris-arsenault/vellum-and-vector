//! Final map names return through the river owner before capturing child inputs.
use super::{command, Field};
use crate::{
    execution::{Command, CommandKind, Executor},
    features::{FeatureSelection, FeatureWorkspace, State},
    water::captured::{DrainageNetwork, RetainedNetwork},
};
use serde_json::Value;
// hpc-exempt: names indexed by published river identity, not numerical cells.
use std::{collections::BTreeMap, io};

pub struct RiverPublication {
    pub river: String,
    pub record: Option<String>,
    pub name: String,
}
pub fn associate() -> Command<Field, Vec<RiverPublication>> {
    command(
        "water.river-publication",
        CommandKind::Work,
        |water, names: &Vec<RiverPublication>| {
            for item in names {
                water.associate_publication(&item.river, item.record.as_deref(), &item.name);
            }
            Ok(())
        },
    )
}
impl Field {
    pub fn capture_rivers(&self) -> RetainedNetwork {
        self.water.borrow().capture_network()
    }
}
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(value)) => value.as_f64().is_some_and(|value| value != 0.0),
        Some(Value::String(value)) => !value.is_empty(),
        _ => true,
    }
}
pub fn retain_names(
    executor: &mut Executor<Field>,
    command: &Command<Field, Vec<RiverPublication>>,
    features: &mut dyn FeatureWorkspace,
    area: atlas_map::Id,
    network: &mut DrainageNetwork,
) -> io::Result<()> {
    if network.input {
        return Ok(());
    }
    let records = features
        .values(FeatureSelection {
            area_id: Some(area),
            kind: Some("river"),
            ..Default::default()
        })?
        .collect::<io::Result<Vec<_>>>()?;
    // hpc-exempt: one name per sparse cartographic river identity.
    let mut names = BTreeMap::new();
    let mut publications = Vec::new();
    for feature in &records {
        if let Some(river) = feature.attributes.get("riverId").and_then(Value::as_str) {
            if !truthy(feature.attributes.get("former"))
                && !truthy(feature.attributes.get("dryMember"))
            {
                publications.push(RiverPublication {
                    river: river.into(),
                    record: None,
                    name: feature.name.clone(),
                });
                names.insert(river.to_owned(), feature.name.clone());
            }
        }
    }
    executor
        .run_with(command, &publications)
        .map_err(|error| io::Error::other(format!("{error:?}")))?;
    for mut feature in records {
        let name = feature
            .attributes
            .get("riverId")
            .and_then(Value::as_str)
            .and_then(|id| names.get(id));
        if let Some(name) = name.filter(|_| {
            (truthy(feature.attributes.get("former"))
                || truthy(feature.attributes.get("dryMember")))
                && feature.state == State::Generated
                && !feature.protected
        }) {
            feature.name.clone_from(name);
            features.put(feature)?;
        }
    }
    network.kept = Some(executor.state().capture_rivers());
    Ok(())
}
