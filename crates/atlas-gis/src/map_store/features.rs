//! Features from their rows: typed columns, WKB geometry and relation rows.
use super::{description::unpack, MapStore};
use crate::sql::{column, Row, Value};
use atlas_map::{regions::as_region, Id, MapFeature, MapFeatureCatalog, MapRelation};
use serde::Deserialize;
use std::{collections::BTreeMap, io};

#[derive(Deserialize)]
struct Catalog {
    values: BTreeMap<String, serde_json::Value>,
}
impl MapStore {
    /// Features from `map_features` rows, with their relations.
    pub(super) fn features_from(&self, rows: &[Row]) -> io::Result<Vec<MapFeature>> {
        let mut features = Vec::with_capacity(rows.len());
        for row in rows {
            let mut feature = self.feature(row)?;
            feature.relations = self.relations(
                column(row, "map_id")?.clone(),
                column(row, "revision")?.clone(),
                feature.id,
            )?;
            features.push(feature);
        }
        Ok(features)
    }
    fn relations(
        &self,
        map_id: Value,
        revision: Value,
        feature: Id,
    ) -> io::Result<Vec<MapRelation>> {
        self.db
            .query(
                "SELECT kind,target_id,target_map_id,target_name FROM map_relations WHERE map_id=? AND revision=? AND feature_id=? ORDER BY ordinal",
                &[map_id, revision, feature.into()],
            )?
            .iter()
            .map(|row| {
                Ok(MapRelation {
                    target_id: column(row, "target_id")?.id()?,
                    target_map_id: column(row, "target_map_id")?.optional_id()?,
                    target_name: column(row, "target_name")?.text()?.into(),
                    kind: column(row, "kind")?.text()?.into(),
                })
            })
            .collect()
    }
    fn feature(&self, row: &Row) -> io::Result<MapFeature> {
        let catalog: Catalog = serde_json::from_str(column(row, "catalog")?.text()?)?;
        let footprint = match column(row, "footprint")? {
            Value::Null => None,
            value => {
                Some(as_region(self.geometry.decode(value.bytes()?)?).map_err(io::Error::other)?)
            }
        };
        Ok(MapFeature {
            id: column(row, "id")?.id()?,
            space_id: column(row, "space_id")?.id()?,
            entity_id: column(row, "entity_id")?.optional_id()?,
            layer_id: column(row, "layer_id")?.text()?.into(),
            name: column(row, "name")?.optional_text()?,
            kind: column(row, "kind")?.text()?.into(),
            type_id: column(row, "type_id")?.text()?.into(),
            catalog: MapFeatureCatalog {
                values: catalog.values,
                origin: column(row, "origin")?.text()?.into(),
                map_only: column(row, "map_only")?.flag()?,
            },
            geometry: self.geometry.decode(column(row, "geometry")?.bytes()?)?,
            footprint,
            attributes: serde_json::from_str(column(row, "attributes")?.text()?)?,
            relations: Vec::new(),
            causes: unpack(column(row, "causes")?)?,
        })
    }
}
