mod columns;
use super::{catalogue::Catalogue, descriptor::profile_name};
use crate::{
    features::{context::Context, records::Entity, Feature, FeatureReader},
    scale::{AreaUnit, LengthUnit, MapScale},
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, MapFeatureCatalog, MapFeatureType};
use serde_json::Value;
// hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
use std::collections::BTreeMap;

pub struct Registry<'a> {
    pub context: &'a Context,
    pub catalogue: Catalogue<'a>,
    // hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
    pub entities: &'a BTreeMap<String, Entity>,
    pub reader: &'a dyn FeatureReader,
    pub spatial: &'a dyn SpatialKernel,
}
impl Registry<'_> {
    pub fn record(
        &self,
        feature: &Feature,
        kind: &MapFeatureType,
    ) -> SpatialResult<MapFeatureCatalog> {
        // hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
        let mut values: BTreeMap<_, _> = feature
            .attributes
            .iter()
            .filter(|(_, v)| v.is_string() || v.is_number() || v.is_boolean())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let extent = feature.footprint.as_ref().unwrap_or(&feature.geometry);
        if matches!(
            extent,
            Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
        ) {
            values.insert(
                "areaKm2".into(),
                MapScale::area_units(
                    self.spatial.area(extent)?,
                    AreaUnit::SquareMetre,
                    AreaUnit::SquareKilometre,
                )
                .into(),
            );
        }
        if matches!(
            feature.geometry,
            Geometry::LineString { .. } | Geometry::MultiLineString { .. }
        ) {
            values.insert(
                "lengthKm".into(),
                MapScale::in_units(
                    self.spatial.length(&feature.geometry)?,
                    LengthUnit::Kilometre,
                )
                .into(),
            );
        }
        self.society(feature, &mut values)?;
        if let Some(unit) = feature
            .attributes
            .get("workKind")
            .and_then(Value::as_str)
            .and_then(columns::work_unit)
        {
            values.insert("magnitudeUnit".into(), unit.into());
        }
        let area = self.context.area(&feature.area_id)?;
        let space = self.context.space(&area.id)?;
        for (key, value) in [
            ("name", Value::from(feature.name.clone())),
            (
                "type",
                kind.path
                    .iter()
                    .skip(1)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" / ")
                    .into(),
            ),
            ("map", area.name.clone().into()),
            ("profile", profile_name(area.profile).into()),
            ("space", space.into()),
            (
                "spaceLabel",
                self.context
                    .areas
                    .get(space)
                    .map_or("World surface", |a| a.name.as_str())
                    .into(),
            ),
            ("floor", area.frame.floor.clone().into()),
            (
                "state",
                serde_json::to_value(feature.state).map_err(|e| e.to_string())?,
            ),
            ("protected", feature.protected.into()),
            (
                "status",
                feature
                    .attributes
                    .get("status")
                    .filter(|v| !v.is_null())
                    .cloned()
                    .unwrap_or_else(|| "".into()),
            ),
            (
                "layer",
                self.catalogue
                    .layers
                    .get(&feature.layer_id)
                    .map_or(&feature.layer_id, |l| &l.name)
                    .clone()
                    .into(),
            ),
        ] {
            values.insert(key.into(), value);
        }
        Ok(MapFeatureCatalog {
            columns: columns::columns(&values, self.catalogue.layers),
            values,
            origin: if feature.actor == "generator" {
                "Generated geography"
            } else {
                "Authored geography"
            }
            .into(),
            map_only: feature.map_only.unwrap_or(false),
        })
    }
    pub fn target_name(&self, id: &str) -> SpatialResult<String> {
        if let Some(entity) = self.entities.get(id) {
            return Ok(entity.name.clone());
        }
        Ok(self
            .reader
            .get(id)
            .map_err(|e| e.to_string())?
            .map_or_else(|| id.into(), |f| f.name))
    }
    fn entity_name(&self, id: &str) -> String {
        self.entities.get(id).map_or(id, |e| &e.name).into()
    }
    fn society(
        &self,
        feature: &Feature,
        // hpc-exempt: named registry columns, entity identities and scalar descriptions, not numerical field storage.
        values: &mut BTreeMap<String, Value>,
    ) -> SpatialResult<()> {
        let attributes = &feature.attributes;
        if feature.kind == "settlement" {
            values.insert(
                "population".into(),
                attributes
                    .get("settlementPopulation")
                    .filter(|v| !v.is_null())
                    .or_else(|| attributes.get("population"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
        }
        let polity = attributes
            .get("polityId")
            .filter(|v| !v.is_null())
            .cloned()
            .or_else(|| {
                feature
                    .relations
                    .iter()
                    .find(|r| {
                        matches!(
                            r.kind.as_str(),
                            "sovereign" | "claimedBy" | "controlledBy" | "administeredBy"
                        )
                    })
                    .map(|r| r.target_id.clone().into())
            });
        if let Some(id) = polity.as_ref().and_then(Value::as_str) {
            values.insert("polity".into(), self.entity_name(id).into());
        }
        for (key, attr) in [
            ("from", "fromPlace"),
            ("to", "toPlace"),
            ("affectedPlaces", "atPlace"),
        ] {
            if let Some(id) = attributes.get(attr).and_then(Value::as_str) {
                let name = self
                    .reader
                    .get(id)
                    .map_err(|e| e.to_string())?
                    .map_or_else(|| id.to_owned(), |f| f.name);
                values.insert(key.into(), name.into());
            }
        }
        if let Some(groups) = attributes.get("groups").and_then(Value::as_array) {
            for key in ["culture", "languages", "religions"] {
                let mut ids = Vec::new();
                for group in groups {
                    let value = &group[key];
                    let entries = value
                        .as_array()
                        .map_or_else(|| vec![value], |list| list.iter().collect());
                    for id in entries.into_iter().filter_map(Value::as_str) {
                        if !ids.contains(&id) {
                            ids.push(id);
                        }
                    }
                }
                values.insert(
                    key.into(),
                    ids.iter()
                        .map(|id| self.entity_name(id))
                        .collect::<Vec<_>>()
                        .join(", ")
                        .into(),
                );
            }
        }
        Ok(())
    }
}
