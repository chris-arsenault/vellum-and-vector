//! Existing geometry write extents and inherited network interfaces for non-owned areas.
mod stations;
use super::super::{resolution::Profile, state::Scope};
use crate::{
    features::{
        composition::Composition, context::Context, network, Feature, FeatureReader,
        FeatureSelection,
    },
    spatial::{Overlay, Predicate, SpatialKernel},
};
use atlas_map::{Geometry, Position};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Crossing {
    pub feature_id: String,
    pub point: network::Position,
    pub elevation: f64,
    pub flow: f64,
    pub direction: Option<String>,
    pub elevation_known: Option<bool>,
    pub flow_known: Option<bool>,
    pub flow_minimum: Option<f64>,
    pub flow_maximum: Option<f64>,
    pub flow_uncertainty: Option<f64>,
}
pub struct Rules {
    pub context: Context,
    // hpc-exempt: sparse area contracts and layer identifiers, not numerical field state.
    pub boundaries: BTreeMap<String, Vec<Crossing>>,
    pub network_layers: BTreeSet<String>,
}
impl Rules {
    pub fn validate(
        &self,
        before: &dyn FeatureReader,
        after: &dyn FeatureReader,
        scope: &Scope,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        if scope.owns_map_geography {
            return Ok(());
        }
        for current in after.values(FeatureSelection::default())? {
            let current = current?;
            let previous = before.get(&current.id)?;
            if previous.as_ref() != Some(&current) {
                self.changed(
                    previous.as_ref(),
                    Some(&current),
                    [before, after],
                    scope,
                    spatial,
                )?;
            }
        }
        for previous in before.values(FeatureSelection::default())? {
            let previous = previous?;
            if after.get(&previous.id)?.is_none() {
                self.changed(Some(&previous), None, [before, after], scope, spatial)?;
            }
        }
        Ok(())
    }
    fn changed(
        &self,
        previous: Option<&Feature>,
        current: Option<&Feature>,
        readers: [&dyn FeatureReader; 2],
        scope: &Scope,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        let old = Composition {
            context: &self.context,
            features: readers[0],
            spatial,
            area: &scope.area,
            profile: Profile::Interior,
        };
        let new = Composition {
            features: readers[1],
            ..old
        };
        let geometry = |composition: &Composition<'_>,
                        feature: Option<&Feature>,
                        footprint|
         -> io::Result<_> {
            feature
                .map(|feature| {
                    if footprint {
                        composition.footprint_all(feature)
                    } else {
                        composition.geometry_all(feature)
                    }
                })
                .transpose()
                .map(Option::flatten)
                .map_err(io::Error::other)
        };
        for footprint in [false, true] {
            changed_extent(
                geometry(&old, previous, footprint)?,
                geometry(&new, current, footprint)?,
                &scope.footprint,
                spatial,
            )?;
        }
        let id = current.or(previous).expect("changed feature").id.as_str();
        for (area_id, crossings) in &self.boundaries {
            let area = self.context.area(area_id).map_err(io::Error::other)?;
            if area.parent_id.is_some() && area.profile == Profile::Region {
                continue;
            }
            let expected: Vec<_> = crossings
                .iter()
                .filter(|crossing| crossing.feature_id == id)
                .collect();
            let Some(feature) = current else {
                if !expected.is_empty() {
                    return Err(io::Error::other(
                        "Generation retains contracted network features",
                    ));
                }
                continue;
            };
            if !self.network_layers.contains(&feature.layer_id)
                || self
                    .context
                    .space(&feature.area_id)
                    .map_err(io::Error::other)?
                    != self.context.space(area_id).map_err(io::Error::other)?
            {
                continue;
            }
            if let Some(shape) = new.geometry_all(feature).map_err(io::Error::other)? {
                stations::validate(
                    &stations::Query {
                        context: &self.context,
                        spatial,
                        precision: scope.precision,
                    },
                    feature,
                    &shape,
                    &area.footprint,
                    &expected,
                )?;
            }
        }
        Ok(())
    }
}
fn changed_extent(
    before: Option<Geometry>,
    after: Option<Geometry>,
    footprint: &Geometry,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    if before == after {
        return Ok(());
    }
    let changes = match (before, after) {
        (Some(a), Some(b)) => vec![
            spatial
                .overlay(&a, &b, Overlay::Difference)
                .map_err(io::Error::other)?,
            spatial
                .overlay(&b, &a, Overlay::Difference)
                .map_err(io::Error::other)?,
        ],
        (a, b) => vec![a, b],
    };
    for shape in changes.into_iter().flatten() {
        if !spatial
            .relation(footprint, &shape, Predicate::Covers)
            .map_err(io::Error::other)?
            && spatial
                .overlay(&shape, footprint, Overlay::Difference)
                .map_err(io::Error::other)?
                .is_some()
        {
            return Err(io::Error::other(
                "The declared edit extent must contain the geography it adds, removes or moves",
            ));
        }
    }
    Ok(())
}
impl Crossing {
    fn position(&self) -> Position {
        Position::XYZ([self.point.x, self.point.y, self.point.z])
    }
}
