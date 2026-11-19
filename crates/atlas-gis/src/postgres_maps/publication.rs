use super::{id, records::Open, uuid, PostgresMaps};
use atlas_map::{
    Id, LayerSource, MapDescriptor, MapLayer, MapRef, PublicationBatch, PublicationState,
    PublishedAsset, Publisher,
};
use std::{collections::BTreeSet, io};
impl Publisher for PostgresMaps {
    // Arconis: docs/architecture/subsystems.arconis#item=j_be_store — opens a publication in the PostGIS map schema under a row lock.
    fn begin(
        &mut self,
        map: &MapDescriptor,
        expected: Option<&MapRef>,
        progressive: bool,
    ) -> io::Result<()> {
        map.validate().map_err(io::Error::other)?;
        if expected.is_some_and(|r| r.map_id != map.reference.map_id) {
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
        self.transaction(|| {
            self.lock(map.reference.map_id)?;
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
        self.open.replace(Some(Open::new(map.clone())));
        Ok(())
    }
    fn append(&mut self, reference: &MapRef, batch: PublicationBatch) -> io::Result<()> {
        self.transaction(|| {
            self.hold(reference)?;
            let open = self.open.borrow();
            let open = open
                .as_ref()
                .ok_or_else(|| io::Error::other("Map publication is not open"))?;
            self.append_records(open, batch)
        })
    }
    /// Adds the layers' rows only. The held description gains them, so the appends that
    /// follow check their features against them.
    fn add_layers(
        &mut self,
        reference: &MapRef,
        layers: &[MapLayer],
        asset: PublishedAsset,
    ) -> io::Result<()> {
        for layer in layers {
            layer.validate().map_err(io::Error::other)?;
            let id = match &layer.source {
                LayerSource::Vector(s) => &s.asset_id,
                LayerSource::Raster(s) | LayerSource::Attributes(s) => &s.asset_id,
            };
            if id != &asset.id {
                return Err(io::Error::other("Layer and asset identities differ"));
            }
        }
        self.transaction(|| {
            self.hold(reference)?;
            let first = self.next_layer(reference)?;
            self.write_layers(reference, layers, first)?;
            self.write_asset(reference, asset)
        })?;
        let mut held = self.open.borrow_mut();
        if let Some(open) = held.as_mut() {
            let mut map = open.map.clone();
            map.layers.extend_from_slice(layers);
            map.validate().map_err(io::Error::other)?;
            *open = Open::new(map);
        }
        Ok(())
    }
    fn finish(&mut self, reference: &MapRef) -> io::Result<()> {
        self.open.replace(None);
        self.transaction(|| {
            self.lock(reference.map_id)?;
            let (map, expected) = self.pending(reference)?;
            let current = self.find_head(reference.map_id)?.map(|r| r.revision);
            if current != Some(reference.revision) && current != expected {
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
            self.complete_revision(reference)?;
            self.set_head(reference)
        })
    }
    /// A new map keeps the output it streamed. Any other unfinished revision is removed, and a
    /// streamed one puts back the revision it replaced, so the map can be generated again.
    fn discard(&mut self, reference: &MapRef) -> io::Result<()> {
        self.open.replace(None);
        let keep = self.transaction(|| {
            self.lock(reference.map_id)?;
            let (_, expected) = self.pending(reference)?;
            Ok(expected.is_none() && self.find_head(reference.map_id)?.as_ref() == Some(reference))
        })?;
        if keep {
            return Ok(());
        }
        self.restart_publication(reference)
    }
}
impl PostgresMaps {
    /// A retry may replace its own incomplete publication. A streamed revision that replaced
    /// the head it expected puts that head back, so the resumed job finds its starting revision.
    pub fn restart_publication(&self, reference: &MapRef) -> io::Result<()> {
        let (map_id, revision) = (uuid(reference.map_id), uuid(reference.revision));
        self.transaction(|| {
            self.lock(reference.map_id)?;
            let Some(row) = self
                .query(
                    "SELECT complete,expected_revision FROM map.revisions WHERE map_id=$1 AND revision=$2",
                    &[&map_id, &revision],
                )?
                .into_iter()
                .next()
            else {
                return Ok(());
            };
            if row
                .try_get::<_, bool>("complete")
                .map_err(io::Error::other)?
            {
                return Err(io::Error::other("Cannot restart a completed publication"));
            }
            let expected: Option<uuid::Uuid> = row
                .try_get("expected_revision")
                .map_err(io::Error::other)?;
            let streamed = !self
                .query(
                    "SELECT 1 FROM map.heads WHERE map_id=$1 AND revision=$2",
                    &[&map_id, &revision],
                )?
                .is_empty();
            for table in ["map.saved", "map.heads", "map.revisions"] {
                self.execute(
                    &format!("DELETE FROM {table} WHERE map_id=$1 AND revision=$2"),
                    &[&map_id, &revision],
                )?;
            }
            if let (true, Some(previous)) = (streamed, expected) {
                self.set_head(&MapRef {
                    map_id: reference.map_id,
                    revision: id(previous),
                })?;
            }
            Ok(())
        })
    }
    /// Locks the publication's row and checks it is still open. The description is read and
    /// held only when this connection does not hold it already.
    fn hold(&self, r: &MapRef) -> io::Result<()> {
        let held = self
            .open
            .borrow()
            .as_ref()
            .is_some_and(|open| open.map.reference == *r);
        if !held {
            let (map, _) = self.pending(r)?;
            self.open.replace(Some(Open::new(map)));
            return Ok(());
        }
        let complete = self
            .query(
                "SELECT complete FROM map.revisions WHERE map_id=$1 AND revision=$2 FOR UPDATE",
                &[&uuid(r.map_id), &uuid(r.revision)],
            )?
            .into_iter()
            .next()
            .map(|row| row.try_get::<_, bool>("complete"))
            .transpose()
            .map_err(io::Error::other)?;
        if complete != Some(false) {
            self.open.replace(None);
            return Err(io::Error::other("Map publication is not open"));
        }
        Ok(())
    }
    fn pending(&self, r: &MapRef) -> io::Result<(MapDescriptor, Option<Id>)> {
        let complete = self
            .query(
                "SELECT complete FROM map.revisions WHERE map_id=$1 AND revision=$2 FOR UPDATE",
                &[&uuid(r.map_id), &uuid(r.revision)],
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Map publication is not open"))?
            .try_get::<_, bool>("complete")
            .map_err(io::Error::other)?;
        if complete {
            return Err(io::Error::other("Map publication is not open"));
        }
        self.read_description(r)
    }
    fn set_head(&self, r: &MapRef) -> io::Result<()> {
        self.execute(
            "INSERT INTO map.heads VALUES($1,$2) ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision",
            &[&uuid(r.map_id), &uuid(r.revision)],
        )?;
        Ok(())
    }
    fn require_assets(&self, map: &MapDescriptor) -> io::Result<()> {
        let rows = self.query(
            "SELECT id FROM map.assets WHERE map_id=$1 AND revision=$2",
            &[&uuid(map.reference.map_id), &uuid(map.reference.revision)],
        )?;
        let ids = rows
            .iter()
            .map(|row| row.try_get::<_, String>("id").map_err(io::Error::other))
            .collect::<io::Result<BTreeSet<_>>>()?;
        for layer in &map.layers {
            let assets = match &layer.source {
                LayerSource::Vector(s) => vec![s.asset_id.as_str()],
                LayerSource::Raster(s) | LayerSource::Attributes(s) => {
                    std::iter::once(s.asset_id.as_str())
                        .chain(s.overviews.iter().map(String::as_str))
                        .collect()
                }
            };
            for id in assets {
                if !ids.contains(id) {
                    return Err(io::Error::other(format!(
                        "Map is missing published asset {id}"
                    )));
                }
            }
        }
        Ok(())
    }
}
