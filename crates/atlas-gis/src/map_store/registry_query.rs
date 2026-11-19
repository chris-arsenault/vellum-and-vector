use crate::sql::Value;
use serde::{Deserialize, Serialize};
use std::io;
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RegistryQuery {
    pub search: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub status: String,
    pub state: String,
    pub profile: String,
    pub space: String,
    pub named: bool,
    pub protected_only: bool,
    pub attributes: Vec<AttributeFilter>,
}
#[derive(Serialize, Deserialize)]
pub struct AttributeFilter {
    pub key: String,
    pub text: String,
    pub min: String,
    pub max: String,
}
/// Where a registry value sits in a feature's catalog.
pub(super) fn path(key: &str) -> String {
    format!("$.values.{}", serde_json::to_string(key).unwrap())
}
pub(super) fn where_query(query: &RegistryQuery) -> io::Result<(String, Vec<Value>)> {
    let mut clauses = Vec::new();
    let mut values = Vec::new();
    if query.named {
        clauses.push("coalesce(json_extract(f.attributes,'$.nameStatus'),'')<>'label'".into());
    }
    if query.protected_only {
        clauses.push("json_extract(f.catalog,'$.values.protected')=1".into());
    }
    if !query.kind.is_empty() {
        clauses.push("t.id=?".into());
        values.push(query.kind.clone().into());
    }
    if !query.search.is_empty() {
        clauses.push("instr(lower(coalesce(f.name,'')||' '||t.search),lower(?))>0".into());
        values.push(query.search.clone().into());
    }
    for (key, value) in [
        ("status", &query.status),
        ("state", &query.state),
        ("profile", &query.profile),
        ("space", &query.space),
    ] {
        if !value.is_empty() {
            clauses.push("json_extract(f.catalog,?)=?".into());
            values.extend([path(key).into(), value.clone().into()]);
        }
    }
    attributes(&query.attributes, &mut clauses, &mut values)?;
    Ok((
        if clauses.is_empty() {
            "1".into()
        } else {
            clauses.join(" AND ")
        },
        values,
    ))
}
fn attributes(
    filters: &[AttributeFilter],
    clauses: &mut Vec<String>,
    values: &mut Vec<Value>,
) -> io::Result<()> {
    for filter in filters {
        let key = path(&filter.key);
        clauses.push("json_extract(f.catalog,?) IS NOT NULL".into());
        values.push(key.clone().into());
        if !filter.text.is_empty() {
            clauses.push("instr(lower(CAST(json_extract(f.catalog,?) AS TEXT)),lower(?))>0".into());
            values.extend([key.clone().into(), filter.text.clone().into()]);
        }
        for (value, operator) in [(&filter.min, ">="), (&filter.max, "<=")] {
            if value.is_empty() {
                continue;
            }
            let number = if value.trim().is_empty() {
                0.0
            } else {
                value.parse::<f64>().map_err(io::Error::other)?
            };
            if !number.is_finite() {
                return Err(io::Error::other("Choose a finite registry filter"));
            }
            clauses.push(format!("json_type(f.catalog,?) IN ('integer','real') AND json_extract(f.catalog,?){operator}?"));
            values.extend([key.clone().into(), key.clone().into(), number.into()]);
        }
    }
    Ok(())
}
