use super::{description::key, MapStore};
use crate::sql::{column, transaction};
use atlas_map::{
    Id, LayerSource, MapDescriptor, MapLayer, MapRef, PublicationBatch, PublicationState,
    PublishedAsset, Publisher,
};
use std::io;

impl Publisher for MapStore {
    // Arconis: docs/architecture/subsystems.arconis#item=j_bw_store — opens a publication in the browser SQLite/GEOS map store.
    fn begin(
        &mut self,
        map: &MapDescriptor,
        expected: Option<&MapRef>,
        progressive: bool,
    ) -> io::Result<()> {
        map.validate().map_err(io::Error::other)?;
        if expected.is_some_and(|expected| expected.map_id != map.reference.map_id) {
            return Err(io::Error::other(
                "Expected revision must belong to the published map",
            ));
        }
        if map.state != PublicationState::Incomplete {
            return Err(io::Error::other(
                "Publication begins with an incomplete map",
            ));
        }
        // A progressive publication becomes the head at once, replacing any expected revision.
        // The producer decides which maps stream; a regeneration of generated geography does not.
        self.open.replace(None);
        transaction(self.db.as_ref(), || {
            if self.find_head(map.reference.map_id)?.as_ref() != expected {
                return Err(io::Error::other("The map revision changed"));
            }
            if let Some(expected) = expected {
                crate::authoring::refuse_authored(&self.open(expected)?)?;
            }
            self.write_revision(map, expected.map(|r| r.revision))?;
            if progressive {
                self.set_head(&map.reference)?;
            }
            Ok(())
        })?;
        self.open.replace(Some(map.clone()));
        Ok(())
    }
    fn append(&mut self, reference: &MapRef, batch: PublicationBatch) -> io::Result<()> {
        transaction(self.db.as_ref(), || {
            self.hold(reference)?;
            let open = self.open.borrow();
            let map = open
                .as_ref()
                .ok_or_else(|| io::Error::other("Map publication is not open"))?;
            self.append_records(map, batch)
        })
    }
    fn add_layers(
        &mut self,
        reference: &MapRef,
        layers: &[MapLayer],
        asset: PublishedAsset,
    ) -> io::Result<()> {
        for layer in layers {
            layer.validate().map_err(io::Error::other)?;
            let id = match &layer.source {
                LayerSource::Raster(source) => &source.asset_id,
                LayerSource::Vector(source) => &source.asset_id,
                _ => return Err(io::Error::other("Attribute layer has no asset")),
            };
            if id != &asset.id {
                return Err(io::Error::other("Layer and asset identities differ"));
            }
        }
        transaction(self.db.as_ref(), || {
            self.hold(reference)?;
            let first = self.next_layer(reference)?;
            self.write_layers(reference, layers, first)?;
            self.write_asset(reference, asset)
        })?;
        if let Some(map) = self.open.borrow_mut().as_mut() {
            map.layers.extend_from_slice(layers);
            map.validate().map_err(io::Error::other)?;
        }
        Ok(())
    }
    fn finish(&mut self, reference: &MapRef) -> io::Result<()> {
        self.open.replace(None);
        transaction(self.db.as_ref(), || {
            let (map, expected) = self.pending(reference)?;
            let head = self.find_head(reference.map_id)?.map(|head| head.revision);
            if head != Some(reference.revision) && head != expected {
                return Err(io::Error::other("The map changed during publication"));
            }
            // An edit made while this regeneration ran keeps the revision but authors the map.
            if let Some(revision) = expected {
                crate::authoring::refuse_authored(&self.open(&MapRef {
                    map_id: reference.map_id,
                    revision,
                })?)?;
            }
            self.require_assets(&map)?;
            self.db.execute(
                "UPDATE maps SET complete=1 WHERE map_id=? AND revision=?",
                &key(reference),
            )?;
            self.set_head(reference)
        })
    }
    /// A new map keeps the output it streamed. Any other unfinished revision is removed, and a
    /// streamed one puts back the revision it replaced, so the map can be generated again.
    fn discard(&mut self, reference: &MapRef) -> io::Result<()> {
        self.open.replace(None);
        let (_, expected) = self.pending(reference)?;
        let streamed = self.find_head(reference.map_id)?.as_ref() == Some(reference);
        if streamed && expected.is_none() {
            return Ok(());
        }
        self.restart_publication(reference)
    }
}
impl MapStore {
    pub fn restart_publication(&self, reference: &MapRef) -> io::Result<()> {
        crate::sql::transaction(&self.db, || {
            let values = key(reference);
            let Some(row) = self
                .db
                .query(
                    "SELECT complete,expected_revision FROM maps WHERE map_id=? AND revision=?",
                    &values,
                )?
                .into_iter()
                .next()
            else {
                return Ok(());
            };
            if column(&row, "complete")?.flag()? {
                return Err(io::Error::other("Cannot restart a completed publication"));
            }
            let expected = column(&row, "expected_revision")?.optional_id()?;
            let streamed = self.find_head(reference.map_id)?.as_ref() == Some(reference);
            for table in ["map_saved", "map_heads", "maps"] {
                self.db.execute(
                    &format!("DELETE FROM {table} WHERE map_id=? AND revision=?"),
                    &values,
                )?;
            }
            // A streamed revision replaced the head it expected; restarting puts that head back
            // so the resumed job finds the revision it started from.
            if let (true, Some(revision)) = (streamed, expected) {
                self.set_head(&MapRef {
                    map_id: reference.map_id,
                    revision,
                })?;
            }
            Ok(())
        })
    }
    pub(super) fn set_head(&self, reference: &MapRef) -> io::Result<()> {
        self.db.execute(
            "INSERT INTO map_heads VALUES(?,?) ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision",
            &key(reference),
        )?;
        Ok(())
    }
    /// Checks the publication is still open and holds its description.
    fn hold(&self, reference: &MapRef) -> io::Result<()> {
        let held = self
            .open
            .borrow()
            .as_ref()
            .is_some_and(|map| map.reference == *reference);
        if held {
            let complete = self.db.value(
                "SELECT complete FROM maps WHERE map_id=? AND revision=?",
                &key(reference),
            )?;
            if complete.map(|v| v.flag()).transpose()? != Some(false) {
                self.open.replace(None);
                return Err(io::Error::other("Map publication is not open"));
            }
            return Ok(());
        }
        let (map, _) = self.pending(reference)?;
        self.open.replace(Some(map));
        Ok(())
    }
    fn pending(&self, reference: &MapRef) -> io::Result<(MapDescriptor, Option<Id>)> {
        let complete = self
            .db
            .value(
                "SELECT complete FROM maps WHERE map_id=? AND revision=?",
                &key(reference),
            )?
            .ok_or_else(|| io::Error::other("Map publication is not open"))?;
        if complete.flag()? {
            return Err(io::Error::other("Map publication is not open"));
        }
        self.read_description(reference)
    }
    pub(super) fn write_asset(&self, reference: &MapRef, asset: PublishedAsset) -> io::Result<()> {
        if asset.id.is_empty()
            || asset.location.is_empty()
            || asset.media_type.is_empty()
            || asset.byte_length > 9_007_199_254_740_991
        {
            return Err(io::Error::other("Published assets need identity, location, media type and representable byte length"));
        }
        let mut values = key(reference);
        values.extend([
            asset.id.into(),
            asset.media_type.into(),
            asset.location.into(),
            (asset.byte_length as i64).into(),
            asset.illustration.into(),
        ]);
        self.db
            .execute("INSERT INTO map_assets VALUES(?,?,?,?,?,?,?)", &values)?;
        Ok(())
    }
    fn require_assets(&self, map: &MapDescriptor) -> io::Result<()> {
        for layer in &map.layers {
            let ids = match &layer.source {
                LayerSource::Vector(source) => vec![source.asset_id.as_str()],
                LayerSource::Raster(source) => std::iter::once(source.asset_id.as_str())
                    .chain(source.overviews.iter().map(String::as_str))
                    .collect(),
                _ => continue,
            };
            for id in ids {
                let mut values = key(&map.reference);
                values.push(id.into());
                if self
                    .db
                    .value(
                        "SELECT 1 FROM map_assets WHERE map_id=? AND revision=? AND id=?",
                        &values,
                    )?
                    .is_none()
                {
                    return Err(io::Error::other(format!(
                        "Map is missing published asset {id}"
                    )));
                }
            }
        }
        Ok(())
    }
}
