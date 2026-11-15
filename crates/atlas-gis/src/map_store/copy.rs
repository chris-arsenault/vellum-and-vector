//! Copy immutable GIS records between local catalogs; numerical resources never enter this path.
use super::{column, reference_values, MapStore, RelatedMaps, SaveRequest, SavedMapDocument};
use crate::sql::{attached, transaction};
use atlas_map::{MapDescriptor, MapRef, PublicationState};
use std::{collections::BTreeSet, io};

impl MapStore {
    pub fn contains(&self, reference: &MapRef) -> io::Result<bool> {
        Ok(self
            .db
            .value(
                "SELECT 1 FROM maps WHERE map_id=? AND revision=?",
                &reference_values(reference),
            )?
            .is_some())
    }
    pub fn save_references(&self, request: &SaveRequest) -> io::Result<Vec<MapRef>> {
        let mut pending = vec![request.reference.clone()];
        pending.extend(
            request
                .navigation
                .regions
                .iter()
                .filter_map(|region| region.child.clone()),
        );
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        while let Some(reference) = pending.pop() {
            if !seen.insert((reference.map_id.clone(), reference.revision.clone())) {
                continue;
            }
            if let Some(parent) = self.open(&reference)?.parent {
                if self.contains(&parent)? {
                    pending.push(parent);
                }
            }
            result.push(reference);
        }
        Ok(result)
    }
    pub fn copy_from(&self, source: &str, reference: &MapRef) -> io::Result<()> {
        attached(self.db.as_ref(), source, || {
            transaction(self.db.as_ref(), || {
                let mut seen = BTreeSet::new();
                self.copy_map(reference, &mut seen)?;
                if let Some(data) = self.db.value(
                    "SELECT data FROM imported.map_saved WHERE map_id=? AND revision=?",
                    &reference_values(reference),
                )? {
                    let saved: SavedMapDocument = crate::stored::VIEW.parse(data.text()?)?;
                    for region in saved.navigation.regions {
                        if let Some(child) = region.child {
                            self.copy_map(&child, &mut seen)?;
                        }
                    }
                }
                self.db.execute("INSERT INTO map_saved SELECT * FROM imported.map_saved WHERE map_id=? AND revision=? ON CONFLICT(map_id) DO UPDATE SET revision=excluded.revision,version=excluded.version,data=excluded.data", &reference_values(reference))?;
                self.set_head(reference)
            })
        })
    }
    pub fn save_from(
        &self,
        source: &str,
        request: SaveRequest,
        time: String,
    ) -> io::Result<SavedMapDocument> {
        attached(self.db.as_ref(), source, || {
            transaction(self.db.as_ref(), || {
                let mut seen = BTreeSet::new();
                self.copy_map(&request.reference, &mut seen)?;
                for region in &request.navigation.regions {
                    if let Some(child) = &region.child {
                        self.copy_map(child, &mut seen)?;
                    }
                }
                self.save_inner(request, time)
            })
        })
    }
    pub fn related_with(&self, source: &str, reference: &MapRef) -> io::Result<RelatedMaps> {
        attached(self.db.as_ref(), source, || {
            let parent = self.open(reference)?.parent;
            let mut values = reference_values(reference);
            values.extend(reference_values(reference));
            let rows = self.db.query("SELECT m.map_id,m.revision FROM maps m JOIN map_heads h USING(map_id,revision) WHERE json_extract(descriptor,'$.parent.mapId')=? AND json_extract(descriptor,'$.parent.revision')=? UNION ALL SELECT m.map_id,m.revision FROM imported.maps m JOIN imported.map_heads h USING(map_id,revision) WHERE json_extract(descriptor,'$.parent.mapId')=? AND json_extract(descriptor,'$.parent.revision')=? AND NOT EXISTS(SELECT 1 FROM map_heads local WHERE local.map_id=m.map_id) ORDER BY map_id,revision", &values)?;
            let children = rows
                .iter()
                .map(|row| {
                    Ok(MapRef {
                        map_id: column(row, "map_id")?.text()?.into(),
                        revision: column(row, "revision")?.text()?.into(),
                    })
                })
                .collect::<io::Result<_>>()?;
            Ok(RelatedMaps { parent, children })
        })
    }
    fn copy_map(
        &self,
        reference: &MapRef,
        seen: &mut BTreeSet<(String, String)>,
    ) -> io::Result<()> {
        if !seen.insert((reference.map_id.clone(), reference.revision.clone())) {
            return Ok(());
        }
        let values = reference_values(reference);
        let descriptor = self
            .db
            .value(
                "SELECT descriptor FROM imported.maps WHERE map_id=? AND revision=?",
                &values,
            )?
            .ok_or_else(|| io::Error::other("Saved map revision was not found"))?;
        let map: MapDescriptor =
            crate::stored::read_map(serde_json::from_str(descriptor.text()?)?)?;
        if map.state != PublicationState::Complete {
            return Err(io::Error::other("Complete the map before saving it"));
        }
        if let Some(parent) = &map.parent {
            // Independent children remain usable after their parent is deleted.
            if self
                .db
                .value(
                    "SELECT 1 FROM imported.maps WHERE map_id=? AND revision=?",
                    &reference_values(parent),
                )?
                .is_some()
            {
                self.copy_map(parent, seen)?;
            }
        }
        if self
            .db
            .value("SELECT 1 FROM maps WHERE map_id=? AND revision=?", &values)?
            .is_some()
        {
            return Ok(());
        }
        self.db.execute(
            "INSERT INTO maps SELECT * FROM imported.maps WHERE map_id=? AND revision=?",
            &values,
        )?;
        self.db
            .execute("INSERT OR IGNORE INTO map_heads VALUES(?,?)", &values)?;
        for table in [
            "map_assets",
            "map_entities",
            "map_history",
            "map_history_features",
        ] {
            self.db.execute(&format!("INSERT INTO {table} SELECT * FROM imported.{table} WHERE map_id=? AND revision=?"), &values)?;
        }
        for (table, columns) in [
            (
                "map_features",
                "map_id,revision,id,space_id,layer_id,name,geometry,data",
            ),
            ("map_samples", "map_id,revision,id,space_id,geometry,data"),
        ] {
            self.db.execute(&format!("INSERT INTO {table}({columns}) SELECT {columns} FROM imported.{table} WHERE map_id=? AND revision=?"), &values)?;
        }
        let joined = "FROM imported.map_features s JOIN map_features d ON d.map_id=s.map_id AND d.revision=s.revision AND d.id=s.id JOIN imported.map_feature_catalog c ON c.row_id=s.row_id WHERE s.map_id=? AND s.revision=?";
        self.db.execute(&format!("INSERT INTO map_feature_catalog SELECT d.row_id,c.type,c.values_json,c.columns_json,c.attributes_json,c.relations_json,c.search,c.named {joined}"), &values)?;
        for (bounds, records) in [
            ("map_feature_bounds", "map_features"),
            ("map_catalog_bounds", "map_features"),
            ("map_sample_bounds", "map_samples"),
        ] {
            self.db.execute(&format!("INSERT INTO {bounds} SELECT d.row_id,b.min_x,b.max_x,b.min_y,b.max_y FROM imported.{records} s JOIN {records} d ON d.map_id=s.map_id AND d.revision=s.revision AND d.id=s.id JOIN imported.{bounds} b ON b.row_id=s.row_id WHERE s.map_id=? AND s.revision=?"), &values)?;
        }
        Ok(())
    }
}
