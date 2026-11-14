use super::{to_json, PostgresMaps};
use crate::map_store::{codec, space};
use atlas_map::{LayerSource, MapDescriptor, MapRef, PublicationBatch, PublishedAsset};
use std::{collections::BTreeSet, io};
impl PostgresMaps {
    pub(super) fn append_records(
        &self,
        map: &MapDescriptor,
        batch: PublicationBatch,
    ) -> io::Result<()> {
        let r = &map.reference;
        for feature in batch.features {
            feature.validate_people().map_err(io::Error::other)?;
            let space = space(map, &feature.space_id)?;
            let layer = map
                .layers
                .iter()
                .find(|l| l.id == feature.layer_id)
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
            let geometry = serde_json::to_string(&feature.geometry)?;
            let mut data = to_json(&feature)?;
            data.as_object_mut().unwrap().remove("geometry");
            self.execute("INSERT INTO map.features VALUES($1,$2,$3,$4,$5,$6,map.canonical_geometry($7,$8),$9)",&[&r.map_id,&r.revision,&feature.id,&space.id,&feature.layer_id,&feature.name,&geometry,&space.precision,&data])?;
        }
        let encoding = codec::Samples::new(map);
        for sample in batch.samples {
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
            let space = space(map, &sample.space_id)?;
            self.execute(
                "INSERT INTO map.samples VALUES($1,$2,$3,$4,map.canonical_geometry($5,$6),$7)",
                &[
                    &r.map_id,
                    &r.revision,
                    &sample.id,
                    &space.id,
                    &serde_json::to_string(&sample.footprint)?,
                    &space.precision,
                    &encoding.encode(&sample)?,
                ],
            )?;
        }
        for entity in batch.entities {
            self.execute(
                "INSERT INTO map.entities VALUES($1,$2,$3,$4)",
                &[&r.map_id, &r.revision, &entity.id, &to_json(&entity)?],
            )?;
        }
        for entry in batch.history {
            self.execute(
                "INSERT INTO map.history VALUES($1,$2,$3,$4)",
                &[&r.map_id, &r.revision, &entry.id, &to_json(&entry)?],
            )?;
            for id in entry.feature_ids.into_iter().collect::<BTreeSet<_>>() {
                self.execute(
                    "INSERT INTO map.history_features VALUES($1,$2,$3,$4)",
                    &[&r.map_id, &r.revision, &entry.id, &id],
                )?;
            }
        }
        for asset in batch.assets {
            self.write_asset(r, asset)?;
        }
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
                &r.map_id,
                &r.revision,
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
