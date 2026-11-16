use super::{codec, json, reference_values, space, EncodedGeometry, MapStore};
use crate::sql::Value;
use atlas_map::{
    Bounds, Geometry, LayerSource, MapDescriptor, MapFeature, MapSample, PublicationBatch,
};
use std::{collections::BTreeSet, io};

impl MapStore {
    pub(super) fn append_records(
        &self,
        map: &MapDescriptor,
        batch: PublicationBatch,
    ) -> io::Result<()> {
        for feature in batch.features {
            self.write_feature(map, feature)?;
        }
        let encoding = codec::Samples::new(map);
        for sample in batch.samples {
            self.write_sample(map, sample, &encoding)?;
        }
        for entity in batch.entities {
            let mut values = reference_values(&map.reference);
            values.extend([
                entity.id.clone().into(),
                Value::Blob(codec::encode(&entity)?),
            ]);
            self.db
                .execute("INSERT INTO map_entities VALUES(?,?,?,?)", &values)?;
        }
        for entry in batch.history {
            let mut values = reference_values(&map.reference);
            values.push(entry.id.clone().into());
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
    fn encode_geometry(
        &self,
        map: &MapDescriptor,
        space_id: &str,
        shape: &Geometry,
    ) -> io::Result<EncodedGeometry> {
        self.geometry.encode(shape, space(map, space_id)?.precision)
    }
    pub(super) fn write_feature(&self, map: &MapDescriptor, feature: MapFeature) -> io::Result<()> {
        feature.validate_people().map_err(io::Error::other)?;
        let layer = map
            .layers
            .iter()
            .find(|layer| layer.id == feature.layer_id)
            .ok_or_else(|| io::Error::other("Feature must belong to a map layer"))?;
        if !matches!(layer.source, LayerSource::Vector(_)) || layer.space_id != feature.space_id {
            return Err(io::Error::other(
                "Feature must belong to a vector layer in its map space",
            ));
        }
        let kind = layer
            .catalog
            .feature_types
            .iter()
            .find(|kind| kind.id == feature.type_id)
            .ok_or_else(|| io::Error::other("Feature has no catalogue type"))?;
        let encoded = self.encode_geometry(map, &feature.space_id, &feature.geometry)?;
        let mut record = serde_json::to_value(&feature).map_err(io::Error::other)?;
        record.as_object_mut().unwrap().remove("geometry");
        let mut values = reference_values(&map.reference);
        values.extend([
            feature.id.clone().into(),
            feature.space_id.clone().into(),
            feature.layer_id.clone().into(),
            feature.name.clone().map_or(Value::Null, Value::Text),
            Value::Blob(encoded.bytes),
            Value::Blob(codec::encode(&record)?),
        ]);
        self.db.execute("INSERT INTO map_features(map_id,revision,id,space_id,layer_id,name,geometry,data) VALUES(?,?,?,?,?,?,?,?)", &values)?;
        let id = self.last_row()?;
        self.write_bounds("feature", id, encoded.bounds)?;
        let footprint_bounds = match &feature.footprint {
            Some(shape) => {
                self.encode_geometry(map, &feature.space_id, &region_geometry(shape))?
                    .bounds
            }
            None => encoded.bounds,
        };
        self.db.execute(
            "INSERT INTO map_feature_catalog VALUES(?,?,?,?,?,?,?,?)",
            &[
                id.into(),
                json(kind)?,
                json(&feature.catalog.values)?,
                json(&feature.catalog.columns)?,
                json(&feature.attributes)?,
                json(&feature.relations)?,
                format!(
                    "{} {}",
                    feature.name.as_deref().unwrap_or_default(),
                    kind.path.join(" ")
                )
                .into(),
                i64::from(
                    feature
                        .attributes
                        .get("nameStatus")
                        .and_then(serde_json::Value::as_str)
                        != Some("label"),
                )
                .into(),
            ],
        )?;
        self.write_bounds(
            "catalog",
            id,
            Bounds(
                encoded.bounds.0.min(footprint_bounds.0),
                encoded.bounds.1.min(footprint_bounds.1),
                encoded.bounds.2.max(footprint_bounds.2),
                encoded.bounds.3.max(footprint_bounds.3),
            ),
        )
    }
    fn write_sample(
        &self,
        map: &MapDescriptor,
        sample: MapSample,
        encoding: &codec::Samples<'_>,
    ) -> io::Result<()> {
        sample.window.bounds.validate().map_err(io::Error::other)?;
        if sample.id.is_empty()
            || !sample.cell_span.is_finite()
            || sample.cell_span <= 0.0
            || !sample.center.coordinates().iter().all(|c| c.is_finite())
            || !sample.measure.is_finite()
            || sample.measure < 0.0
        {
            return Err(io::Error::other(
                "Map samples require identity, finite center and positive resolution",
            ));
        }
        let encoded =
            self.encode_geometry(map, &sample.space_id, &region_geometry(&sample.footprint))?;
        let data = encoding.encode(&sample)?;
        let mut values = reference_values(&map.reference);
        values.extend([
            sample.id.into(),
            sample.space_id.into(),
            Value::Blob(encoded.bytes),
            Value::Blob(data),
        ]);
        self.db.execute("INSERT INTO map_samples(map_id,revision,id,space_id,geometry,data) VALUES(?,?,?,?,?,?)", &values)?;
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
pub(super) fn region_geometry(shape: &atlas_map::RegionGeometry) -> Geometry {
    match shape {
        atlas_map::RegionGeometry::Polygon(coordinates) => Geometry::Polygon {
            coordinates: coordinates.clone(),
        },
        atlas_map::RegionGeometry::MultiPolygon(coordinates) => Geometry::MultiPolygon {
            coordinates: coordinates.clone(),
        },
    }
}
