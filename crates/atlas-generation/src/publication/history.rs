//! Completed causal records are map content, with no process restart state.
use crate::{
    atlas::history::{Cause, EpochHistory},
    features::records::Entity,
};
use atlas_map::{HistoryEntry, MapEntity};
use serde_json::json;
use std::io;

pub fn records<'a>(
    history: &'a [EpochHistory],
    revision: &'a str,
) -> impl Iterator<Item = io::Result<HistoryEntry>> + 'a {
    history
        .iter()
        .enumerate()
        .flat_map(move |(entry_index, entry)| {
            entry
                .causes
                .iter()
                .enumerate()
                .map(move |(cause_index, cause)| {
                    let (process, description, feature_ids) = describe(cause);
                    Ok(HistoryEntry {
                        id: format!("{revision}:{entry_index:010}:{cause_index:010}"),
                        title: process.into(),
                        description: description.into(),
                        epoch: None,
                        feature_ids,
                        attributes: serde_json::from_value(
                            json!({"path":entry.path, "ancestry":entry.ancestry, "cause":cause}),
                        )?,
                    })
                })
        })
}
fn describe(cause: &Cause) -> (&str, &str, Vec<String>) {
    match cause {
        Cause::Geography {
            process,
            observations,
            ..
        } => (
            process,
            "geography",
            observations.iter().map(|o| o.id.clone()).collect(),
        ),
        Cause::Domain {
            process,
            subjects,
            description,
        } => (process, description, subjects.clone()),
        Cause::Climate { process, .. } => (process, "climate", vec![]),
        Cause::Material { process, .. } => (process, "material", vec![]),
        Cause::Drainage { process, .. } => (process, "drainage", vec![]),
        Cause::Ice { process, .. } => (process, "ice", vec![]),
        Cause::Magic { process, .. } => (process, "magic", vec![]),
    }
}
pub fn entity(entity: &Entity) -> MapEntity {
    let character = entity.attributes.get("character");
    let count = |name| character.and_then(|c| c.get(name)).and_then(|v| v.as_f64());
    MapEntity {
        id: entity.id.clone(),
        name: entity.name.clone(),
        kind: entity.kind.clone(),
        people: count("people"),
        places: count("places"),
    }
}
