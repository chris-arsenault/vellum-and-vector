mod borders;
mod ocean;
use crate::{
    features::Feature,
    spatial::{Overlay, SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, IllustrationGeometry};
pub use ocean::{drawn_ocean, Ocean};
// hpc-exempt: published feature identities and derived GIS shapes, not numerical field storage.
use std::collections::BTreeMap;

const POLITICAL: [&str; 4] = ["sovereignty", "control", "claims", "administration"];
fn polygon(shape: &Geometry) -> bool {
    matches!(
        shape,
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
    )
}
pub fn records(
    features: &[Feature],
    oceans: Vec<Geometry>,
    spatial: &dyn SpatialKernel,
) -> SpatialResult<Vec<IllustrationGeometry>> {
    // hpc-exempt: published feature identities and derived GIS shapes, not numerical field storage.
    let mut shapes: BTreeMap<_, _> = features
        .iter()
        .map(|f| (f.id.clone(), Some(f.geometry.clone())))
        .collect();
    for layer in POLITICAL {
        let selected = features
            .iter()
            .filter(|f| {
                f.layer_id == layer
                    && polygon(&f.geometry)
                    && f.attributes
                        .get("boundaryDerivation")
                        .and_then(serde_json::Value::as_str)
                        != Some("supported-reach")
            })
            .collect::<Vec<_>>();
        borders::soften(&selected, &mut shapes, spatial)?;
    }
    let mut water = oceans.clone();
    water.extend(
        features
            .iter()
            .filter(|f| f.kind == "lake")
            .map(|f| f.geometry.clone()),
    );
    // A landlocked map without lakes has no water to cut from its shapes.
    let water = match water.is_empty() {
        true => None,
        false => spatial.union_all(&water)?,
    };
    let mut result = oceans
        .into_iter()
        .map(|geometry| IllustrationGeometry {
            feature_id: None,
            geometry: Some(geometry),
        })
        .collect::<Vec<_>>();
    for feature in features.iter().filter(|f| {
        polygon(&f.geometry)
            && (POLITICAL.contains(&f.layer_id.as_str()) || f.layer_id == "ecology")
    }) {
        let shape = shapes.remove(&feature.id).flatten();
        let shape = match (shape, &water) {
            (Some(shape), Some(water)) => spatial.overlay(&shape, water, Overlay::Difference)?,
            (shape, _) => shape,
        };
        result.push(IllustrationGeometry {
            feature_id: Some(feature.id.clone()),
            geometry: shape,
        });
    }
    Ok(result)
}
