use super::{json, reference_values, MapStore};
use crate::sql::{column, transaction, Value};
use atlas_map::{
    LayerSource, MapDescriptor, MapLayer, MapRef, PublicationBatch, PublicationState,
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
        if progressive && expected.is_some() {
            return Err(io::Error::other("Progressive publication is for a new map"));
        }
        transaction(self.db.as_ref(), || {
            if self.find_head(&map.reference.map_id)?.as_ref() != expected {
                return Err(io::Error::other("The map revision changed"));
            }
            let mut values = reference_values(&map.reference);
            values.extend([
                json(map)?,
                expected.map_or(Value::Null, |expected| expected.revision.clone().into()),
            ]);
            self.db.execute(
                "INSERT INTO maps(map_id,revision,descriptor,expected_revision) VALUES(?,?,?,?)",
                &values,
            )?;
            if progressive {
                self.set_head(&map.reference)?;
            }
            Ok(())
        })
    }
    fn append(&mut self, reference: &MapRef, batch: PublicationBatch) -> io::Result<()> {
        transaction(self.db.as_ref(), || {
            let map = self.pending(reference)?;
            self.append_records(&map, batch)
        })
    }
    fn add_layers(
        &mut self,
        reference: &MapRef,
        layers: &[MapLayer],
        asset: PublishedAsset,
    ) -> io::Result<()> {
        transaction(self.db.as_ref(), || {
            let mut map = self.pending(reference)?;
            map.layers.extend_from_slice(layers);
            map.validate().map_err(io::Error::other)?;
            for layer in layers {
                let id = match &layer.source {
                    LayerSource::Raster(source) => &source.asset_id,
                    LayerSource::Vector(source) => &source.asset_id,
                    _ => return Err(io::Error::other("Attribute layer has no asset")),
                };
                if id != &asset.id {
                    return Err(io::Error::other("Layer and asset identities differ"));
                }
            }
            self.write_asset(reference, asset)?;
            self.db.execute(
                "UPDATE maps SET descriptor=? WHERE map_id=? AND revision=?",
                &[vec![json(&map)?], reference_values(reference)].concat(),
            )?;
            Ok(())
        })
    }
    fn finish(&mut self, reference: &MapRef) -> io::Result<()> {
        transaction(self.db.as_ref(), || {
            let mut map = self.pending(reference)?;
            let expected = self.db.value(
                "SELECT expected_revision FROM maps WHERE map_id=? AND revision=?",
                &reference_values(reference),
            )?;
            let expected = expected
                .filter(|v| *v != Value::Null)
                .map(|v| v.text().map(String::from))
                .transpose()?;
            let head = self.find_head(&reference.map_id)?.map(|head| head.revision);
            if head.as_deref() != Some(&reference.revision) && head != expected {
                return Err(io::Error::other("The map changed during publication"));
            }
            self.require_assets(&map)?;
            map.state = PublicationState::Complete;
            self.db.execute(
                "UPDATE maps SET complete=1,descriptor=? WHERE map_id=? AND revision=?",
                &[vec![json(&map)?], reference_values(reference)].concat(),
            )?;
            self.set_head(reference)
        })
    }
    fn discard(&mut self, reference: &MapRef) -> io::Result<()> {
        transaction(self.db.as_ref(), || {
            self.pending(reference)?;
            if self.find_head(&reference.map_id)?.as_ref() == Some(reference) {
                return Ok(());
            }
            self.db.execute(
                "DELETE FROM maps WHERE map_id=? AND revision=?",
                &reference_values(reference),
            )?;
            Ok(())
        })
    }
}
impl MapStore {
    pub(super) fn set_head(&self, reference: &MapRef) -> io::Result<()> {
        self.db.execute("INSERT INTO map_heads VALUES(?,?) ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision", &reference_values(reference))?;
        Ok(())
    }
    fn pending(&self, reference: &MapRef) -> io::Result<MapDescriptor> {
        let row = self
            .db
            .query(
                "SELECT descriptor,complete FROM maps WHERE map_id=? AND revision=?",
                &reference_values(reference),
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("Map publication is not open"))?;
        if column(&row, "complete")?.integer()? != 0 {
            return Err(io::Error::other("Map publication is not open"));
        }
        serde_json::from_str(column(&row, "descriptor")?.text()?).map_err(io::Error::other)
    }
    pub(super) fn write_asset(&self, reference: &MapRef, asset: PublishedAsset) -> io::Result<()> {
        if asset.id.is_empty()
            || asset.location.is_empty()
            || asset.media_type.is_empty()
            || asset.byte_length > 9_007_199_254_740_991
        {
            return Err(io::Error::other("Published assets need identity, location, media type and representable byte length"));
        }
        let mut values = reference_values(reference);
        values.extend([
            asset.id.into(),
            asset.media_type.into(),
            asset.location.into(),
            (asset.byte_length as i64).into(),
            i64::from(asset.illustration).into(),
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
                let mut values = reference_values(&map.reference);
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
