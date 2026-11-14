//! Preserve an existing subject's identity when publishing a finer generated drawing.
use super::{Feature, FeatureSelection, FeatureWorkspace, Representation, State};
use crate::identity::semantic_id;
use std::io;

pub struct Scope<'a> {
    pub world: &'a str,
    pub owns_map_geography: bool,
    pub is_descendant: &'a dyn Fn(&str, &str) -> bool,
}
fn previous(
    workspace: &dyn FeatureWorkspace,
    feature: &Feature,
    selection: FeatureSelection<'_>,
    matches: &dyn Fn(&Feature) -> bool,
    scope: &Scope<'_>,
) -> io::Result<Option<Feature>> {
    let selection = if scope.owns_map_geography {
        FeatureSelection {
            area_id: Some(&feature.area_id),
            ..selection
        }
    } else {
        selection
    };
    for candidate in workspace.values(selection)? {
        let candidate = candidate?;
        if matches(&candidate)
            && (scope.owns_map_geography
                || (candidate.area_id != feature.area_id
                    && (scope.is_descendant)(&feature.area_id, &candidate.area_id)))
        {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}
pub fn put_generated_detail(
    workspace: &mut dyn FeatureWorkspace,
    feature: Feature,
    matches: &dyn Fn(&Feature) -> bool,
    selection: FeatureSelection<'_>,
    scope: &Scope<'_>,
) -> io::Result<bool> {
    let Some(mut previous) = previous(workspace, &feature, selection, matches, scope)? else {
        return Ok(false);
    };
    if previous.protected || previous.state == State::Authored {
        return Ok(true);
    }
    if scope.owns_map_geography {
        let mut feature = feature;
        feature.id = previous.id.clone();
        feature.place_id = Some(previous.place_id.unwrap_or(previous.id));
        feature.name = previous.name;
        workspace.put(feature)?;
        return Ok(true);
    }
    if previous
        .detail
        .get(&feature.area_id)
        .is_some_and(|detail| detail.protected || detail.state == State::Authored)
    {
        return Ok(true);
    }
    let id = semantic_id(
        scope.world,
        "representation",
        &serde_json::to_string(&[&previous.id, &feature.area_id])?,
    )?;
    previous.detail.insert(
        feature.area_id,
        Representation {
            id: Some(id),
            geometry: feature.geometry,
            attributes: Some(feature.attributes),
            state: State::Generated,
            protected: false,
            needs_reconciliation: false,
            actor: "generator".into(),
            generation_id: None,
            map_only: None,
            map_source: None,
            map_baseline: None,
            footprint: None,
        },
    );
    workspace.put(previous)?;
    Ok(true)
}
