//! A stair, ladder or trapdoor that goes (deleted, or with its level) lets go of the
//! landings that led to it in the same step, so no link points at nothing and undo brings
//! both ends back.
use super::EditStore;
use crate::map_store::FeatureQuery;
use atlas_map::{
    authoring::{family, unlinked, Draft},
    structure::is_connection,
    MapDescriptor, MapFeature,
};
use std::io;

pub(super) fn release(
    store: &dyn EditStore,
    map: &MapDescriptor,
    draft: &mut Draft,
) -> io::Result<()> {
    let kept = |id| draft.after.iter().any(|f| f.id == id);
    let removed: Vec<MapFeature> = draft
        .before
        .iter()
        .filter(|f| is_connection(&f.kind) && !kept(f.id))
        .cloned()
        .collect();
    if removed.is_empty() {
        return Ok(());
    }
    let layers = map
        .layers
        .iter()
        .filter(|layer| family(&layer.id) == "structures")
        .map(|layer| layer.id.clone())
        .collect();
    let stored = store.all(
        map,
        FeatureQuery {
            layer_ids: Some(layers),
            ..Default::default()
        },
    )?;
    // A holder the change already carries is read as the change leaves it.
    let holders: Vec<MapFeature> = stored
        .into_iter()
        .map(|f| {
            draft
                .after
                .iter()
                .find(|a| a.id == f.id)
                .cloned()
                .unwrap_or(f)
        })
        .collect();
    let removed: Vec<&MapFeature> = removed.iter().collect();
    for (before, after) in unlinked(&removed, &holders) {
        match draft.after.iter_mut().find(|a| a.id == after.id) {
            Some(carried) => *carried = after,
            None => {
                draft.before.push(before);
                draft.after.push(after);
            }
        }
    }
    Ok(())
}
