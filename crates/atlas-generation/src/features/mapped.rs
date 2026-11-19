//! Preserve deferred map drawings while generation reads the captured procedural baseline.
use super::{
    composition::{present, Composition},
    context::Context,
    network::{NetworkReader, NetworkWorkspace, Selection},
    records::{Attributes, MapBaseline},
    Feature, FeatureReader, FeatureSelection, FeatureWorkspace, Representation, State,
};
use crate::{
    atlas::resolution::Profile,
    spatial::{Overlay, Predicate, SpatialKernel},
};
use atlas_map::{Geometry, Id};
use std::io;

const NAMING: &[&str] = &["nameStatus", "naming", "nameSource", "nameMeaning"];
fn structural_attributes(attributes: &Attributes) -> Attributes {
    attributes
        .iter()
        .filter(|(key, _)| !NAMING.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}
pub fn structural(detail: &Representation, feature: &Feature) -> bool {
    let Some(before) = &detail.map_baseline else {
        return true;
    };
    detail.state == State::IntentionallyEmpty
        || before.geometry != detail.geometry
        || before.footprint != detail.footprint
        || before.relations != feature.relations
        || structural_attributes(&before.attributes)
            != structural_attributes(detail.attributes.as_ref().unwrap_or(&Attributes::new()))
}
pub fn validate(
    context: &Context,
    area: Id,
    source: &dyn FeatureReader,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    let selected = context.area(area).map_err(io::Error::other)?;
    if !matches!(selected.profile, Profile::World | Profile::Region) {
        return Ok(());
    }
    for item in source.values(FeatureSelection::default())? {
        let feature = item?;
        if feature.map_only == Some(true) && !feature.detail.contains_key(&feature.area_id) {
            overlap(
                context,
                area,
                feature.area_id,
                &feature.name,
                [&feature.geometry]
                    .into_iter()
                    .chain(feature.footprint.as_ref()),
                spatial,
            )?;
        }
        for (owner, detail) in &feature.detail {
            if detail.map_only != Some(true) {
                continue;
            }
            if feature.map_only == Some(true) {
                if detail.state != State::IntentionallyEmpty {
                    overlap(
                        context,
                        area,
                        *owner,
                        &feature.name,
                        [&detail.geometry]
                            .into_iter()
                            .chain(detail.footprint.as_ref()),
                        spatial,
                    )?;
                }
            } else if structural(detail, &feature) {
                let baseline = detail.map_baseline.as_ref();
                overlap(
                    context,
                    area,
                    *owner,
                    &feature.name,
                    baseline
                        .map(|b| &b.geometry)
                        .into_iter()
                        .chain(baseline.and_then(|b| b.footprint.as_ref()))
                        .chain([&detail.geometry])
                        .chain(detail.footprint.as_ref()),
                    spatial,
                )?;
            }
        }
    }
    Ok(())
}
pub fn overlap<'a>(
    context: &Context,
    area: Id,
    owner: Id,
    name: &str,
    geometry: impl Iterator<Item = &'a Geometry>,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    let selected = context.area(area).map_err(io::Error::other)?;
    if !matches!(selected.profile, Profile::World | Profile::Region)
        || context.space(area).map_err(io::Error::other)?
            != context.space(owner).map_err(io::Error::other)?
    {
        return Ok(());
    }
    for shape in geometry {
        if spatial
            .relation(&selected.footprint, shape, Predicate::Intersects)
            .map_err(io::Error::other)?
        {
            return Err(io::Error::other(format!(
                "mapped_edit_overlap: This generation overlaps {name} edited on {}. Choose an untouched region or undo the structural edit. Names and styles do not restrict refinement.",
                context.area(owner).map_err(io::Error::other)?.name,
            )));
        }
    }
    Ok(())
}
pub fn restore(
    context: &Context,
    original: &dyn FeatureReader,
    features: &mut dyn FeatureWorkspace,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    for item in original.values(FeatureSelection::default())? {
        let feature = item?;
        if feature.map_only != Some(true)
            && !feature.detail.values().any(|d| d.map_only == Some(true))
        {
            continue;
        }
        let mut target = if feature.map_only == Some(true) {
            feature.clone()
        } else {
            features.get(feature.id)?.unwrap_or_else(|| feature.clone())
        };
        for (&area, detail) in &feature.detail {
            if detail.map_only != Some(true) {
                continue;
            }
            let retained = if structural(detail, &feature) {
                detail.clone()
            } else {
                refresh(context, features, spatial, &target, area, detail)?
            };
            target.detail.insert(area, retained);
            target.name.clone_from(&feature.name);
            target.relations.clone_from(&feature.relations);
        }
        features.put(target)?;
    }
    Ok(())
}
fn refresh(
    context: &Context,
    features: &dyn FeatureReader,
    spatial: &dyn SpatialKernel,
    feature: &Feature,
    area: Id,
    detail: &Representation,
) -> io::Result<Representation> {
    let selected = context.area(area).map_err(io::Error::other)?;
    let before = present(
        &Composition {
            context,
            features,
            spatial,
            area,
            profile: selected.profile,
        },
        feature,
    )
    .map_err(io::Error::other)?
    .ok_or_else(|| io::Error::other("Retained names require their mapped feature"))?;
    let geometry = spatial
        .overlay(&before.geometry, &selected.footprint, Overlay::Intersection)
        .map_err(io::Error::other)?
        .ok_or_else(|| io::Error::other("Retained names require their mapped geometry"))?;
    let footprint = before
        .footprint
        .as_ref()
        .map(|shape| spatial.overlay(shape, &selected.footprint, Overlay::Intersection))
        .transpose()
        .map_err(io::Error::other)?
        .flatten();
    let baseline = MapBaseline {
        geometry,
        footprint,
        attributes: before.attributes,
        relations: before.relations,
    };
    let mut attributes = baseline.attributes.clone();
    let original = detail
        .map_baseline
        .as_ref()
        .expect("nonstructural drawing has baseline");
    for key in NAMING {
        let edited = detail
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.get(*key));
        if original.attributes.get(*key) != edited {
            if let Some(value) = edited {
                attributes.insert((*key).into(), value.clone());
            } else {
                attributes.remove(*key);
            }
        }
    }
    let mut result = detail.clone();
    result.geometry.clone_from(&baseline.geometry);
    result.footprint.clone_from(&baseline.footprint);
    result.map_source = feature.detail.get(&area).cloned().map(Box::new);
    result.map_baseline = Some(baseline);
    result.attributes = Some(attributes);
    Ok(result)
}
pub fn restore_networks(
    source: &dyn NetworkReader,
    original: &dyn FeatureReader,
    target: &mut dyn NetworkWorkspace,
) -> io::Result<()> {
    for reach in source.reaches(Selection::default())? {
        let reach = reach?;
        if original
            .get(reach.feature_id)?
            .is_none_or(|f| f.map_only != Some(true))
        {
            continue;
        }
        for id in [reach.start, reach.end] {
            if let Some(node) = source.node(id)? {
                target.put_node(node)?;
            }
        }
        target.put_reach(reach)?;
    }
    Ok(())
}
