//! Structure-map commands: adding and removing levels, and connecting stairs, ladders and
//! trapdoors to their landings or to features on other maps (ADR 0016).
use super::{editable, in_locked_layer, plan::Draft, SpaceLayout};
use crate::{
    authoring::footprint,
    hexes::{mark_shape, marks, Hex, MarkSource},
    spatial::SpatialKernel,
    structure::{
        connection_target, is_connection, is_structure, lands, level_hexes, level_layout, levels,
        reaches, set_marks, ConnectionTarget, CONNECTS_TO, LEADS_TO,
    },
    MapDescriptor, MapFeature, MapRelation,
};
use serde_json::Value;

pub use crate::structure::level_name;

fn structure(map: &MapDescriptor) -> Result<(), String> {
    editable(map)?;
    if !is_structure(map) {
        return Err("Levels belong to a building's floors map".into());
    }
    Ok(())
}
/// A new floor above the top level, or a cellar below the lowest, holding copies of the
/// outer walls of the level next to it and its own hexes marked by them.
pub fn add_level(
    map: &MapDescriptor,
    targets: &[MapFeature],
    below: bool,
    spatial: &dyn SpatialKernel,
) -> Result<Draft, String> {
    structure(map)?;
    let present = levels(map);
    let (low, high) = (present[0].0, present[present.len() - 1].0);
    let (number, next_to) = if below {
        (low - 1, &present[0])
    } else {
        (high + 1, &present[present.len() - 1])
    };
    let range = &crate::structure::vocabulary().levels;
    if !(range.lowest..=range.highest).contains(&number) {
        return Err("This building has as many levels as a map holds".into());
    }
    let (space, layers) = level_layout(map, &map.layers, number)?;
    let structures = &layers[0];
    let mut after: Vec<MapFeature> = targets
        .iter()
        .filter(|f| f.space_id == next_to.1 && f.kind == "wall")
        .filter(|f| f.attributes.get("outer") == Some(&Value::Bool(true)))
        .enumerate()
        .map(|(index, wall)| {
            let mut copy = wall.clone();
            copy.id = format!("wall@{number}:{index}");
            copy.layer_id.clone_from(&structures.id);
            copy.space_id.clone_from(&space.id);
            copy.relations.clear();
            copy
        })
        .collect();
    for wall in &mut after {
        wall.footprint = footprint(wall, spatial)?;
    }
    let mut hexes = level_hexes(map, &layers[2])?;
    mark_hexes(map, &mut hexes, &after, spatial)?;
    after.extend(hexes);
    let mut layout = SpaceLayout::of(map);
    layout.spaces.push(space);
    layout.layers.extend(layers);
    Ok(Draft {
        label: format!("Add {}", level_name(number)),
        after,
        spaces: Some(layout),
        ..Draft::default()
    })
}
fn mark_hexes(
    map: &MapDescriptor,
    hexes: &mut [MapFeature],
    shapes: &[MapFeature],
    spatial: &dyn SpatialKernel,
) -> Result<(), String> {
    let grid = editable(map)?.grid()?;
    let addresses: Vec<Hex> = hexes
        .iter()
        .map(|hex| {
            let read = |key: &str| hex.attributes.get(key).and_then(Value::as_i64).unwrap_or(0);
            Hex {
                q: read("q") as i32,
                r: read("r") as i32,
            }
        })
        .collect();
    let shapes: Vec<_> = shapes.iter().filter_map(mark_shape).collect();
    let sources: Vec<_> = shapes
        .iter()
        .map(|(geometry, mark)| MarkSource { geometry, mark })
        .collect();
    for (hex, marks) in hexes
        .iter_mut()
        .zip(marks(&grid, &addresses, &sources, spatial)?)
    {
        set_marks(hex, &marks);
    }
    Ok(())
}
/// Remove a level and everything on it; the ground floor always stays.
pub fn remove_level(
    map: &MapDescriptor,
    targets: &[MapFeature],
    space_id: &str,
) -> Result<Draft, String> {
    structure(map)?;
    let real = editable(map)?;
    if space_id == map.primary_space_id {
        return Err("The ground floor stays; remove another level".into());
    }
    let (number, _) = levels(map)
        .into_iter()
        .find(|(_, id)| id == space_id)
        .ok_or("That level is not on this map")?;
    if let Some(held) = targets.iter().find(|f| in_locked_layer(f, real)) {
        return Err(format!(
            "{} is on a locked layer; unlock it first",
            held.name.as_deref().unwrap_or(&held.kind)
        ));
    }
    let mut layout = SpaceLayout::of(map);
    layout.spaces.retain(|space| space.id != space_id);
    layout.layers.retain(|layer| layer.space_id != space_id);
    Ok(Draft {
        label: format!("Remove {}", level_name(number)),
        before: targets
            .iter()
            .filter(|f| f.space_id == space_id)
            .cloned()
            .collect(),
        spaces: Some(layout),
        ..Draft::default()
    })
}
fn relation(target_id: String, target: &MapFeature, kind: &str) -> MapRelation {
    MapRelation {
        target_id,
        target_name: target.name.clone().unwrap_or_else(|| target.kind.clone()),
        kind: kind.into(),
    }
}
fn linked(feature: &mut MapFeature, relation: MapRelation, on: bool) {
    let same = |r: &MapRelation| r.target_id == relation.target_id && r.kind == relation.kind;
    feature.relations.retain(|r| !same(r));
    if on {
        feature.relations.push(relation);
    }
}
/// Connect (or disconnect) a stair, ladder or trapdoor. On the same map both ends hold the
/// link and must lie on different levels; a feature on another map is named by its map and
/// id, and the store supplies it among the targets under that combined id.
pub fn connect(
    map: &MapDescriptor,
    targets: &[MapFeature],
    id: &str,
    target: &ConnectionTarget,
    on: bool,
) -> Result<Draft, String> {
    let real = editable(map)?;
    let find = |id: &str| targets.iter().find(|f| f.id == id);
    let source = find(id).ok_or_else(|| format!("Feature {id} is not on this map"))?;
    if !is_connection(&source.kind) {
        return Err("Only stairs, ladders, trapdoors and doors connect levels and maps".into());
    }
    if target.map_id.as_deref() == Some(map.reference.map_id.as_str()) {
        return Err("Connect to a feature on this map without naming the map".into());
    }
    let target_id = match &target.map_id {
        Some(map_id) => connection_target(map_id, &target.feature_id),
        None => target.feature_id.clone(),
    };
    let other = find(&target_id);
    if let Some(other) = other.filter(|_| on) {
        allowed(source, other, target.map_id.is_some())?;
    }
    let mut draft = Draft::default();
    let mut next = source.clone();
    let kind = if target.map_id.is_some() {
        CONNECTS_TO
    } else {
        LEADS_TO
    };
    let named = match other {
        Some(other) => relation(target_id.clone(), other, kind),
        // A target that is gone can still be let go of: its link names it.
        None if !on => held(source, &target_id).ok_or("That connection is not held")?,
        None => return Err(format!("Feature {} is not there", target.feature_id)),
    };
    linked(&mut next, named.clone(), on);
    if let Some(other) = other.filter(|_| target.map_id.is_none()) {
        let mut back = other.clone();
        linked(&mut back, relation(source.id.clone(), source, LEADS_TO), on);
        draft.before.push(other.clone());
        draft.after.push(back);
    }
    if let Some(held) = draft
        .before
        .iter()
        .chain([source])
        .find(|f| in_locked_layer(f, real))
    {
        return Err(format!(
            "{} is on a locked layer",
            held.name.as_deref().unwrap_or(&held.kind)
        ));
    }
    let verb = if on { "Connect" } else { "Disconnect" };
    let name = source.name.clone().unwrap_or_else(|| source.kind.clone());
    draft.label = format!("{verb} {name} to {}", named.target_name);
    draft.before.push(source.clone());
    draft.after.push(next);
    Ok(draft)
}
/// The connection rule (`structure.json`): on this map, a connection kind on another level;
/// on another map, a cave or a building's door, stair or trapdoor.
fn allowed(source: &MapFeature, other: &MapFeature, foreign: bool) -> Result<(), String> {
    if foreign && !reaches(other) {
        return Err(format!(
            "{} cannot be reached from here; connect to a cave or a building's door, stair or trapdoor",
            other.name.as_deref().unwrap_or(&other.kind)
        ));
    }
    if !foreign && !lands(source, other) {
        return Err("Connect it to a stair, ladder or trapdoor on another level".into());
    }
    Ok(())
}
fn held(feature: &MapFeature, target_id: &str) -> Option<MapRelation> {
    feature
        .relations
        .iter()
        .find(|r| r.target_id == target_id && [LEADS_TO, CONNECTS_TO].contains(&r.kind.as_str()))
        .cloned()
}
/// The features that held a `leadsTo` link to a removed feature, without it: deleting a
/// stair or a level lets go of the landings that led to it, in the same undo step.
pub fn unlinked(removed: &[&MapFeature], holders: &[MapFeature]) -> Vec<(MapFeature, MapFeature)> {
    let gone = |id: &str| removed.iter().any(|f| f.id == id);
    holders
        .iter()
        .filter(|holder| !gone(&holder.id))
        .filter(|holder| {
            holder
                .relations
                .iter()
                .any(|r| r.kind == LEADS_TO && gone(&r.target_id))
        })
        .map(|holder| {
            let mut next = holder.clone();
            next.relations
                .retain(|r| !(r.kind == LEADS_TO && gone(&r.target_id)));
            (holder.clone(), next)
        })
        .collect()
}
