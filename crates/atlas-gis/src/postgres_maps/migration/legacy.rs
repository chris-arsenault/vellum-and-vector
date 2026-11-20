//! Convert stored map rows before exposing the upgraded catalogue to readers.
mod values;
use super::{get, PostgresMaps, SCHEMA};
use crate::postgres_maps::{id, records::Open, uuid};
use crate::{
    map_store::codec,
    postgres_migrations::{legacy_id, legacy_ids},
};
use atlas_map::{MapColumn, MapRef, MapSample, PublicationBatch};
use postgres::{types::ToSql, Row};
use serde_json::Value;
use std::{collections::BTreeMap, io};

impl PostgresMaps {
    pub(super) fn migrate_legacy_maps(&self) -> io::Result<()> {
        self.batch(include_str!("001_stage_legacy.sql"))?;
        self.batch(SCHEMA)?;
        for row in self.query(
            "SELECT map_id,revision,descriptor,expected_revision,complete FROM atlas_map_upgrade.revisions",
            &[],
        )? {
            let key = LegacyKey::of(&row)?;
            self.copy_revision(&row, &key).map_err(|error| {
                io::Error::other(format!("map {} revision {}: {error}", key.map, key.revision))
            })?;
        }
        for row in self.query("SELECT map_id,revision FROM atlas_map_upgrade.heads", &[])? {
            let [map, revision] = LegacyKey::of(&row)?.uuids();
            self.execute("INSERT INTO map.heads VALUES($1,$2)", &[&map, &revision])?;
        }
        self.batch(include_str!("001_finish_legacy.sql"))
    }

    fn copy_revision(&self, row: &Row, key: &LegacyKey) -> io::Result<()> {
        let mut descriptor: Value = get(row, "descriptor")?;
        let bands = values::sample_only_bands(&descriptor["layers"])?;
        values::description(&mut descriptor);
        let map = crate::stored::read_map(descriptor)?;
        if map.reference != key.reference() {
            return Err(io::Error::other("Stored description and map key differ"));
        }
        let expected = get::<Option<String>>(row, "expected_revision")?;
        self.write_revision(&map, expected.as_deref().map(legacy_id))?;
        let open = Open::new(map);
        self.copy_features(key, &open)?;
        self.copy_samples(key, &open, &bands, false)?;
        self.copy_revision_records(key, &open)?;
        self.copy_assets_and_edits(key)?;
        self.copy_saved_view(key)?;
        if get::<bool>(row, "complete")? {
            self.complete_revision(&open.map.reference)?;
        }
        Ok(())
    }

    fn copy_features(&self, key: &LegacyKey, open: &Open) -> io::Result<()> {
        let mut after = None::<String>;
        loop {
            let rows = self.query(
                "SELECT id,data,ST_AsBinary(geometry) AS geometry
                 FROM atlas_map_upgrade.features WHERE map_id=$1 AND revision=$2
                 AND ($3::text IS NULL OR id>$3) ORDER BY id LIMIT 1024",
                &[&key.map, &key.revision, &after],
            )?;
            let Some(last) = rows.last() else {
                return Ok(());
            };
            after = Some(get(last, "id")?);
            self.copy_feature_batch(open, &rows)?;
        }
    }

    fn copy_feature_batch(&self, open: &Open, rows: &[Row]) -> io::Result<()> {
        let mut batch = PublicationBatch::default();
        let mut columns = BTreeMap::<String, MapColumn>::new();
        for row in rows {
            let mut feature: Value = get(row, "data")?;
            feature["geometry"] =
                serde_json::to_value(self.geometry.decode(get(row, "geometry")?)?)?;
            for column in values::feature(&mut feature)? {
                columns
                    .entry(column.key.clone())
                    .and_modify(|prior| {
                        prior.numeric |= column.numeric;
                    })
                    .or_insert(column);
            }
            batch.features.push(serde_json::from_value(feature)?);
        }
        batch.columns = columns.into_values().collect();
        self.append_records(open, batch)
    }

    fn copy_revision_records(&self, key: &LegacyKey, open: &Open) -> io::Result<()> {
        let mut batch = PublicationBatch::default();
        for row in self.query(
            "SELECT data FROM atlas_map_upgrade.history WHERE map_id=$1 AND revision=$2 ORDER BY id",
            &key.parameters(),
        )? {
            let mut value: Value = get(&row, "data")?;
            values::history(&mut value);
            batch.history.push(serde_json::from_value(value)?);
        }
        for row in self.query(
            "SELECT data FROM atlas_map_upgrade.entities WHERE map_id=$1 AND revision=$2",
            &key.parameters(),
        )? {
            let mut value: Value = get(&row, "data")?;
            legacy_ids(&mut value, &["id"]);
            batch.entities.push(serde_json::from_value(value)?);
        }
        self.append_records(open, batch)
    }

    fn copy_assets_and_edits(&self, key: &LegacyKey) -> io::Result<()> {
        let [map, revision] = key.uuids();
        self.execute(
            "INSERT INTO map.assets
             SELECT $3,$4,id,media_type,location,byte_length,illustration FROM atlas_map_upgrade.assets
             WHERE map_id=$1 AND revision=$2",
            &[&key.map, &key.revision, &map, &revision],
        )?;
        for row in self.query(
            "SELECT sequence,label,undone,data FROM atlas_map_upgrade.edits WHERE map_id=$1 AND revision=$2",
            &key.parameters(),
        )? {
            let mut data: Value = get(&row, "data")?;
            values::edit(&mut data)?;
            let _: atlas_map::authoring::EditRecord = serde_json::from_value(data.clone())?;
            self.execute(
                "INSERT INTO map.edits VALUES($1,$2,$3,$4,$5,$6)",
                &[&map, &revision, &get::<i32>(&row, "sequence")?, &get::<String>(&row, "label")?,
                  &get::<bool>(&row, "undone")?, &data],
            )?;
        }
        Ok(())
    }

    fn copy_saved_view(&self, key: &LegacyKey) -> io::Result<()> {
        let [map, revision] = key.uuids();
        for row in self.query(
            "SELECT version,data FROM atlas_map_upgrade.saved WHERE map_id=$1 AND revision=$2",
            &key.parameters(),
        )? {
            let mut data: Value = get(&row, "data")?;
            values::view(&mut data);
            let _: crate::map_store::SavedMapDocument = crate::stored::VIEW.read(data.clone())?;
            self.execute(
                "INSERT INTO map.saved VALUES($1,$2,$3,$4)",
                &[&map, &revision, &get::<i64>(&row, "version")?, &data],
            )?;
        }
        Ok(())
    }

    pub(super) fn migrate_packed_samples(&self) -> io::Result<()> {
        let maps = self.query(
            "SELECT DISTINCT map_id,revision FROM atlas_map_upgrade.samples",
            &[],
        )?;
        for row in maps {
            let reference = MapRef {
                map_id: id(get(&row, "map_id")?),
                revision: id(get(&row, "revision")?),
            };
            let band_rows = self.query(
                "SELECT l.source=2 AND l.asset_id IS NULL AS sample_only, l.id AS layer, b.id,b.name,b.unit
                 FROM map.layers l JOIN map.bands b
                 ON (l.map_id,l.revision,l.ordinal)=(b.map_id,b.revision,b.layer)
                 WHERE l.map_id=$1 AND l.revision=$2 ORDER BY l.ordinal,b.ordinal",
                &[&uuid(reference.map_id), &uuid(reference.revision)],
            )?;
            let bands = band_rows
                .iter()
                .map(sample_only_band)
                .collect::<io::Result<Vec<_>>>()?;
            self.execute(
                "DELETE FROM map.layers WHERE map_id=$1 AND revision=$2 AND source=2 AND asset_id IS NULL",
                &[&uuid(reference.map_id), &uuid(reference.revision)],
            )?;
            let open = Open::new(self.open(&reference)?);
            let key = LegacyKey {
                map: reference.map_id.to_string(),
                revision: reference.revision.to_string(),
            };
            self.copy_samples(&key, &open, &bands, true)?;
        }
        self.execute(
            "DELETE FROM map.layers WHERE source=2 AND asset_id IS NULL",
            &[],
        )?;
        Ok(())
    }

    fn copy_samples(
        &self,
        key: &LegacyKey,
        open: &Open,
        bands: &[Option<values::SampleBand>],
        typed: bool,
    ) -> io::Result<()> {
        let filter = if typed {
            "map_id=$1::text::uuid AND revision=$2::text::uuid"
        } else {
            "map_id=$1 AND revision=$2"
        };
        let sql = format!(
            "SELECT id,data,ST_AsBinary(geometry) AS geometry FROM atlas_map_upgrade.samples
             WHERE {filter} AND ($3::text IS NULL OR id>$3) ORDER BY id LIMIT 1024"
        );
        let mut after = None::<String>;
        loop {
            let rows = self.query(&sql, &[&key.map, &key.revision, &after])?;
            let Some(last) = rows.last() else {
                return Ok(());
            };
            after = Some(get(last, "id")?);
            let samples = rows
                .iter()
                .map(|row| self.legacy_sample(row, bands))
                .collect::<io::Result<Vec<_>>>()?;
            self.append_records(
                open,
                PublicationBatch {
                    samples,
                    ..Default::default()
                },
            )?;
        }
    }

    fn legacy_sample(
        &self,
        row: &Row,
        bands: &[Option<values::SampleBand>],
    ) -> io::Result<MapSample> {
        let mut value: Value = codec::decode(get::<&[u8]>(row, "data")?)?;
        values::sample(&mut value, bands)?;
        let geometry = self.geometry.decode(get(row, "geometry")?)?;
        value["footprint"] = serde_json::to_value(
            atlas_map::regions::as_region(geometry).map_err(io::Error::other)?,
        )?;
        serde_json::from_value(value).map_err(io::Error::other)
    }
}

fn sample_only_band(row: &Row) -> io::Result<Option<values::SampleBand>> {
    if !get::<bool>(row, "sample_only")? {
        return Ok(None);
    }
    Ok(Some(values::SampleBand {
        layer: get(row, "layer")?,
        id: get(row, "id")?,
        name: get(row, "name")?,
        unit: get(row, "unit")?,
    }))
}

struct LegacyKey {
    map: String,
    revision: String,
}

impl LegacyKey {
    fn of(row: &Row) -> io::Result<Self> {
        Ok(Self {
            map: get(row, "map_id")?,
            revision: get(row, "revision")?,
        })
    }

    fn parameters(&self) -> [&(dyn ToSql + Sync); 2] {
        [&self.map, &self.revision]
    }

    fn reference(&self) -> MapRef {
        MapRef {
            map_id: legacy_id(&self.map),
            revision: legacy_id(&self.revision),
        }
    }

    fn uuids(&self) -> [uuid::Uuid; 2] {
        let r = self.reference();
        [uuid(r.map_id), uuid(r.revision)]
    }
}
