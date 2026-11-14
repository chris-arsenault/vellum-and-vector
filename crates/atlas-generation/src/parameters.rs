//! Declared process parameters and ordered overrides, matching the shared domain contract.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
// hpc-exempt: named configuration controls, not per-cell numerical storage.
use std::{collections::BTreeMap, io};

pub type Values = Map<String, Value>;
pub type Definitions = BTreeMap<String, Definition>;
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Number,
    Integer,
    Boolean,
    Text,
    Enum,
    Resource,
    Record,
    List,
}
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Override {
    #[default]
    Replace,
    Merge,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Definition {
    #[serde(rename = "type")]
    pub kind: Kind,
    pub unit: Option<String>,
    pub required: bool,
    #[serde(default)]
    pub nullable: bool,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub default: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Definitions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Box<Definition>>,
    #[serde(default, rename = "override")]
    pub overrides: Override,
}
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}
fn require(condition: bool, code: &str, detail: impl std::fmt::Display) -> io::Result<()> {
    if condition {
        Ok(())
    } else {
        Err(io::Error::other(format!("{code}: {detail}")))
    }
}
impl Definition {
    pub fn validate(&self) -> io::Result<()> {
        require(
            self.minimum
                .zip(self.maximum)
                .is_none_or(|(low, high)| low <= high),
            "parameter_range",
            "Parameter bounds must be ordered",
        )?;
        match self.kind {
            Kind::Enum => require(
                self.choices.as_ref().is_some_and(|choices| {
                    !choices.is_empty()
                        && choices
                            .iter()
                            .all(|choice| !choice.is_object() && !choice.is_array())
                }),
                "invalid_enum_parameter",
                "Enumerated parameters need declared scalar choices",
            ),
            Kind::Record => {
                let fields = self.fields.as_ref().ok_or_else(|| {
                    io::Error::other(
                        "invalid_record_parameter: Record parameters need declared fields",
                    )
                })?;
                for definition in fields.values() {
                    definition.validate()?;
                }
                Ok(())
            }
            Kind::List => self
                .items
                .as_ref()
                .ok_or_else(|| {
                    io::Error::other(
                        "invalid_list_parameter: List parameters need a declared item type",
                    )
                })?
                .validate(),
            _ => Ok(()),
        }
    }
    fn merge(&self, previous: Value, next: &Value) -> io::Result<Value> {
        if let (Override::Merge, Value::Object(mut previous), Value::Object(next)) =
            (self.overrides, previous, next)
        {
            let fields = self.fields.as_ref().ok_or_else(|| {
                io::Error::other(
                    "missing_parameter_fields: Merged settings require declared fields",
                )
            })?;
            for (key, value) in next {
                let definition = declared(fields, key)?;
                let merged = match previous.remove(key) {
                    Some(before) => definition.merge(before, value)?,
                    None => value.clone(),
                };
                previous.insert(key.clone(), merged);
            }
            Ok(Value::Object(previous))
        } else {
            Ok(next.clone())
        }
    }
    fn normalize(&self, key: &str, value: Value) -> io::Result<Value> {
        if value.is_null() && self.nullable {
            return Ok(value);
        }
        if matches!(self.kind, Kind::Record) {
            let fields = self.fields.as_ref().ok_or_else(|| {
                io::Error::other(format!(
                    "invalid_record_parameter: {key} requires declared fields"
                ))
            })?;
            let values = value.as_object().ok_or_else(|| {
                io::Error::other(format!(
                    "invalid_record_parameter: {key} requires declared fields"
                ))
            })?;
            return resolve(fields, [values]).map(Value::Object);
        }
        if matches!(self.kind, Kind::List) {
            let item = self.items.as_ref().ok_or_else(|| {
                io::Error::other(format!(
                    "invalid_list_parameter: {key} requires typed items"
                ))
            })?;
            let Value::Array(values) = value else {
                return Err(io::Error::other(format!(
                    "invalid_list_parameter: {key} requires typed items"
                )));
            };
            return values
                .into_iter()
                .enumerate()
                .map(|(index, value)| item.normalize(&format!("{key}[{index}]"), value))
                .collect::<io::Result<Vec<_>>>()
                .map(Value::Array);
        }
        let valid = match self.kind {
            Kind::Integer => value.as_f64().is_some_and(|v| {
                v.is_finite() && v.fract() == 0.0 && v.abs() <= 9_007_199_254_740_991.0
            }),
            Kind::Number => value.as_f64().is_some_and(f64::is_finite),
            Kind::Text | Kind::Resource => value.is_string(),
            Kind::Enum => self
                .choices
                .as_ref()
                .is_some_and(|choices| choices.iter().any(|choice| scalar_equal(choice, &value))),
            Kind::Boolean => value.is_boolean(),
            Kind::Record | Kind::List => unreachable!(),
        };
        require(
            valid,
            "invalid_parameter_type",
            format!("Parameter {key} has the wrong type"),
        )?;
        if let Some(number) = value.as_f64() {
            require(
                self.minimum.is_none_or(|low| number >= low),
                "parameter_range",
                format!("{key} is below its minimum"),
            )?;
            require(
                self.maximum.is_none_or(|high| number <= high),
                "parameter_range",
                format!("{key} exceeds its maximum"),
            )?;
        }
        Ok(value)
    }
}
pub fn scalar_equal(left: &Value, right: &Value) -> bool {
    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => left == right,
        _ => left == right,
    }
}
fn declared<'a>(definitions: &'a Definitions, key: &str) -> io::Result<&'a Definition> {
    definitions.get(key).ok_or_else(|| {
        io::Error::other(format!(
            "unknown_parameter: Parameter {key} is not declared"
        ))
    })
}
pub fn resolve<'a>(
    definitions: &Definitions,
    overrides: impl IntoIterator<Item = &'a Values>,
) -> io::Result<Values> {
    let mut values = Values::new();
    for (key, definition) in definitions {
        definition.validate()?;
        if let Some(value) = &definition.default {
            values.insert(key.clone(), value.clone());
        }
    }
    for layer in overrides {
        for (key, value) in layer {
            let definition = declared(definitions, key)?;
            let next = match values.remove(key) {
                Some(previous) => definition.merge(previous, value)?,
                None => value.clone(),
            };
            values.insert(key.clone(), next);
        }
    }
    for (key, definition) in definitions {
        require(
            !definition.required || values.contains_key(key),
            "missing_parameter",
            format!("Parameter {key} is required"),
        )?;
        if let Some(value) = values.remove(key) {
            values.insert(key.clone(), definition.normalize(key, value)?);
        }
    }
    Ok(values)
}
