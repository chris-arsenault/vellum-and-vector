//! Completed causal records are map content, with no process restart state.
use crate::{
    atlas::history::{Cause, EpochHistory},
    features::records::Entity,
};
use atlas_map::{HistoryEntry, Id, MapEntity};
use std::io;

pub fn records(
    history: &[EpochHistory],
    revision: Id,
) -> impl Iterator<Item = io::Result<HistoryEntry>> + '_ {
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
                    // One entry per cause of each history entry of the revision.
                    let mut place = (entry_index as u64).to_be_bytes().to_vec();
                    place.extend_from_slice(&(cause_index as u64).to_be_bytes());
                    Ok(HistoryEntry {
                        id: Id::v5(revision, &place),
                        title: process.into(),
                        description: description.into(),
                        epoch: None,
                        feature_ids,
                        attributes: [
                            ("path".to_owned(), serde_json::to_value(&entry.path)?),
                            ("ancestry".into(), serde_json::to_value(&entry.ancestry)?),
                            ("cause".into(), serde_json::to_value(cause)?),
                        ]
                        .into(),
                    })
                })
        })
}
fn describe(cause: &Cause) -> (&str, &str, Vec<Id>) {
    match cause {
        Cause::Geography {
            process,
            observations,
            ..
        } => (
            process,
            "geography",
            observations.iter().map(|o| o.id).collect(),
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
        id: entity.id,
        name: entity.name.clone(),
        kind: entity.kind.clone(),
        people: count("people"),
        places: count("places"),
    }
}
