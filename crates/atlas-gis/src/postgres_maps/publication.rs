use super::PostgresMaps;
use crate::stored::{read_map, MAP};
use atlas_map::{
    LayerSource, MapDescriptor, MapLayer, MapRef, PublicationBatch, PublicationState,
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
        self.transaction(|| {
            self.lock(&map.reference.map_id)?;
            if self.find_head(&map.reference.map_id)?.as_ref()!=expected {return Err(io::Error::other("The map revision changed"));}
            if let Some(expected) = expected {
                crate::authoring::refuse_authored(&self.open(expected)?)?;
            }
            self.execute("INSERT INTO map.revisions(map_id,revision,descriptor,expected_revision) VALUES($1,$2,$3,$4)",&[&map.reference.map_id,&map.reference.revision,&MAP.write(map)?,&expected.map(|r|r.revision.as_str())])?;
            if progressive {self.set_head(&map.reference)?;}
            Ok(())
        })
    }
    fn append(&mut self, reference: &MapRef, batch: PublicationBatch) -> io::Result<()> {
        self.transaction(|| {
            let (map, _) = self.pending(reference)?;
            self.append_records(&map, batch)
        })
    }
    fn add_layers(
        &mut self,
        reference: &MapRef,
        layers: &[MapLayer],
        asset: PublishedAsset,
    ) -> io::Result<()> {
        self.transaction(|| {
            let (mut map, _) = self.pending(reference)?;
            map.layers.extend_from_slice(layers);
            map.validate().map_err(io::Error::other)?;
            for layer in layers {
                let id = match &layer.source {
                    LayerSource::Vector(s) => &s.asset_id,
                    LayerSource::Raster(s) => &s.asset_id,
                    _ => return Err(io::Error::other("Layer and asset identities differ")),
                };
                if id != &asset.id {
                    return Err(io::Error::other("Layer and asset identities differ"));
                }
            }
            self.write_asset(reference, asset)?;
            self.execute(
                "UPDATE map.revisions SET descriptor=$3 WHERE map_id=$1 AND revision=$2",
                &[&reference.map_id, &reference.revision, &MAP.write(&map)?],
            )?;
            Ok(())
        })
    }
    fn finish(&mut self, reference: &MapRef) -> io::Result<()> {
        self.transaction(|| {
            self.lock(&reference.map_id)?;
            let (mut map,expected)=self.pending(reference)?;
            let current=self.find_head(&reference.map_id)?.map(|r|r.revision);
            if current.as_ref()!=Some(&reference.revision) && current!=expected {return Err(io::Error::other("The map changed during publication"));}
            // An edit made while this regeneration ran keeps the revision but authors the map.
            if let Some(revision) = &expected {
                crate::authoring::refuse_authored(&self.open(&MapRef {
                    map_id: reference.map_id.clone(),
                    revision: revision.clone(),
                })?)?;
            }
            self.require_assets(&map)?;map.state=PublicationState::Complete;
            self.execute("UPDATE map.revisions SET complete=true,descriptor=$3 WHERE map_id=$1 AND revision=$2",&[&reference.map_id,&reference.revision,&MAP.write(&map)?])?;
            self.set_head(reference)
        })
    }
    /// A new map keeps the output it streamed. Any other unfinished revision is removed, and a
    /// streamed one puts back the revision it replaced, so the map can be generated again.
    fn discard(&mut self, reference: &MapRef) -> io::Result<()> {
        let keep =
            self.transaction(|| {
                self.lock(&reference.map_id)?;
                let (_, expected) = self.pending(reference)?;
                Ok(expected.is_none()
                    && self.find_head(&reference.map_id)?.as_ref() == Some(reference))
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
        self.transaction(|| {
            self.lock(&reference.map_id)?;
            let Some(row) = self
                .query(
                    "SELECT complete,expected_revision FROM map.revisions WHERE map_id=$1 AND revision=$2",
                    &[&reference.map_id, &reference.revision],
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
            let expected: Option<String> = row
                .try_get("expected_revision")
                .map_err(io::Error::other)?;
            let streamed = !self
                .query(
                    "SELECT 1 FROM map.heads WHERE map_id=$1 AND revision=$2",
                    &[&reference.map_id, &reference.revision],
                )?
                .is_empty();
            self.execute(
                "DELETE FROM map.saved WHERE map_id=$1 AND revision=$2",
                &[&reference.map_id, &reference.revision],
            )?;
            self.execute(
                "DELETE FROM map.heads WHERE map_id=$1 AND revision=$2",
                &[&reference.map_id, &reference.revision],
            )?;
            self.execute(
                "DELETE FROM map.revisions WHERE map_id=$1 AND revision=$2",
                &[&reference.map_id, &reference.revision],
            )?;
            if let (true, Some(revision)) = (streamed, expected) {
                self.set_head(&MapRef {
                    map_id: reference.map_id.clone(),
                    revision,
                })?;
            }
            Ok(())
        })
    }
    fn pending(&self, r: &MapRef) -> io::Result<(MapDescriptor, Option<String>)> {
        let row=self.query("SELECT descriptor,expected_revision,complete FROM map.revisions WHERE map_id=$1 AND revision=$2 FOR UPDATE",&[&r.map_id,&r.revision])?.into_iter().next().ok_or_else(||io::Error::other("Map publication is not open"))?;
        if row
            .try_get::<_, bool>("complete")
            .map_err(io::Error::other)?
        {
            return Err(io::Error::other("Map publication is not open"));
        }
        Ok((
            read_map(row.try_get("descriptor").map_err(io::Error::other)?)?,
            row.try_get("expected_revision").map_err(io::Error::other)?,
        ))
    }
    fn set_head(&self, r: &MapRef) -> io::Result<()> {
        self.execute("INSERT INTO map.heads VALUES($1,$2) ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision",&[&r.map_id,&r.revision])?;
        Ok(())
    }
    fn require_assets(&self, map: &MapDescriptor) -> io::Result<()> {
        let rows = self.query(
            "SELECT id FROM map.assets WHERE map_id=$1 AND revision=$2",
            &[&map.reference.map_id, &map.reference.revision],
        )?;
        let ids = rows
            .iter()
            .map(|row| row.try_get::<_, String>("id").map_err(io::Error::other))
            .collect::<io::Result<BTreeSet<_>>>()?;
        for layer in &map.layers {
            let assets = match &layer.source {
                LayerSource::Vector(s) => vec![s.asset_id.as_str()],
                LayerSource::Raster(s) => std::iter::once(s.asset_id.as_str())
                    .chain(s.overviews.iter().map(String::as_str))
                    .collect(),
                _ => continue,
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
