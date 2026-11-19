//! Vector features are composed once, with presentation metadata stored beside their GIS geometry.
use super::{catalogue, registry::Registry};
use crate::{
    features::{
        composition::{present, Composition},
        Feature, FeatureSelection,
    },
    spatial::SpatialResult,
};
use atlas_map::{
    Geometry, GeometryType, LayerCatalog, MapFeature, MapProperty, MapRelation, PropertyType,
    RegionGeometry,
};
// hpc-exempt: feature-type discovery and property metadata, not numerical field storage.
use std::collections::BTreeMap;

pub struct Vectors<'a> {
    pub registry: Registry<'a>,
    pub area: atlas_map::Id,
    /// Canonical placed sources override any record of the same identity.
    pub placed: &'a [Feature],
}
impl Vectors<'_> {
    pub fn presented<'a>(
        &'a self,
        layer: &'a str,
    ) -> SpatialResult<impl Iterator<Item = SpatialResult<Feature>> + 'a> {
        let context = self.registry.context;
        let composition = Composition {
            context,
            features: self.registry.reader,
            spatial: self.registry.spatial,
            area: self.area,
            profile: context.area(self.area)?.profile,
        };
        let sources = self
            .registry
            .reader
            .values(FeatureSelection {
                layer_id: Some(layer),
                ..Default::default()
            })
            .map_err(|e| e.to_string())?;
        let records = sources
            .filter(|source| {
                !source
                    .as_ref()
                    .is_ok_and(|source| self.placed.iter().any(|p| p.id == source.id))
            })
            .map(|source| source.map_err(|e| e.to_string()))
            .chain(
                self.placed
                    .iter()
                    .filter(move |p| p.layer_id == layer)
                    .cloned()
                    .map(Ok),
            );
        Ok(records.filter_map(move |source| {
            source
                .and_then(|source| present(&composition, &source))
                .transpose()
        }))
    }
    pub fn visit(
        &self,
        layer: &str,
        mut emit: impl FnMut(Feature) -> SpatialResult<()>,
    ) -> SpatialResult<()> {
        for feature in self.presented(layer)? {
            emit(feature?)?;
        }
        Ok(())
    }
    pub fn record(&self, feature: Feature) -> SpatialResult<MapFeature> {
        let kind =
            self.registry
                .catalogue
                .describe(&feature.layer_id, &feature.kind, &feature.attributes);
        let catalog = self.registry.record(&feature, &kind)?;
        let relations = feature
            .relations
            .iter()
            .map(|r| {
                Ok(MapRelation {
                    target_id: r.target_id,
                    target_map_id: None,
                    target_name: self.registry.target_name(r.target_id)?,
                    kind: r.kind.clone(),
                })
            })
            .collect::<SpatialResult<_>>()?;
        let shape = match feature.footprint {
            Some(shape) => Some(shape),
            None => self.widened(&feature.geometry, &feature.attributes)?,
        };
        let footprint = shape.and_then(|shape| match shape {
            Geometry::Polygon { coordinates } => Some(RegionGeometry::Polygon(coordinates)),
            Geometry::MultiPolygon { coordinates } => {
                Some(RegionGeometry::MultiPolygon(coordinates))
            }
            _ => None,
        });
        Ok(MapFeature {
            entity_id: Some(feature.place_id.unwrap_or(feature.id)),
            id: feature.id,
            space_id: self.registry.context.space(self.area)?,
            layer_id: format!("vector:{}", feature.layer_id),
            name: Some(feature.name),
            kind: feature.kind,
            type_id: kind.id,
            catalog,
            geometry: feature.geometry,
            footprint,
            attributes: feature.attributes.into_iter().collect(),
            relations,
            causes: feature.causes,
        })
    }
    /// On a real-scale map, a line that states a full width at each vertex (`widths`) covers
    /// the ground of that width; its footprint is that ground (ADR 0016). World and regional
    /// courses keep their widths as attributes only. A point place about a hex across or more
    /// covers its true size (`trueSize`).
    fn widened(
        &self,
        geometry: &Geometry,
        attributes: &crate::features::records::Attributes,
    ) -> SpatialResult<Option<Geometry>> {
        let Some(real) = self
            .registry
            .context
            .area(self.area)?
            .map
            .as_ref()
            .and_then(|map| map.real_scale)
        else {
            return Ok(None);
        };
        // A clipped or redrawn course whose widths no longer match its vertices keeps its line.
        if let Some(shape) = atlas_map::hexes::widened_footprint(
            geometry,
            attributes.get("widths"),
            self.registry.spatial,
        )? {
            return Ok(Some(shape));
        }
        Ok(super::key::sized_footprint(
            geometry,
            attributes.get("trueSize"),
            real.hex_size.across_flats(),
        ))
    }
    pub fn catalogue(&self, layer_id: &str) -> SpatialResult<LayerCatalog> {
        let catalogue = &self.registry.catalogue;
        let layer = catalogue.layers.get(layer_id).ok_or("Missing map layer")?;
        let mut types = catalogue.available(layer_id);
        // hpc-exempt: feature-type discovery and property metadata, not numerical field storage.
        let mut properties = BTreeMap::from([
            (
                "name".into(),
                MapProperty {
                    kind: PropertyType::String,
                },
            ),
            (
                "kind".into(),
                MapProperty {
                    kind: PropertyType::String,
                },
            ),
        ]);
        for (key, spec) in &layer.schema {
            let kind = match spec["type"].as_str() {
                Some("string") => PropertyType::String,
                Some("number") => PropertyType::Number,
                Some("boolean") => PropertyType::Boolean,
                _ => continue,
            };
            properties.insert(key.clone(), MapProperty { kind });
        }
        let mut examples = Vec::new();
        let mut geometries = Vec::new();
        self.visit(layer_id, |feature| {
            let kind = catalogue.describe(layer_id, &feature.kind, &feature.attributes);
            let entry = types.entry(kind.id.clone()).or_insert(kind);
            entry.count = entry
                .count
                .checked_add(1)
                .ok_or("Feature count exceeds representation")?;
            entry.footprints |= feature.footprint.is_some();
            let geometry = geometry_type(&feature.geometry);
            if !entry.geometries.contains(&geometry) {
                entry.geometries.push(geometry);
            }
            if !geometries.contains(&geometry) {
                geometries.push(geometry);
                examples.push(feature.id);
            }
            for (key, value) in feature.attributes {
                let kind = if value.is_string() {
                    PropertyType::String
                } else if value.is_number() {
                    PropertyType::Number
                } else if value.is_boolean() {
                    PropertyType::Boolean
                } else {
                    continue;
                };
                properties.insert(key, MapProperty { kind });
            }
            Ok(())
        })?;
        let mut feature_types = types.into_values().collect::<Vec<_>>();
        // hpc-exempt: sparse layer discovery labels, not numerical field ordering.
        feature_types.sort_by_key(|kind| kind.path.join(" / "));
        if geometries.is_empty() && layer.representation == "network" {
            geometries.push(GeometryType::LineString);
        }
        Ok(LayerCatalog {
            path: vec![layer.name.clone()],
            common: true,
            feature_types,
            default_style: Some(catalogue::style(layer)),
            presets: catalogue::presets(layer),
            properties,
            examples,
            geometries,
        })
    }
}
fn geometry_type(shape: &Geometry) -> GeometryType {
    match shape {
        Geometry::Point { .. } => GeometryType::Point,
        Geometry::MultiPoint { .. } => GeometryType::MultiPoint,
        Geometry::LineString { .. } => GeometryType::LineString,
        Geometry::MultiLineString { .. } => GeometryType::MultiLineString,
        Geometry::Polygon { .. } => GeometryType::Polygon,
        Geometry::MultiPolygon { .. } => GeometryType::MultiPolygon,
        Geometry::GeometryCollection { .. } => GeometryType::GeometryCollection,
    }
}
