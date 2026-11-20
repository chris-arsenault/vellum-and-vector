//! What a city map publishes of its hot-spot towns: their thoroughfares and their blocks, each
//! block with its use. The towns develop at city fidelity, so a street is a thoroughfare and a
//! holding a block; their premises, houses and ordinary streets are a district map's.
use crate::{
    atlas::state::State,
    field::poi::{
        kinds::Kind,
        map_records::{generated, Record},
        values::Place,
    },
    field::refinement::courses::cell_at,
    town::catalogue::{Activity, PlaceRules},
};
use atlas_map::{Geometry, Position};
use std::io;

/// The use a block of a city map shows: what most of its premises do.
pub(super) fn block_use(activity: Activity) -> &'static str {
    match activity {
        Activity::Household => "residential",
        Activity::Trade | Activity::Hospitality | Activity::Service | Activity::Production => {
            "business"
        }
        Activity::Institution => "civic",
        Activity::Agriculture => "farmstead",
    }
}

/// Every hot-spot town's thoroughfares, each as its line with its class.
pub(super) fn thoroughfare_records(state: &State) -> io::Result<Vec<Place>> {
    let mesh = state.field().mesh();
    let mut records = Vec::new();
    for (t, town) in state.town.towns.iter().enumerate() {
        for (s, street) in town.streets().iter().enumerate() {
            let Some(&first) = street.points.first() else {
                continue;
            };
            let Some(cell) = cell_at(mesh, first) else {
                continue;
            };
            let line = street
                .points
                .iter()
                .map(|&[x, y]| Position::xy(x, y))
                .collect();
            let mut attributes = crate::features::records::Attributes::new();
            attributes.insert("class".into(), street.class.as_str().into());
            // A district map that captures the thoroughfare lays it at its width.
            attributes.insert("widths".into(), street.widths.clone().into());
            let key = format!("city-thoroughfare-{t}-{s}");
            let feature = generated(
                state,
                Record {
                    key: &key,
                    name: "Thoroughfare",
                    kind: "thoroughfare",
                    layer: "roads",
                    geometry: Geometry::LineString { coordinates: line },
                    attributes,
                },
            )?;
            let mut place = Place::at(Kind::CityThoroughfare, cell, vec![cell]);
            place.id = key;
            place.feature = Some(feature);
            records.push(place);
        }
    }
    Ok(records)
}

/// Every hot-spot town's standing blocks, each as its outline with its use and the people it
/// houses.
pub(super) fn block_records(state: &State) -> io::Result<Vec<Place>> {
    let mesh = state.field().mesh();
    let mut records = Vec::new();
    for (t, town) in state.town.towns.iter().enumerate() {
        for holding in town.holdings().iter().filter(|h| h.standing()) {
            let Some(cell) = cell_at(mesh, holding.slot.front) else {
                continue;
            };
            let definition = holding.kind.definition();
            let mut attributes = crate::features::records::Attributes::new();
            attributes.insert("use".into(), block_use(definition.activity).into());
            attributes.insert("place".into(), definition.label.into());
            attributes.insert(
                "housed".into(),
                super::spots::housed(holding, state.spatial.as_ref())?
                    .round()
                    .into(),
            );
            let key = format!("city-block-{t}-{}", holding.id.0);
            let feature = generated(
                state,
                Record {
                    key: &key,
                    name: "City block",
                    kind: "cityBlock",
                    layer: "landUse",
                    geometry: holding.outline.clone(),
                    attributes,
                },
            )?;
            let mut place = Place::at(Kind::CityBlock, cell, vec![cell]);
            place.id = key;
            place.feature = Some(feature);
            records.push(place);
        }
    }
    Ok(records)
}
