//! Copy immutable GIS records between local catalogs; numerical resources never enter this path.
use super::{column, reference_values, MapStore, RelatedMaps, SaveRequest, SavedMapDocument};
use crate::sql::{attached, transaction};
use atlas_map::{MapRef, RealScale};
use std::{collections::BTreeSet, io};

/// A map's description rows, copied as they are.
const DESCRIPTION: [&str; 8] = [
    "map_spaces",
    "map_layers",
    "map_bands",
    "map_categories",
    "map_feature_types",
    "map_layer_properties",
    "map_registry_columns",
    "map_edits",
];

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
    /// The floors maps of buildings on a map (structure maps whose parent it is), in the
    /// catalog `schema` names (`main` or `imported`). They are kept with the map that holds
    /// the buildings, as region children are (ADR 0016).
    fn floors_of(&self, schema: &str, reference: &MapRef) -> io::Result<Vec<MapRef>> {
        let rows = self.db.query(&format!("SELECT m.map_id,m.revision FROM {schema}.maps m JOIN {schema}.map_heads h USING(map_id,revision) WHERE m.parent_map_id=? AND m.parent_revision=? AND json_extract(m.real_scale,'$.site.buildingId') IS NOT NULL ORDER BY m.map_id"), &reference_values(reference))?;
        rows.iter()
            .map(|row| {
                Ok(MapRef {
                    map_id: column(row, "map_id")?.id()?,
                    revision: column(row, "revision")?.id()?,
                })
            })
            .collect()
    }
    /// A saved map, its region children and the floors maps of the buildings on each.
    fn kept_with(&self, schema: &str, request: &SaveRequest) -> io::Result<Vec<MapRef>> {
        let mut kept = vec![request.reference.clone()];
        kept.extend(
            request
                .navigation
                .regions
                .iter()
                .filter_map(|region| region.child.clone()),
        );
        let mut floors = Vec::new();
        for reference in &kept {
            floors.extend(self.floors_of(schema, reference)?);
        }
        kept.extend(floors);
        Ok(kept)
    }
    pub fn save_references(&self, request: &SaveRequest) -> io::Result<Vec<MapRef>> {
        let mut pending = self.kept_with("main", request)?;
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        while let Some(reference) = pending.pop() {
            if !seen.insert((reference.map_id, reference.revision)) {
                continue;
            }
            if let Some(parent) = self.parent(&reference)? {
                if self.contains(&parent)? {
                    pending.push(parent);
                }
            }
            result.push(reference);
        }
        Ok(result)
    }
    /// A map's parent, from its revision row in the catalog `schema` names.
    fn parent_in(&self, schema: &str, reference: &MapRef) -> io::Result<Option<Option<MapRef>>> {
        let Some(row) = self
            .db
            .query(
                &format!("SELECT parent_map_id,parent_revision,complete FROM {schema}.maps WHERE map_id=? AND revision=?"),
                &reference_values(reference),
            )?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        if !column(&row, "complete")?.flag()? {
            return Err(io::Error::other("Complete the map before saving it"));
        }
        Ok(Some(
            match (
                column(&row, "parent_map_id")?.optional_id()?,
                column(&row, "parent_revision")?.optional_id()?,
            ) {
                (Some(map_id), Some(revision)) => Some(MapRef { map_id, revision }),
                _ => None,
            },
        ))
    }
    fn parent(&self, reference: &MapRef) -> io::Result<Option<MapRef>> {
        Ok(self.parent_in("main", reference)?.flatten())
    }
    pub fn copy_from(&self, source: &str, reference: &MapRef) -> io::Result<()> {
        attached(self.db.as_ref(), source, || {
            transaction(self.db.as_ref(), || {
                let mut seen = BTreeSet::new();
                self.copy_map(reference, &mut seen, false)?;
                if let Some(data) = self.db.value(
                    "SELECT data FROM imported.map_saved WHERE map_id=? AND revision=?",
                    &reference_values(reference),
                )? {
                    let saved: SavedMapDocument = crate::stored::VIEW.parse(data.text()?)?;
                    for region in saved.navigation.regions {
                        if let Some(child) = region.child {
                            self.copy_map(&child, &mut seen, false)?;
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
                for kept in self.kept_with("imported", &request)? {
                    self.copy_map(&kept, &mut seen, true)?;
                }
                self.save_inner(request, time)
            })
        })
    }
    pub fn related_with(&self, source: &str, reference: &MapRef) -> io::Result<RelatedMaps> {
        attached(self.db.as_ref(), source, || {
            let parent = self.parent(reference)?;
            let mut values = reference_values(reference);
            values.extend(reference_values(reference));
            let rows = self.db.query("SELECT m.map_id,m.revision FROM maps m JOIN map_heads h USING(map_id,revision) WHERE m.parent_map_id=? AND m.parent_revision=? UNION ALL SELECT m.map_id,m.revision FROM imported.maps m JOIN imported.map_heads h USING(map_id,revision) WHERE m.parent_map_id=? AND m.parent_revision=? AND NOT EXISTS(SELECT 1 FROM map_heads local WHERE local.map_id=m.map_id) ORDER BY map_id,revision", &values)?;
            let children = rows
                .iter()
                .map(|row| {
                    Ok(MapRef {
                        map_id: column(row, "map_id")?.id()?,
                        revision: column(row, "revision")?.id()?,
                    })
                })
                .collect::<io::Result<_>>()?;
            Ok(RelatedMaps { parent, children })
        })
    }
    fn copy_map(
        &self,
        reference: &MapRef,
        seen: &mut BTreeSet<(atlas_map::Id, atlas_map::Id)>,
        replace: bool,
    ) -> io::Result<()> {
        if !seen.insert((reference.map_id, reference.revision)) {
            return Ok(());
        }
        let values = reference_values(reference);
        let parent = self
            .parent_in("imported", reference)?
            .ok_or_else(|| io::Error::other("Saved map revision was not found"))?;
        if let Some(parent) = &parent {
            // Independent children remain usable after their parent is deleted.
            if self.parent_in("imported", parent)?.is_some() {
                self.copy_map(parent, seen, replace)?;
            }
        }
        if self.contains(reference)? {
            // An authored map keeps its revision, so saving replaces its saved copy with the
            // working one. Other revisions are immutable and copied once.
            return if replace {
                self.replace_authored(reference)
            } else {
                Ok(())
            };
        }
        self.db.execute(
            "INSERT INTO maps SELECT * FROM imported.maps WHERE map_id=? AND revision=?",
            &values,
        )?;
        self.db
            .execute("INSERT OR IGNORE INTO map_heads VALUES(?,?)", &values)?;
        for table in DESCRIPTION.iter().chain(&[
            "map_assets",
            "map_entities",
            "map_history",
            "map_history_features",
        ]) {
            self.db.execute(&format!("INSERT INTO {table} SELECT * FROM imported.{table} WHERE map_id=? AND revision=?"), &values)?;
        }
        self.db.execute(
            "INSERT INTO map_samples(map_id,revision,id,space_id,geometry,window_west,window_south,
             window_east,window_north,closed_east,closed_north,cell_span,center_x,center_y,center_z,
             measure,active,sections) SELECT map_id,revision,id,space_id,geometry,window_west,
             window_south,window_east,window_north,closed_east,closed_north,cell_span,center_x,
             center_y,center_z,measure,active,sections FROM imported.map_samples
             WHERE map_id=? AND revision=?",
            &values,
        )?;
        self.db.execute("INSERT INTO map_sample_bounds SELECT d.row_id,b.min_x,b.max_x,b.min_y,b.max_y FROM imported.map_samples s JOIN map_samples d ON d.map_id=s.map_id AND d.revision=s.revision AND d.id=s.id JOIN imported.map_sample_bounds b ON b.row_id=s.row_id WHERE s.map_id=? AND s.revision=?", &values)?;
        self.copy_features(&values)
    }
    /// Feature rows, their relations and bounds.
    fn copy_features(&self, values: &[crate::sql::Value]) -> io::Result<()> {
        self.db.execute("INSERT INTO map_features(map_id,revision,id,space_id,layer_id,type_id,kind,name,entity_id,origin,map_only,geometry,footprint,attributes,catalog,causes) SELECT map_id,revision,id,space_id,layer_id,type_id,kind,name,entity_id,origin,map_only,geometry,footprint,attributes,catalog,causes FROM imported.map_features WHERE map_id=? AND revision=?", values)?;
        self.db.execute(
            "INSERT INTO map_relations SELECT * FROM imported.map_relations WHERE map_id=? AND revision=?",
            values,
        )?;
        for bounds in ["map_feature_bounds", "map_footprint_bounds"] {
            self.db.execute(&format!("INSERT INTO {bounds} SELECT d.row_id,b.min_x,b.max_x,b.min_y,b.max_y FROM imported.map_features s JOIN map_features d ON d.map_id=s.map_id AND d.revision=s.revision AND d.id=s.id JOIN imported.{bounds} b ON b.row_id=s.row_id WHERE s.map_id=? AND s.revision=?"), values)?;
        }
        Ok(())
    }
    /// Replace this catalog's copy of an authored revision with the imported one: its
    /// description, features and undo steps. Samples, assets and history do not change.
    fn replace_authored(&self, reference: &MapRef) -> io::Result<()> {
        let values = reference_values(reference);
        let Some(settings) = self.db.value(
            "SELECT real_scale FROM imported.maps WHERE map_id=? AND revision=?",
            &values,
        )?
        else {
            return Ok(());
        };
        let real: Option<RealScale> = settings
            .optional_text()?
            .map(|text| serde_json::from_str(&text))
            .transpose()?;
        if !real.is_some_and(|real| real.authored()) || !self.contains(reference)? {
            return Ok(());
        }
        for table in [
            "map_features",
            "map_layers",
            "map_spaces",
            "map_registry_columns",
            "map_edits",
        ] {
            self.db.execute(
                &format!("DELETE FROM {table} WHERE map_id=? AND revision=?"),
                &values,
            )?;
        }
        let mut update = vec![settings];
        update.extend(values.iter().cloned());
        self.db.execute(
            "UPDATE maps SET real_scale=? WHERE map_id=? AND revision=?",
            &update,
        )?;
        for table in DESCRIPTION {
            self.db.execute(&format!("INSERT INTO {table} SELECT * FROM imported.{table} WHERE map_id=? AND revision=?"), &values)?;
        }
        self.copy_features(&values)
    }
}
