use super::geometry::{as_geometry, as_region};
use crate::spatial::{Overlay, Predicate, SpatialKernel, SpatialResult};
use crate::{MapDescriptor, MapNavigationState, MapRegion, NavigationChange};
use std::collections::BTreeSet;

pub fn lineage<'a>(
    state: &'a MapNavigationState,
    mut id: Option<&'a str>,
) -> SpatialResult<Vec<&'a MapRegion>> {
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    while let Some(next) = id {
        if !seen.insert(next.to_owned()) {
            return Err("Region parents must not form a cycle".into());
        }
        let region = state
            .regions
            .iter()
            .find(|region| region.id == next)
            .ok_or("Choose an existing parent region")?;
        result.push(region);
        id = region.parent_id.as_deref();
    }
    result.reverse();
    Ok(result)
}

pub fn change_navigation(
    map: &MapDescriptor,
    state: &MapNavigationState,
    change: NavigationChange,
    kernel: &dyn SpatialKernel,
) -> SpatialResult<MapNavigationState> {
    let mut next = state.clone();
    match change {
        NavigationChange::AttachChild { region_id, child } => {
            let region = next
                .regions
                .iter_mut()
                .find(|region| region.id == region_id)
                .ok_or("Choose an existing region")?;
            if region
                .child
                .as_ref()
                .is_some_and(|current| *current != child)
            {
                return Err("Open the region's existing finer map".into());
            }
            region.child = Some(child);
        }
        NavigationChange::PutRegion(mut region) => {
            if region.id.is_empty() || region.name.trim().is_empty() {
                return Err("A region needs identity and name".into());
            }
            let previous = state.regions.iter().find(|value| value.id == region.id);
            if region.child.as_ref() != previous.and_then(|previous| previous.child.as_ref()) {
                return Err("A region's finer map is attached by generation".into());
            }
            if previous.is_some_and(|value| value.space_id != region.space_id) {
                return Err("A region retains its coordinate space".into());
            }
            region.geometry = as_region(kernel.canonical(&as_geometry(&region.geometry))?)?;
            next.regions.retain(|value| value.id != region.id);
            next.regions.push(region.clone());
            validate_region(map, &next, &region, previous, kernel)?;
        }
        NavigationChange::RemoveRegion(id) => {
            let region = state
                .regions
                .iter()
                .find(|region| region.id == id)
                .ok_or("Choose an existing region")?;
            if region.child.is_some()
                || state
                    .regions
                    .iter()
                    .any(|region| region.parent_id.as_ref() == Some(&id))
                || state
                    .views
                    .iter()
                    .any(|view| view.region_id.as_ref() == Some(&id))
            {
                return Err("Retained by a finer map, child regions or saved map views".into());
            }
            next.regions.retain(|value| value.id != id);
        }
        NavigationChange::PutView(view) => {
            if view.id.is_empty() || view.name.trim().is_empty() {
                return Err("A view needs identity and name".into());
            }
            if let Some(region_id) = &view.region_id {
                if !state.regions.iter().any(|region| region.id == *region_id) {
                    return Err("Choose a region on this map".into());
                }
            }
            next.views.retain(|value| value.id != view.id);
            next.views.push(view);
        }
        NavigationChange::RemoveView(id) => {
            if !state.views.iter().any(|view| view.id == id) {
                return Err("Choose an existing map view".into());
            }
            next.views.retain(|value| value.id != id);
        }
    }
    next.version = state
        .version
        .checked_add(1)
        .ok_or("Presentation version exceeded its numerical representation")?;
    Ok(next)
}
pub fn validate_navigation(
    map: &MapDescriptor,
    state: &MapNavigationState,
    kernel: &dyn SpatialKernel,
) -> SpatialResult<()> {
    let mut ids = BTreeSet::new();
    for region in &state.regions {
        if region.id.is_empty() || region.name.trim().is_empty() || !ids.insert(&region.id) {
            return Err("Regions need distinct identities and names".into());
        }
        validate_region(map, state, region, None, kernel)?;
    }
    let mut views = BTreeSet::new();
    for view in &state.views {
        if view.id.is_empty() || view.name.trim().is_empty() || !views.insert(&view.id) {
            return Err("Views need distinct identities and names".into());
        }
        if view.region_id.as_ref().is_some_and(|id| !ids.contains(id)) {
            return Err("Choose a region on this map".into());
        }
    }
    Ok(())
}
fn validate_region(
    map: &MapDescriptor,
    state: &MapNavigationState,
    region: &MapRegion,
    previous: Option<&MapRegion>,
    kernel: &dyn SpatialKernel,
) -> SpatialResult<()> {
    if !map.region_scale.enabled || region.space_id != map.primary_space_id {
        return Err("Select regions on a geographic map".into());
    }
    let space = map
        .spaces
        .iter()
        .find(|space| space.id == region.space_id)
        .ok_or("Choose an existing coordinate space")?;
    let shape = as_geometry(&region.geometry);
    if let Some(previous) = previous.filter(|previous| previous.child.is_some()) {
        let old = as_geometry(&previous.geometry);
        if previous.parent_id != region.parent_id
            || !kernel.relation(&old, &shape, Predicate::Covers)?
            || !kernel.relation(&shape, &old, Predicate::Covers)?
        {
            return Err(
                "A finer map uses this outline. Choose a new region for a different extent".into(),
            );
        }
    }
    let ancestry = lineage(state, Some(&region.id))?;
    let parent = ancestry.iter().rev().nth(1).map_or_else(
        || as_geometry(&map.footprint),
        |region| as_geometry(&region.geometry),
    );
    let area = kernel.area(&shape)?;
    if 2.0 * area / kernel.length(&shape)? < map.region_scale.minimum_width {
        return Err("Choose a region with useful width".into());
    }
    if !kernel.relation(&parent, &shape, Predicate::Covers)? {
        return Err("Keep the outline inside its parent region".into());
    }
    if area >= kernel.area(&parent)? {
        return Err("Choose a region smaller than its parent".into());
    }
    for other in &state.regions {
        if other.id == region.id {
            continue;
        }
        let footprint = as_geometry(&other.geometry);
        if other.parent_id.as_ref() == Some(&region.id)
            && !kernel.relation(&shape, &footprint, Predicate::Covers)?
        {
            return Err("Keep existing child regions inside the adjusted outline".into());
        }
        if other.parent_id != region.parent_id {
            continue;
        }
        if let Some(overlap) = kernel.overlay(&shape, &footprint, Overlay::Intersection)? {
            if kernel.area(&overlap)? > space.precision.powi(2) {
                return Err(
                    "This part already belongs to a sibling region. Choose an unselected part"
                        .into(),
                );
            }
        }
    }
    Ok(())
}
