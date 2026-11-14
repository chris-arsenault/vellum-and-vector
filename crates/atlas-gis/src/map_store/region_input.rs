use super::{
    interactions::{as_region, collect},
    records::region_geometry,
    samples::canonical_position,
    space, FeatureQuery, MapAccess,
};
use atlas_map::{
    regions::RegionInput, Bounds, Geometry, MapRef, MapSpace, Position, PublishedAsset,
    RegionCandidate, RegionDrawing, RegionQuery,
};
use serde::Deserialize;
use std::{collections::BTreeMap, future::Future, io};

impl dyn MapAccess + '_ {
    pub async fn region_input<F: Future<Output = io::Result<Vec<u8>>>>(
        &self,
        reference: &MapRef,
        navigation: atlas_map::MapNavigationState,
        query: &RegionQuery,
        drawing: Option<&RegionDrawing>,
        mut read: impl FnMut(PublishedAsset) -> F,
    ) -> io::Result<RegionInput> {
        let map = self.open(reference)?;
        self.validate_navigation(reference, &navigation)?;
        let space = space(&map, &query.space_id)?;
        let parent = match &query.parent_id {
            None => &map.footprint,
            Some(id) => {
                &navigation
                    .regions
                    .iter()
                    .find(|r| r.id == *id && r.space_id == query.space_id)
                    .ok_or_else(|| io::Error::other("Choose a region on this map"))?
                    .geometry
            }
        };
        let kernel = self.geometry().spatial(space.precision)?;
        let padding = drawing.map_or(0.0, |d| d.tolerance);
        if !padding.is_finite() || padding < 0.0 {
            return Err(io::Error::other("Choose a finite snapping distance"));
        }
        let mut windows = Vec::new();
        for shape in query.cuts.iter().chain(drawing.map(|d| &d.geometry)) {
            let Bounds(w, s, e, n) = kernel.bounds(shape).map_err(io::Error::other)?;
            windows.extend(chart_windows(
                space,
                Bounds(w - padding, s - padding, e + padding, n + padding),
            )?);
        }
        if windows.is_empty() {
            if let Some(position) = query.position {
                let [x, y, _] = canonical_position(space, position)?.coordinates();
                windows.push(Bounds(x, y, x, y));
            }
        }
        let mut sources = BTreeMap::new();
        for bounds in windows {
            let mut request = FeatureQuery {
                space_id: space.id.clone(),
                bounds: Some(bounds),
                ..Default::default()
            };
            for feature in collect(|cursor| {
                request.cursor = cursor;
                self.features(reference, &request)
            })? {
                sources.insert(feature.id.clone(), feature);
            }
        }
        let mut request = FeatureQuery {
            space_id: space.id.clone(),
            geometry: Some(region_geometry(parent)),
            layer_ids: Some(vec!["vector:settlements".into()]),
            ..Default::default()
        };
        let anchors = collect(|cursor| {
            request.cursor = cursor;
            self.features(reference, &request)
        })?
        .into_iter()
        .filter_map(|f| match f.geometry {
            Geometry::Point { coordinates } => Some(coordinates),
            _ => None,
        })
        .collect();
        let mut geometries = Vec::new();
        for asset in self.illustration_assets(reference)? {
            let collection: Illustration =
                serde_json::from_slice(&read(asset).await?).map_err(io::Error::other)?;
            geometries.extend(
                collection
                    .features
                    .into_iter()
                    .filter(|f| f.properties.feature_id.is_none())
                    .filter_map(|f| f.geometry),
            );
        }
        let ocean = (!geometries.is_empty() || map.layers.iter().any(|l| l.id == "terrain"))
            .then_some(Geometry::GeometryCollection { geometries });
        let sources = sources
            .into_values()
            .filter_map(|f| {
                as_region(f.geometry).ok().map(|geometry| RegionCandidate {
                    name: f.name.unwrap_or(f.kind),
                    geometry,
                })
            })
            .collect();
        Ok(RegionInput {
            map,
            navigation,
            sources,
            anchors,
            ocean,
        })
    }
}
#[derive(Deserialize)]
struct Illustration {
    features: Vec<IllustratedFeature>,
}
#[derive(Deserialize)]
struct IllustratedFeature {
    geometry: Option<Geometry>,
    properties: IllustratedProperties,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IllustratedProperties {
    feature_id: Option<String>,
}
fn chart_windows(space: &MapSpace, bounds: Bounds) -> io::Result<Vec<Bounds>> {
    let Some(width) = space.periodic_width else {
        return Ok(vec![bounds]);
    };
    let Bounds(west, _, east, _) = space.bounds;
    let Bounds(w, s, e, n) = bounds;
    if e - w >= width {
        return Ok(vec![Bounds(west, s, east, n)]);
    }
    let [start, _, _] = canonical_position(space, Position::xy(w, s))?.coordinates();
    let end = start + e - w;
    Ok(if end <= east {
        vec![Bounds(start, s, end, n)]
    } else {
        vec![
            Bounds(start, s, east, n),
            Bounds(west, s, west + end - east, n),
        ]
    })
}
