//! Capture selected geography using the same map query on either execution host.
use crate::{
    generation_document::Document,
    generation_frame::Geography,
    regional_capture::{Capture, Selection, Source},
};
use atlas_generation::{
    features::{
        composition::{present, Composition},
        FeatureReader,
    },
    spatial::SpatialKernel,
};
use atlas_gis::map_store::{FeatureQuery, MapAccess};
use std::io;
pub fn capture(
    selection: Selection<'_>,
    document: Document,
    inputs: &impl Source,
    maps: &dyn MapAccess,
    files: &atlas_gis::map_files::MapFiles,
    records: &dyn FeatureReader,
    spatial: &dyn SpatialKernel,
) -> io::Result<Capture> {
    // A city map is refined over its settlement's surroundings, whatever was clicked.
    let surrounded;
    let selection = match selection.city {
        Some(city) => {
            let edge = super::city::outline(&selection, city.settlement, maps, files, spatial)?;
            let parent = atlas_map::regions::as_geometry(&selection.parent.footprint);
            let outline = if spatial
                .relation(&parent, &edge, atlas_generation::spatial::Predicate::Covers)
                .map_err(io::Error::other)?
            {
                edge
            } else {
                spatial
                    .overlay(
                        &edge,
                        &parent,
                        atlas_generation::spatial::Overlay::Intersection,
                    )
                    .map_err(io::Error::other)?
                    .and_then(atlas_map::regions::polygon)
                    .ok_or_else(|| {
                        io::Error::other("The city outline lies outside its parent map")
                    })?
            };
            surrounded = atlas_map::RegionSelection {
                geometry: serde_json::from_value(serde_json::to_value(outline)?)?,
                region_path: Vec::new(),
                ..selection.selection.clone()
            };
            Selection {
                selection: &surrounded,
                ..selection
            }
        }
        None => selection,
    };
    let geography: Geography = serde_json::from_value(document.world.clone())?;
    let context = geography.context();
    let area = context
        .area(selection.parent.reference.map_id)
        .map_err(io::Error::other)?;
    let composition = Composition {
        context: &context,
        features: records,
        spatial,
        area: area.id,
        profile: area.profile,
    };
    let mut query = FeatureQuery {
        space_id: selection.selection.space_id,
        geometry: Some(selection.footprint(&document, spatial)?.extent),
        ..Default::default()
    };
    let mut features = Vec::new();
    loop {
        let page = maps.features(&selection.parent.reference, &query)?;
        for published in page.items {
            if selection.city.is_some_and(|c| c.settlement == published.id)
                || (selection.city.is_some() || selection.real_scale.is_some())
                    && super::records::fixed_geography(&published.kind)
            {
                features.push(urban_record(published, area.id, records)?);
                continue;
            }
            if let Some(feature) = records.get(published.id)? {
                if let Some(composed) = present(&composition, &feature).map_err(|error| {
                    io::Error::other(format!(
                        "Composing captured {} {}: {error}",
                        feature.kind, feature.id
                    ))
                })? {
                    features.push(composed);
                }
            }
        }
        query.cursor = page.next;
        if query.cursor.is_none() {
            break;
        }
    }
    selection.capture(document, features, inputs, spatial)
}

/// The pinned playable map supplies the geometry even when an authored feature has
/// no numerical record. An existing private record can still supply ownership metadata.
fn urban_record(
    published: atlas_map::MapFeature,
    area: atlas_map::Id,
    records: &dyn FeatureReader,
) -> io::Result<atlas_generation::features::Feature> {
    use atlas_generation::features::{records::Relation, Feature, State};
    let previous = records.get(published.id)?;
    let authored =
        published.catalog.origin.eq_ignore_ascii_case("authored") || published.catalog.map_only;
    let state = if authored {
        State::Authored
    } else {
        previous.as_ref().map_or(State::Generated, |f| f.state)
    };
    Ok(Feature {
        id: published.id,
        place_id: published.entity_id,
        area_id: area,
        name: published.name.unwrap_or_else(|| published.kind.clone()),
        kind: published.kind,
        layer_id: published
            .layer_id
            .strip_prefix("vector:")
            .unwrap_or(&published.layer_id)
            .into(),
        geometry: published.geometry,
        footprint: published
            .footprint
            .as_ref()
            .map(atlas_map::regions::as_geometry),
        attributes: published.attributes.into_iter().collect(),
        relations: published
            .relations
            .into_iter()
            .filter(|r| r.target_map_id.is_none())
            .map(|r| Relation {
                kind: r.kind,
                target_id: r.target_id,
            })
            .collect(),
        state,
        protected: authored || previous.as_ref().is_some_and(|f| f.protected),
        detail: Default::default(),
        map_only: None,
        actor: previous
            .as_ref()
            .map_or_else(|| published.catalog.origin.clone(), |f| f.actor.clone()),
        generation_id: None,
        generation_domain: previous.and_then(|f| f.generation_domain),
        causes: published.causes,
    })
}
