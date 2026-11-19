//! Features as rows: typed columns, WKB geometry and relation rows.
use super::{description::get, id, records::Open, uuid, uuids, PostgresMaps, Wkb};
use crate::map_store::space;
use atlas_map::{
    regions::{as_geometry, as_region},
    Id, LayerSource, MapFeature, MapFeatureCatalog, MapRef, MapRelation,
};
use postgres::{
    binary_copy::BinaryCopyInWriter,
    types::{ToSql, Type},
    Row,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io};

/// The registry's derived values. Their column labels are the map's registry column rows.
#[derive(Serialize, Deserialize)]
struct Catalog {
    values: BTreeMap<String, serde_json::Value>,
}
pub(super) const FEATURE_COLUMNS: &str = "f.map_id,f.revision,f.id,f.space_id,f.layer_id,f.type_id,f.kind,f.name,f.entity_id,f.origin,f.map_only,ST_AsBinary(f.geometry) AS geometry_wkb,ST_AsBinary(f.footprint) AS footprint_wkb,f.attributes,f.catalog,f.causes";

impl PostgresMaps {
    /// Writes features that belong to a published vector type in their layer's space.
    pub(super) fn write_features(&self, open: &Open, features: Vec<MapFeature>) -> io::Result<()> {
        if features.is_empty() {
            return Ok(());
        }
        let map = &open.map;
        let (map_id, revision) = (uuid(map.reference.map_id), uuid(map.reference.revision));
        let geometry = self.geometry_type()?;
        let mut db = self.db.borrow_mut();
        let sink = db.copy_in("COPY map.features(map_id,revision,id,space_id,layer_id,type_id,kind,name,entity_id,origin,map_only,geometry,footprint,attributes,catalog,causes) FROM STDIN BINARY").map_err(super::database_error)?;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::UUID,
            Type::UUID,
            Type::TEXT,
            Type::TEXT,
            Type::TEXT,
            Type::TEXT,
            Type::UUID,
            Type::TEXT,
            Type::BOOL,
            geometry.clone(),
            geometry,
            Type::JSONB,
            Type::JSONB,
            Type::TEXT_ARRAY,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        let mut relations = Vec::new();
        for feature in features {
            feature.validate_people().map_err(io::Error::other)?;
            open.check(&feature)?;
            let precision = space(map, feature.space_id)?.precision;
            let shape = Wkb(self.geometry.encode(&feature.geometry, precision)?.bytes);
            let footprint = feature
                .footprint
                .as_ref()
                .map(|f| self.geometry.encode(&as_geometry(f), precision))
                .transpose()?
                .map(|e| Wkb(e.bytes));
            let attributes = serde_json::to_value(&feature.attributes)?;
            let catalog = serde_json::to_value(Catalog {
                values: feature.catalog.values,
            })?;
            let (id, space_id) = (uuid(feature.id), uuid(feature.space_id));
            let entity = feature.entity_id.map(uuid);
            let row: Vec<&(dyn ToSql + Sync)> = vec![
                &map_id,
                &revision,
                &id,
                &space_id,
                &feature.layer_id,
                &feature.type_id,
                &feature.kind,
                &feature.name,
                &entity,
                &feature.catalog.origin,
                &feature.catalog.map_only,
                &shape,
                &footprint,
                &attributes,
                &catalog,
                &feature.causes,
            ];
            writer.write(&row).map_err(super::database_error)?;
            relations.push((feature.id, feature.relations));
        }
        writer.finish().map_err(super::database_error)?;
        drop(db);
        self.write_relations(&map.reference, relations)
    }
    fn write_relations(
        &self,
        r: &MapRef,
        relations: Vec<(Id, Vec<MapRelation>)>,
    ) -> io::Result<()> {
        let (map_id, revision) = (uuid(r.map_id), uuid(r.revision));
        let mut db = self.db.borrow_mut();
        let sink = db.copy_in("COPY map.relations(map_id,revision,feature_id,ordinal,kind,target_id,target_map_id,target_name) FROM STDIN BINARY").map_err(super::database_error)?;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::UUID,
            Type::INT4,
            Type::TEXT,
            Type::UUID,
            Type::UUID,
            Type::TEXT,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        for (feature, list) in relations {
            let feature = uuid(feature);
            for (ordinal, relation) in list.iter().enumerate() {
                let ordinal = i32::try_from(ordinal).map_err(io::Error::other)?;
                let target = uuid(relation.target_id);
                let target_map = relation.target_map_id.map(uuid);
                let row: Vec<&(dyn ToSql + Sync)> = vec![
                    &map_id,
                    &revision,
                    &feature,
                    &ordinal,
                    &relation.kind,
                    &target,
                    &target_map,
                    &relation.target_name,
                ];
                writer.write(&row).map_err(super::database_error)?;
            }
        }
        writer.finish().map_err(super::database_error)?;
        Ok(())
    }
    pub(super) fn remove_features(&self, r: &MapRef, ids: &[Id]) -> io::Result<()> {
        self.execute(
            "DELETE FROM map.features WHERE map_id=$1 AND revision=$2 AND id=ANY($3)",
            &[&uuid(r.map_id), &uuid(r.revision), &uuids(ids)],
        )?;
        Ok(())
    }
    /// PostGIS's `geometry` type, whose identity differs between databases.
    pub(super) fn geometry_type(&self) -> io::Result<Type> {
        if let Some(found) = self.geometry_type.borrow().as_ref() {
            return Ok(found.clone());
        }
        let statement = self
            .db
            .borrow_mut()
            .prepare("SELECT $1::geometry")
            .map_err(super::database_error)?;
        let found = statement.params()[0].clone();
        self.geometry_type.replace(Some(found.clone()));
        Ok(found)
    }
    /// Features from rows selected with `FEATURE_COLUMNS`, with their relations.
    pub(super) fn features_from(&self, rows: &[Row]) -> io::Result<Vec<MapFeature>> {
        let mut features = rows
            .iter()
            .map(|row| self.feature(row))
            .collect::<io::Result<Vec<_>>>()?;
        let mut by_map: BTreeMap<(uuid::Uuid, uuid::Uuid), Vec<uuid::Uuid>> = BTreeMap::new();
        for row in rows {
            by_map
                .entry((get(row, "map_id")?, get(row, "revision")?))
                .or_default()
                .push(get(row, "id")?);
        }
        let mut relations: BTreeMap<Id, Vec<MapRelation>> = BTreeMap::new();
        for ((map_id, revision), ids) in by_map {
            for row in self.query(
                "SELECT feature_id,kind,target_id,target_map_id,target_name FROM map.relations
                 WHERE map_id=$1 AND revision=$2 AND feature_id=ANY($3) ORDER BY feature_id,ordinal",
                &[&map_id, &revision, &ids],
            )? {
                relations
                    .entry(id(get(&row, "feature_id")?))
                    .or_default()
                    .push(MapRelation {
                        target_id: id(get(&row, "target_id")?),
                        target_map_id: get::<Option<uuid::Uuid>>(&row, "target_map_id")?.map(id),
                        target_name: get(&row, "target_name")?,
                        kind: get(&row, "kind")?,
                    });
            }
        }
        for feature in &mut features {
            feature.relations = relations.remove(&feature.id).unwrap_or_default();
        }
        Ok(features)
    }
    fn feature(&self, row: &Row) -> io::Result<MapFeature> {
        let geometry: Vec<u8> = get(row, "geometry_wkb")?;
        let footprint: Option<Vec<u8>> = get(row, "footprint_wkb")?;
        let catalog: Catalog = serde_json::from_value(get(row, "catalog")?)?;
        Ok(MapFeature {
            id: id(get(row, "id")?),
            space_id: id(get(row, "space_id")?),
            entity_id: get::<Option<uuid::Uuid>>(row, "entity_id")?.map(id),
            layer_id: get(row, "layer_id")?,
            name: get(row, "name")?,
            kind: get(row, "kind")?,
            type_id: get(row, "type_id")?,
            catalog: MapFeatureCatalog {
                values: catalog.values,
                origin: get(row, "origin")?,
                map_only: get(row, "map_only")?,
            },
            geometry: self.geometry.decode(&geometry)?,
            footprint: footprint
                .map(|bytes| self.geometry.decode(&bytes))
                .transpose()?
                .map(as_region)
                .transpose()
                .map_err(io::Error::other)?,
            attributes: serde_json::from_value(get(row, "attributes")?)?,
            relations: Vec::new(),
            causes: get(row, "causes")?,
        })
    }
}
impl Open {
    /// A feature belongs to a published vector type of its layer, in that layer's space.
    pub(super) fn check(&self, feature: &MapFeature) -> io::Result<()> {
        let layer = self
            .layer(&feature.layer_id)
            .ok_or_else(|| io::Error::other("Feature must belong to a map layer"))?;
        if layer.space_id != feature.space_id
            || !matches!(layer.source, LayerSource::Vector(_))
            || !layer
                .catalog
                .feature_types
                .iter()
                .any(|t| t.id == feature.type_id)
        {
            return Err(io::Error::other(
                "Feature must belong to a published vector type in its map space",
            ));
        }
        Ok(())
    }
}
