//! Current creator defaults, transferred from the established configuration data.
use super::{Input, Settings};
use serde_json::Value;
use std::io;

pub const JSON: &str = include_str!("defaults.json");
pub fn input(area: atlas_map::Id) -> io::Result<Input> {
    let mut defaults: Value = serde_json::from_str(JSON)?;
    let recipe = defaults["recipe"]
        .as_object_mut()
        .expect("bundled recipe object");
    recipe.remove("schemaVersion");
    recipe.insert("areaId".into(), area.into());
    Ok(serde_json::from_value(Value::Object(recipe.clone()))?)
}
pub fn settings() -> io::Result<Settings> {
    let mut settings = input(atlas_map::Id::NIL)?
        .settings
        .ok_or_else(|| io::Error::other("Default recipe needs history settings"))?;
    settings.normalize()?;
    Ok(settings)
}
