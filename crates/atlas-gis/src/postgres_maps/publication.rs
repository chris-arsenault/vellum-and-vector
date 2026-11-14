use super::{from_json, to_json, PostgresMaps};
use atlas_map::{
    LayerSource, MapDescriptor, MapLayer, MapRef, PublicationBatch, PublicationState,
    PublishedAsset, Publisher,
};
use std::{collections::BTreeSet, io};
impl Publisher for PostgresMaps {
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
        if progressive && expected.is_some() {
            return Err(io::Error::other("Progressive publication is for a new map"));
        }
        self.transaction(|| {
            self.lock(&map.reference.map_id)?;
            if self.find_head(&map.reference.map_id)?.as_ref()!=expected {return Err(io::Error::other("The map revision changed"));}
            self.execute("INSERT INTO map.revisions(map_id,revision,descriptor,expected_revision) VALUES($1,$2,$3,$4)",&[&map.reference.map_id,&map.reference.revision,&to_json(map)?,&expected.map(|r|r.revision.as_str())])?;
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
                &[&reference.map_id, &reference.revision, &to_json(&map)?],
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
            self.require_assets(&map)?;map.state=PublicationState::Complete;
            self.execute("UPDATE map.revisions SET complete=true,descriptor=$3 WHERE map_id=$1 AND revision=$2",&[&reference.map_id,&reference.revision,&to_json(&map)?])?;
            self.set_head(reference)
        })
    }
    fn discard(&mut self, reference: &MapRef) -> io::Result<()> {
        self.transaction(|| {
            self.lock(&reference.map_id)?;
            self.pending(reference)?;
            if self.find_head(&reference.map_id)?.as_ref() == Some(reference) {
                return Ok(());
            }
            self.execute(
                "DELETE FROM map.revisions WHERE map_id=$1 AND revision=$2",
                &[&reference.map_id, &reference.revision],
            )?;
            Ok(())
        })
    }
}
impl PostgresMaps {
    fn pending(&self, r: &MapRef) -> io::Result<(MapDescriptor, Option<String>)> {
        let row=self.query("SELECT descriptor,expected_revision,complete FROM map.revisions WHERE map_id=$1 AND revision=$2 FOR UPDATE",&[&r.map_id,&r.revision])?.into_iter().next().ok_or_else(||io::Error::other("Map publication is not open"))?;
        if row
            .try_get::<_, bool>("complete")
            .map_err(io::Error::other)?
        {
            return Err(io::Error::other("Map publication is not open"));
        }
        Ok((
            from_json(row.try_get("descriptor").map_err(io::Error::other)?)?,
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
