use crate::{
    atlas::state::State,
    ecology::lifecycle::Authority,
    features::{FeatureSelection, State as FeatureState},
    spatial::Predicate,
};
// hpc-exempt: area identities and their located spaces.
use std::{collections::BTreeMap, io};

pub(super) fn authority(
    state: &State,
    areas: &BTreeMap<String, String>,
    regional: bool,
) -> io::Result<Authority> {
    if regional {
        return state.regional_ecology_authority(Vec::new());
    }
    let mut woodland = Vec::new();
    for feature in state.records.features.values(FeatureSelection {
        kind: Some("forest"),
        ..Default::default()
    })? {
        let feature = feature?;
        if feature.state == FeatureState::Generated {
            continue;
        }
        let space = areas
            .get(&feature.area_id)
            .ok_or_else(|| io::Error::other("Authored ecology requires its located area"))?;
        if space != &state.scope.space
            || !state
                .spatial
                .relation(
                    &feature.geometry,
                    &state.scope.footprint,
                    Predicate::Intersects,
                )
                .map_err(io::Error::other)?
        {
            continue;
        }
        woodland.push(feature.geometry);
    }
    state
        .field()
        .ecology_authority(&woodland, state.spatial.as_ref(), None)
}
