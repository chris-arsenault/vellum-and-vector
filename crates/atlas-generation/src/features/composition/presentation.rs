use super::Composition;
use crate::{
    features::{Feature, State},
    spatial::{Overlay, Predicate, SpatialResult},
};

pub fn present(composition: &Composition<'_>, feature: &Feature) -> SpatialResult<Option<Feature>> {
    let context = composition.context;
    let owner = context.area(&feature.area_id)?;
    let area = context.area(composition.area)?;
    if context.space(&owner.id)? != context.space(&area.id)?
        || owner.profile > area.profile
        || !context
            .geography_areas(&area.id)?
            .contains(&owner.id.as_str())
    {
        return Ok(None);
    }
    let Some(mut geometry) = composition.geometry(feature)? else {
        return Ok(None);
    };
    let mut footprint = composition.footprint(feature)?;
    if !area.owns_geography() {
        let spatial = composition.spatial;
        let intersects = spatial.relation(&geometry, &area.footprint, Predicate::Intersects)?;
        let extent_intersects = footprint
            .as_ref()
            .map(|f| spatial.relation(f, &area.footprint, Predicate::Intersects))
            .transpose()?
            .unwrap_or(false);
        if !intersects && !extent_intersects {
            return Ok(None);
        }
        if area.region_id.is_some() {
            let Some(clipped) =
                spatial.overlay(&geometry, &area.footprint, Overlay::Intersection)?
            else {
                return Ok(None);
            };
            geometry = clipped;
            footprint = match footprint {
                Some(shape) => spatial.overlay(&shape, &area.footprint, Overlay::Intersection)?,
                None => None,
            };
        }
    }
    let mut result = feature.clone();
    result.geometry = geometry;
    result.footprint = footprint;
    for area in context.lineage(&area.id)? {
        let Some(detail) = feature.detail.get(&area.id) else {
            continue;
        };
        if !detail.needs_reconciliation
            && !matches!(detail.state, State::Stale | State::Unmaterialized)
        {
            if let Some(attributes) = &detail.attributes {
                result.attributes = attributes.clone();
            }
            result.state = detail.state;
            result.actor = detail.actor.clone();
            result.protected = detail.protected;
            result.generation_id = detail.generation_id.clone();
            if detail.map_only == Some(true) {
                result.map_only = Some(true);
            }
        }
        break;
    }
    Ok(Some(result))
}
