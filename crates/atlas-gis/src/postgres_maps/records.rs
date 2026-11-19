use super::{to_json, uuid, PostgresMaps, Wkb};
use crate::map_store::{codec, space};
use atlas_map::{
    regions::as_geometry, MapDescriptor, MapLayer, MapRef, PublicationBatch, PublishedAsset,
};
use postgres::{
    binary_copy::BinaryCopyInWriter,
    types::{ToSql, Type},
};
use std::{
    collections::{BTreeSet, HashMap},
    io,
};
/// A map being written, with what each record batch is checked and encoded against: its
/// layers by id and its sample encoding. Publication appends thousands of batches to one
/// map, so these are built once rather than per batch.
pub(super) struct Open {
    pub map: MapDescriptor,
    layers: HashMap<String, usize>,
    samples: codec::Samples,
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
            samples: codec::Samples::new(&map),
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
                "INSERT INTO map.history VALUES($1,$2,$3,$4)",
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
            sample.window.bounds.validate().map_err(io::Error::other)?;
            if sample.id.is_empty()
                || !sample.cell_span.is_finite()
                || sample.cell_span <= 0.0
                || !sample.center.coordinates().iter().all(|v| v.is_finite())
                || !sample.measure.is_finite()
                || sample.measure < 0.0
            {
                return Err(io::Error::other(
                    "Map samples require identity, finite center and positive resolution",
                ));
            }
            let precision = space(map, sample.space_id)?.precision;
            let shape = self
                .geometry
                .encode(&as_geometry(&sample.footprint), precision)?;
            encoded.push((
                open.samples.encode(&sample)?,
                Wkb(shape.bytes),
                uuid(sample.space_id),
                sample.id,
            ));
        }
        let mut db = self.db.borrow_mut();
        let sink = db
            .copy_in(
                "COPY map.samples(map_id,revision,id,space_id,geometry,data) FROM STDIN BINARY",
            )
            .map_err(super::database_error)?;
        let types = [
            Type::UUID,
            Type::UUID,
            Type::TEXT,
            Type::UUID,
            geometry,
            Type::BYTEA,
        ];
        let mut writer = BinaryCopyInWriter::new(sink, &types);
        for (data, shape, space, id) in &encoded {
            let row: Vec<&(dyn ToSql + Sync)> = vec![&map_id, &revision, id, space, shape, data];
            writer.write(&row).map_err(super::database_error)?;
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
