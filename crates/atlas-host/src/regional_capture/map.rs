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
    records: &dyn FeatureReader,
    spatial: &dyn SpatialKernel,
) -> io::Result<Capture> {
    // A city map is refined over its settlement's surroundings, whatever was clicked.
    let surrounded;
    let selection = match selection.city {
        Some(city) => {
            let settlement = records.get(city.settlement)?.ok_or_else(|| {
                io::Error::other("A city map opens at one of the parent map's settlements")
            })?;
            // A city near its parent's edge keeps the part of its surroundings the parent holds.
            let ring = atlas_generation::town::city::surroundings(&settlement)?;
            let parent = atlas_map::regions::as_geometry(&selection.parent.footprint);
            let outline = spatial
                .overlay(
                    &ring,
                    &parent,
                    atlas_generation::spatial::Overlay::Intersection,
                )
                .map_err(io::Error::other)?
                .and_then(atlas_map::regions::polygon)
                .ok_or_else(|| io::Error::other("The city's surroundings lie outside its map"))?;
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
