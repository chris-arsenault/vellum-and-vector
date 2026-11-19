use super::{
    records::region_geometry, samples::canonical_position, space, FeatureQuery, MapAccess, Page,
};
use atlas_map::{
    spatial::Predicate, Geometry, Inspection, MapFeature, MapRef, Position, RegionGeometry,
    RegionSelection, SampleValue,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionRequest {
    pub space_id: String,
    pub position: Position,
    pub tolerance: Option<f64>,
    pub layer_ids: Option<Vec<String>>,
    pub feature_ids: Option<Vec<String>>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionRequest {
    pub space_id: String,
    pub geometry: Option<RegionGeometry>,
    pub feature_ids: Option<Vec<String>>,
}
impl dyn MapAccess + '_ {
    pub fn inspect(
        &self,
        reference: &MapRef,
        request: &InspectionRequest,
    ) -> io::Result<Inspection> {
        let map = self.open(reference)?;
        let space = space(&map, &request.space_id)?;
        let position = canonical_position(space, request.position)?;
        let samples = self.samples_at(reference, &space.id, position)?;
        let tolerance = request.tolerance.unwrap_or_else(|| {
            samples
                .iter()
                .map(|s| s.cell_span / 2.0)
                .reduce(f64::min)
                .unwrap_or(0.0)
        });
        if !tolerance.is_finite() || tolerance < 0.0 {
            return Err(io::Error::other(
                "Picking tolerance must be a finite nonnegative distance",
            ));
        }
        let point = Geometry::Point {
            coordinates: position,
        };
        let mut query = FeatureQuery {
            space_id: space.id.clone(),
            geometry: Some(picking(position, tolerance)),
            layer_ids: request.layer_ids.clone(),
            feature_ids: request.feature_ids.clone(),
            ..Default::default()
        };
        let candidates = collect(|cursor| {
            query.cursor = cursor;
            self.features(reference, &query)
        })?;
        let kernel = self.geometry().spatial(space.precision)?;
        let mut features = Vec::new();
        for feature in candidates {
            if rank(&feature) == 2
                && matches!(
                    feature.geometry,
                    Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
                )
            {
                let footprint = feature.footprint.as_ref().map(region_geometry);
                if !kernel
                    .relation(
                        footprint.as_ref().unwrap_or(&feature.geometry),
                        &point,
                        Predicate::Covers,
                    )
                    .map_err(io::Error::other)?
                {
                    continue;
                }
            }
            features.push(feature);
        }
        features.sort_by(|a, b| {
            rank(a).cmp(&rank(b)).then_with(|| {
                a.name
                    .as_deref()
                    .unwrap_or_default()
                    .cmp(b.name.as_deref().unwrap_or_default())
            })
        });
        let ids = features.iter().map(|f| f.id.clone()).collect::<Vec<_>>();
        let causes = collect(|cursor| {
            self.history(reference, cursor.as_deref().unwrap_or_default(), Some(&ids))
        })?;
        let values = samples
            .iter()
            .flat_map(|s| {
                s.attributes
                    .iter()
                    .filter(|v| {
                        request
                            .layer_ids
                            .as_ref()
                            .is_none_or(|ids| ids.iter().any(|id| *id == *v.layer_id))
                    })
                    .map(|v| SampleValue {
                        sample_id: s.id.clone(),
                        layer_id: v.layer_id.to_string(),
                        band_id: v.band_id.to_string(),
                        value: v.value.clone(),
                        unit: v.unit.to_string(),
                        label: v.label.to_string(),
                        display: v.display.clone(),
                        category: v.category.clone(),
                        footprint: s.footprint.clone(),
                        bounds: s.window.bounds,
                        cell_span: s.cell_span,
                        center: s.center,
                        measure: s.measure,
                        active: s.active,
                    })
            })
            .collect();
        Ok(Inspection {
            reference: reference.clone(),
            space_id: space.id.clone(),
            position,
            samples: values,
            features,
            sections: samples.into_iter().flat_map(|s| s.sections).collect(),
            causes,
        })
    }
    pub fn select_region(
        &self,
        reference: &MapRef,
        request: &SelectionRequest,
    ) -> io::Result<RegionSelection> {
        let map = self.open(reference)?;
        let space = space(&map, &request.space_id)?;
        let mut seen = BTreeSet::new();
        let ids = request
            .feature_ids
            .iter()
            .flatten()
            .filter(|id| seen.insert(id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        let mut query = FeatureQuery {
            space_id: space.id.clone(),
            feature_ids: Some(ids.clone()),
            ..Default::default()
        };
        let selected = collect(|cursor| {
            query.cursor = cursor;
            self.features(reference, &query)
        })?;
        if selected.len() != ids.len() {
            return Err(io::Error::other(
                "Selected features are absent from this map revision",
            ));
        }
        let kernel = self.geometry().spatial(space.precision)?;
        let shape = match &request.geometry {
            Some(shape) => region_geometry(shape),
            None => {
                let polygons = selected
                    .into_iter()
                    .map(|f| as_region(f.geometry).map(|g| region_geometry(&g)))
                    .collect::<io::Result<Vec<_>>>()?;
                kernel
                    .union_all(&polygons)
                    .map_err(io::Error::other)?
                    .ok_or_else(|| io::Error::other("Choose an outline or a polygon feature"))?
            }
        };
        let geometry = as_region(kernel.canonical(&shape).map_err(io::Error::other)?)?;
        Ok(RegionSelection {
            parent: reference.clone(),
            space_id: space.id.clone(),
            geometry,
            feature_ids: ids,
            region_path: Vec::new(),
        })
    }
}
pub(super) fn as_region(shape: Geometry) -> io::Result<RegionGeometry> {
    match shape {
        Geometry::Polygon { coordinates } => Ok(RegionGeometry::Polygon(coordinates)),
        Geometry::MultiPolygon { coordinates } => Ok(RegionGeometry::MultiPolygon(coordinates)),
        _ => Err(io::Error::other("A region needs polygon geography")),
    }
}
pub(super) fn collect<T>(
    mut read: impl FnMut(Option<String>) -> io::Result<Page<T>>,
) -> io::Result<Vec<T>> {
    let mut items = Vec::new();
    let mut cursor = None;
    loop {
        let page = read(cursor)?;
        items.extend(page.items);
        cursor = page.next;
        if cursor.is_none() {
            return Ok(items);
        }
    }
}
fn rank(feature: &MapFeature) -> u8 {
    match feature.geometry {
        Geometry::Point { .. } | Geometry::MultiPoint { .. } => 0,
        Geometry::LineString { .. } | Geometry::MultiLineString { .. } => 1,
        _ => 2,
    }
}
fn picking(position: Position, tolerance: f64) -> Geometry {
    if tolerance == 0.0 {
        return Geometry::Point {
            coordinates: position,
        };
    }
    let [x, y, _] = position.coordinates();
    let (w, s, e, n) = (x - tolerance, y - tolerance, x + tolerance, y + tolerance);
    Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(w, s),
            Position::xy(e, s),
            Position::xy(e, n),
            Position::xy(w, n),
            Position::xy(w, s),
        ]],
    }
}
