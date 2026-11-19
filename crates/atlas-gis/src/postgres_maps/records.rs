use super::{to_json, uuid, PostgresMaps, Wkb};
use crate::{map_store::space, rows::SampleRow};
use atlas_map::{
    regions::as_geometry, Bounds, MapDescriptor, MapLayer, MapRef, PublicationBatch, PublishedAsset,
};
use postgres::{
    binary_copy::BinaryCopyInWriter,
    types::{ToSql, Type},
};
use std::{
    collections::{BTreeSet, HashMap},
    io,
};
/// A map being written, with its layers by id, which each record batch is checked against.
/// Publication appends thousands of batches to one map, so the index is built once.
pub(super) struct Open {
    pub map: MapDescriptor,
    layers: HashMap<String, usize>,
}
impl Open {
    pub fn new(map: MapDescriptor) -> Self {
        Self {
            layers: map
                .layers
                .iter()
                .enumerate()
                .map(|(i, layer)| (layer.id.clone(), i))
                .collect(),
            map,
        }
    }
    pub fn layer(&self, id: &str) -> Option<&MapLayer> {
        self.layers.get(id).map(|&i| &self.map.layers[i])
    }
}
impl PostgresMaps {
    pub(super) fn append_records(&self, open: &Open, batch: PublicationBatch) -> io::Result<()> {
        let r = &open.map.reference;
        for column in &batch.columns {
            self.execute(
                "INSERT INTO map.registry_columns VALUES($1,$2,$3,$4,$5,
                 (SELECT count(*)::integer FROM map.registry_columns WHERE map_id=$1 AND revision=$2))
                 ON CONFLICT(map_id,revision,key) DO UPDATE
                 SET numeric=map.registry_columns.numeric OR excluded.numeric",
                &[
                    &uuid(r.map_id),
                    &uuid(r.revision),
                    &column.key,
                    &column.label,
                    &column.numeric,
                ],
            )?;
        }
        self.write_features(open, batch.features)?;
        self.write_samples(open, batch.samples)?;
        for entity in batch.entities {
            self.execute(
                "INSERT INTO map.entities VALUES($1,$2,$3,$4)",
                &[
                    &uuid(r.map_id),
                    &uuid(r.revision),
                    &uuid(entity.id),
                    &to_json(&entity)?,
                ],
            )?;
        }
        for entry in batch.history {
            self.execute(
                "INSERT INTO map.history VALUES($1,$2,$3,$4,
                 (SELECT count(*) FROM map.history WHERE map_id=$1 AND revision=$2))",
                &[
                    &uuid(r.map_id),
                    &uuid(r.revision),
                    &uuid(entry.id),
                    &to_json(&entry)?,
                ],
            )?;
            for feature in entry.feature_ids.iter().collect::<BTreeSet<_>>() {
                self.execute(
                    "INSERT INTO map.history_features VALUES($1,$2,$3,$4)",
                    &[
                        &uuid(r.map_id),
                        &uuid(r.revision),
                        &uuid(entry.id),
                        &uuid(*feature),
                    ],
                )?;
            }
        }
        for asset in batch.assets {
            self.write_asset(r, asset)?;
        }
        Ok(())
    }
    fn write_samples(&self, open: &Open, samples: Vec<atlas_map::MapSample>) -> io::Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        let map = &open.map;
        let (map_id, revision) = (uuid(map.reference.map_id), uuid(map.reference.revision));
        let geometry = self.geometry_type()?;
        let mut encoded = Vec::with_capacity(samples.len());
        for sample in samples {
            let (row, footprint) = SampleRow::of(sample)?;
            let precision = space(map, row.space_id)?.precision;
            let shape = self.geometry.encode(&as_geometry(&footprint), precision)?;
            encoded.push((row, Wkb(shape.bytes)));
        }
        let mut db = self.db.borrow_mut();
        let sink = db
            .copy_in(
                "COPY map.samples(map_id,revision,id,space_id,geometry,window_west,window_south,
                 window_east,window_north,closed_east,closed_north,cell_span,center_x,center_y,
                 center_z,measure,active,sections) FROM STDIN BINARY",
            )
            .map_err(super::database_error)?;
        let real = Type::FLOAT8;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::TEXT,
            Type::UUID,
            geometry,
            real.clone(),
            real.clone(),
            real.clone(),
            real.clone(),
            Type::BOOL,
            Type::BOOL,
            real.clone(),
            real.clone(),
            real.clone(),
            real.clone(),
            real,
            Type::BOOL,
            Type::JSONB,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        for (row, shape) in &encoded {
            let space = uuid(row.space_id);
            let Bounds(w, s, e, n) = row.window;
            let values: Vec<&(dyn ToSql + Sync)> = vec![
                &map_id,
                &revision,
                &row.id,
                &space,
                shape,
                &w,
                &s,
                &e,
                &n,
                &row.closed_east,
                &row.closed_north,
                &row.cell_span,
                &row.center[0],
                &row.center[1],
                &row.center_z,
                &row.measure,
                &row.active,
                &row.sections,
            ];
            writer.write(&values).map_err(super::database_error)?;
        }
        writer.finish().map_err(super::database_error)?;
        Ok(())
    }
    pub(super) fn write_asset(&self, r: &MapRef, asset: PublishedAsset) -> io::Result<()> {
        if asset.id.is_empty()
            || asset.location.is_empty()
            || asset.media_type.is_empty()
            || asset.byte_length > 9_007_199_254_740_991
        {
            return Err(io::Error::other("Published assets need identity, location, media type and representable byte length"));
        }
        self.execute(
            "INSERT INTO map.assets VALUES($1,$2,$3,$4,$5,$6,$7)",
            &[
                &uuid(r.map_id),
                &uuid(r.revision),
                &asset.id,
                &asset.media_type,
                &asset.location,
                &(asset.byte_length as i64),
                &asset.illustration,
            ],
        )?;
        Ok(())
    }
}
