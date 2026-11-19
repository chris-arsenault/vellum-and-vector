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
        geometry: Some(selection.footprint(&document, spatial)?),
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
