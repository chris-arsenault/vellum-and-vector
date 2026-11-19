use super::{codec, description::key, description::pack, space, MapStore};
use crate::{rows::SampleRow, sql::Value};
use atlas_map::{
    regions::as_geometry, Bounds, LayerSource, MapDescriptor, MapFeature, MapSample,
    PublicationBatch,
};
use serde::Serialize;
use std::{collections::BTreeSet, io};

/// The registry's derived values and their columns, which differ by layer.
#[derive(Serialize)]
pub(super) struct Catalog<'a> {
    pub values: &'a std::collections::BTreeMap<String, serde_json::Value>,
    pub columns: &'a [atlas_map::MapColumn],
}
impl MapStore {
    pub(super) fn append_records(
        &self,
        map: &MapDescriptor,
        batch: PublicationBatch,
    ) -> io::Result<()> {
        for feature in batch.features {
            self.write_feature(map, feature)?;
        }
        for sample in batch.samples {
            self.write_sample(map, sample)?;
        }
        for entity in batch.entities {
            let mut values = key(&map.reference);
            values.extend([entity.id.into(), Value::Blob(codec::encode(&entity)?)]);
            self.db
                .execute("INSERT INTO map_entities VALUES(?,?,?,?)", &values)?;
        }
        for entry in batch.history {
            let mut values = key(&map.reference);
            values.push(entry.id.into());
            let mut record = values.clone();
            record.push(Value::Blob(codec::encode(&entry)?));
            self.db
                .execute("INSERT INTO map_history VALUES(?,?,?,?)", &record)?;
            for id in entry.feature_ids.into_iter().collect::<BTreeSet<_>>() {
                let mut binding = values.clone();
                binding.push(id.into());
                self.db
                    .execute("INSERT INTO map_history_features VALUES(?,?,?,?)", &binding)?;
            }
        }
        for asset in batch.assets {
            self.write_asset(&map.reference, asset)?;
        }
        Ok(())
    }
    pub(super) fn write_feature(&self, map: &MapDescriptor, feature: MapFeature) -> io::Result<()> {
        feature.validate_people().map_err(io::Error::other)?;
        let layer = map
            .layers
            .iter()
            .find(|layer| layer.id == feature.layer_id)
            .ok_or_else(|| io::Error::other("Feature must belong to a map layer"))?;
        if !matches!(layer.source, LayerSource::Vector(_))
            || layer.space_id != feature.space_id
            || !layer
                .catalog
                .feature_types
                .iter()
                .any(|kind| kind.id == feature.type_id)
        {
            return Err(io::Error::other(
                "Feature must belong to a published vector type in its map space",
            ));
        }
        let precision = space(map, feature.space_id)?.precision;
        let encoded = self.geometry.encode(&feature.geometry, precision)?;
        let footprint = feature
            .footprint
            .as_ref()
            .map(|shape| self.geometry.encode(&as_geometry(shape), precision))
            .transpose()?;
        let mut values = key(&map.reference);
        values.extend([
            feature.id.into(),
            feature.space_id.into(),
            feature.layer_id.clone().into(),
            feature.type_id.clone().into(),
            feature.kind.clone().into(),
            feature.name.clone().into(),
            feature.entity_id.into(),
            feature.catalog.origin.clone().into(),
            feature.catalog.map_only.into(),
            encoded.bytes.into(),
            footprint.as_ref().map(|f| f.bytes.clone()).into(),
            serde_json::to_string(&feature.attributes)?.into(),
            serde_json::to_string(&Catalog {
                values: &feature.catalog.values,
                columns: &feature.catalog.columns,
            })?
            .into(),
            pack(&feature.causes)?,
        ]);
        self.db.execute(
            "INSERT INTO map_features(map_id,revision,id,space_id,layer_id,type_id,kind,name,entity_id,origin,map_only,geometry,footprint,attributes,catalog,causes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            &values,
        )?;
        let row = self.last_row()?;
        self.write_bounds("feature", row, encoded.bounds)?;
        if let Some(footprint) = footprint {
            self.write_bounds("footprint", row, footprint.bounds)?;
        }
        for (ordinal, relation) in feature.relations.iter().enumerate() {
            let mut values = key(&map.reference);
            values.extend([
                feature.id.into(),
                (ordinal as i64).into(),
                relation.kind.clone().into(),
                relation.target_id.into(),
                relation.target_map_id.into(),
                relation.target_name.clone().into(),
            ]);
            self.db
                .execute("INSERT INTO map_relations VALUES(?,?,?,?,?,?,?,?)", &values)?;
        }
        Ok(())
    }
    fn write_sample(&self, map: &MapDescriptor, sample: MapSample) -> io::Result<()> {
        let (row, footprint) = SampleRow::of(sample)?;
        let precision = space(map, row.space_id)?.precision;
        let encoded = self.geometry.encode(&as_geometry(&footprint), precision)?;
        let Bounds(w, s, e, n) = row.window;
        let mut values = key(&map.reference);
        values.extend([
            row.id.into(),
            row.space_id.into(),
            Value::Blob(encoded.bytes),
            w.into(),
            s.into(),
            e.into(),
            n.into(),
            row.closed_east.into(),
            row.closed_north.into(),
            row.cell_span.into(),
            row.center[0].into(),
            row.center[1].into(),
            row.center_z.into(),
            row.measure.into(),
            row.active.into(),
            row.sections.map(|s| s.to_string()).into(),
        ]);
        self.db.execute(
            "INSERT INTO map_samples(map_id,revision,id,space_id,geometry,window_west,window_south,
             window_east,window_north,closed_east,closed_north,cell_span,center_x,center_y,center_z,
             measure,active,sections) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            &values,
        )?;
        self.write_bounds("sample", self.last_row()?, encoded.bounds)
    }
    fn last_row(&self) -> io::Result<i64> {
        self.db
            .value("SELECT last_insert_rowid()", &[])?
            .ok_or_else(|| io::Error::other("Missing inserted map record"))?
            .integer()
    }
    fn write_bounds(&self, kind: &str, id: i64, Bounds(w, s, e, n): Bounds) -> io::Result<()> {
        self.db.execute(
            &format!("INSERT INTO map_{kind}_bounds VALUES(?,?,?,?,?)"),
            &[id.into(), w.into(), e.into(), s.into(), n.into()],
        )?;
        Ok(())
    }
}
