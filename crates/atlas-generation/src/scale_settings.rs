//! Nested configuration resolution. Numeric overrides of measures are relative fractions.
use crate::scale::{LengthUnit, MapScale, RelativeMeasure};
use serde_json::Value;

mod atlas;

pub struct ScaleDefinition(Value);
pub struct RelativeOverrides(Value);
#[derive(Clone)]
pub struct ResolvedSettings(Value);

impl ScaleDefinition {
    /// Plain settings modules compose before MapScale resolves their declarations.
    pub fn combine(parts: impl IntoIterator<Item = Self>) -> Result<Self, &'static str> {
        let mut values = serde_json::Map::new();
        for part in parts {
            let Value::Object(entries) = part.0 else {
                return Err("Combined settings need named values");
            };
            values.extend(entries);
        }
        Ok(Self(Value::Object(values)))
    }
    pub fn from_value(value: Value) -> Result<Self, &'static str> {
        if value.get("kind").and_then(Value::as_str) != Some("relative-settings") {
            return Err("Resolve declared settings, not an already resolved profile");
        }
        let values = value.get("values").ok_or("Settings need declared values")?;
        if !values.is_object() && !values.is_array() {
            return Err("Settings must be an object or array");
        }
        Ok(Self(values.clone()))
    }
}
impl RelativeOverrides {
    pub fn from_value(value: Value) -> Self {
        Self(value)
    }
}
impl Default for RelativeOverrides {
    fn default() -> Self {
        Self(Value::Null)
    }
}
impl ResolvedSettings {
    pub fn values(&self) -> &Value {
        &self.0
    }
}

/// Resolved profiles cannot accidentally re-enter the relative override boundary.
/// ```compile_fail
/// use atlas_generation::{scale::MapScale, scale_settings::*};
/// fn twice(scale: &MapScale, definition: &ScaleDefinition, resolved: ResolvedSettings) {
///     scale.resolve_settings(definition, &resolved);
/// }
/// ```
impl MapScale {
    pub fn resolve_settings(
        &self,
        definition: &ScaleDefinition,
        overrides: &RelativeOverrides,
    ) -> Result<ResolvedSettings, &'static str> {
        resolve_value(self, &definition.0, &overrides.0).map(ResolvedSettings)
    }
}
fn declared_measure(value: &Value, supplied: &Value) -> Result<RelativeMeasure, &'static str> {
    let number = |key| {
        value
            .get(key)
            .and_then(Value::as_f64)
            .ok_or("Invalid relative measure")
    };
    let unit = match value.get("unit").and_then(Value::as_str).unwrap_or("m") {
        "m" => LengthUnit::Metre,
        "km" => LengthUnit::Kilometre,
        "mm" => LengthUnit::Millimetre,
        "ft" => LengthUnit::Foot,
        "native" => LengthUnit::Native,
        _ => return Err("Unknown length unit"),
    };
    RelativeMeasure::new(
        supplied.as_f64().unwrap_or(number("fraction")?),
        number("dimension")?,
        number("exponent")?,
        unit,
    )
}
fn resolve_value(scale: &MapScale, value: &Value, supplied: &Value) -> Result<Value, &'static str> {
    if value.get("kind").and_then(Value::as_str) == Some("relative-measure") {
        return Ok(Value::from(
            scale.resolve(declared_measure(value, supplied)?)?.value(),
        ));
    }
    match value {
        Value::Array(entries) => entries
            .iter()
            .enumerate()
            .map(|(i, entry)| resolve_value(scale, entry, supplied.get(i).unwrap_or(&Value::Null)))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(entries) => entries
            .iter()
            .map(|(key, entry)| {
                Ok((
                    key.clone(),
                    resolve_value(scale, entry, supplied.get(key).unwrap_or(&Value::Null))?,
                ))
            })
            .collect::<Result<serde_json::Map<_, _>, _>>()
            .map(Value::Object),
        _ => Ok(if supplied.is_null() { value } else { supplied }.clone()),
    }
}
