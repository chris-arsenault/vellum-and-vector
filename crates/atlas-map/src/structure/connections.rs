//! Connections between levels and between maps. A stair, ladder or trapdoor on one level
//! leads to its landing on another level of the same map (`leadsTo`, held by both ends);
//! a connection to a feature on another map, such as a cellar trapdoor that opens into a
//! cave passage on the parent ground map, is a `connectsTo` relation whose target names the
//! other map and the feature as `<map id>#<feature id>`.
use crate::{MapDescriptor, MapFeature};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const LEADS_TO: &str = "leadsTo";
pub const CONNECTS_TO: &str = "connectsTo";

/// What a connection reaches: a feature on this map (no `mapId`) or on another map.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionTarget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub map_id: Option<String>,
    pub feature_id: String,
}

/// Kinds that carry people from one level or map to another (`structure.json`).
pub fn is_connection(kind: &str) -> bool {
    let kinds = &super::vocabulary().connections.kinds;
    kinds.iter().any(|entry| entry == kind)
}
/// Whether a connection may lead to this feature of another map: a cave's passages, chambers,
/// mouths and walls, or a building's doors, stairs and trapdoors (`structure.json`).
pub fn reaches(feature: &MapFeature) -> bool {
    let rule = &super::vocabulary().connections;
    let family = crate::authoring::family(&feature.layer_id);
    rule.reaches_layers.iter().any(|layer| layer == family)
        || (family == "structures" && rule.reaches_structures.contains(&feature.kind))
}
/// Whether a connection on this map may lead to `other`: its landing, a stair, ladder,
/// trapdoor or shaft on another level (`structure.json`).
pub fn lands(source: &MapFeature, other: &MapFeature) -> bool {
    let landings = &super::vocabulary().connections.landings;
    landings.contains(&other.kind) && other.space_id != source.space_id && other.id != source.id
}
/// Something a connection may lead to, as the connect list offers it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionCandidate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub map_id: Option<String>,
    pub feature_id: String,
    pub label: String,
}
/// Where a located space lies, in a creator's words: a building's level, the surface or caves.
fn space_label(map: &MapDescriptor, space_id: &str) -> String {
    let space = map.spaces.iter().find(|space| space.id == space_id);
    if super::is_structure(map) {
        if let Some(number) = space.and_then(|space| super::level_of(map, space)) {
            return super::level_name(number);
        }
    }
    if space_id == map.primary_space_id {
        "surface".into()
    } else if space.and_then(|space| space.frame.floor.as_deref()) == Some("underground") {
        "caves".into()
    } else {
        "another level".into()
    }
}
fn name(feature: &MapFeature) -> &str {
    feature.name.as_deref().unwrap_or(&feature.kind)
}
/// What `source` may connect to: the connection features on this map's other levels, then
/// the features of another map (the parent, read under the building) that it may reach.
pub fn candidates(
    map: &MapDescriptor,
    source: &MapFeature,
    own: &[MapFeature],
    other: Option<(&MapDescriptor, &[MapFeature])>,
) -> Vec<ConnectionCandidate> {
    let mut found: Vec<ConnectionCandidate> = own
        .iter()
        .filter(|feature| lands(source, feature))
        .map(|feature| ConnectionCandidate {
            map_id: None,
            feature_id: feature.id.clone(),
            label: format!(
                "{} · {}",
                name(feature),
                space_label(map, &feature.space_id)
            ),
        })
        .collect();
    // The building these floors belong to is where they already are.
    let home = map
        .real_scale
        .as_ref()
        .and_then(|real| real.site.as_ref())
        .map(|site| site.building_id.as_str());
    if let Some((parent, features)) = other {
        let reachable = features
            .iter()
            .filter(|feature| reaches(feature) && Some(feature.id.as_str()) != home);
        found.extend(reachable.map(|feature| ConnectionCandidate {
            map_id: Some(parent.reference.map_id.clone()),
            feature_id: feature.id.clone(),
            label: format!(
                "{} · {}, {}",
                name(feature),
                parent.name,
                space_label(parent, &feature.space_id)
            ),
        }));
    }
    found
}
/// The relation target that names a feature on another map.
pub fn connection_target(map_id: &str, feature_id: &str) -> String {
    format!("{map_id}#{feature_id}")
}
/// The map and feature a `connectsTo` target names.
pub fn foreign_target(target_id: &str) -> Option<(&str, &str)> {
    target_id
        .split_once('#')
        .filter(|(map, feature)| !map.is_empty() && !feature.is_empty())
}
