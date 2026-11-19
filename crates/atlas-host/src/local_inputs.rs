//! Browser-local completed inputs. This database is separate from the finished-map catalog.
mod inventory;
// Arconis: docs/architecture/subsystems.arconis#item=j_bw_inputs — browser inputs.sqlite holding captured private inputs.
use crate::{generation_document::Document, numerical_resource::Scope, record_store::Retained};
use atlas_generation::features::{
    network::{NetworkReader, NetworkWorkspace, Selection},
    FeatureReader, FeatureSelection, FeatureWorkspace,
};
use atlas_gis::map_store::codec;
use atlas_gis::sql::{self, column, Database};
use atlas_map::MapRef;
use serde_json::Value;
use std::{io, rc::Rc};

#[derive(Clone)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub struct LocalInputs {
    db: Rc<Database>,
}
impl LocalInputs {
    pub fn contains(&self, reference: &MapRef) -> io::Result<bool> {
        Ok(self
            .db
            .value(
                "SELECT 1 FROM generation_catalogs WHERE map_id=? AND revision=?",
                &[reference.map_id.into(), reference.revision.into()],
            )?
            .is_some())
    }
    pub fn copy_from(&self, source: &str, references: &[MapRef]) -> io::Result<()> {
        sql::attached(self.db.as_ref(), source, || {
            sql::transaction(self.db.as_ref(), || {
                for reference in references {
                    let values = [reference.map_id.into(), reference.revision.into()];
                    let Some(data) = self.db.value("SELECT document FROM imported.generation_catalogs WHERE map_id=? AND revision=?", &values)? else { continue; };
                    let document: Document =
                        crate::generation_document::FORMAT.parse(data.text()?)?;
                    self.db.execute("INSERT OR IGNORE INTO generation_catalogs SELECT * FROM imported.generation_catalogs WHERE map_id=? AND revision=?", &values)?;
                    // Only a record already held is skipped; a record of an older stored
                    // shape fails its check rather than vanishing.
                    self.db.execute("INSERT INTO generation_records SELECT * FROM imported.generation_records WHERE map_id=? AND revision=? ON CONFLICT DO NOTHING", &values)?;
                    for field in document.world["fields"].as_array().into_iter().flatten() {
                        let area: atlas_map::Id =
                            serde_json::from_value(field["areaId"].clone())
                                .map_err(|_| io::Error::other("A completed field has an area"))?;
                        self.db.execute("INSERT OR IGNORE INTO generation_geography SELECT * FROM imported.generation_geography WHERE world_id=? AND area_id=?", &[document.scope.located.world_id.into(), area.into()])?;
                    }
                }
                Ok(())
            })
        })
    }
    pub fn open(db: Rc<Database>) -> io::Result<Self> {
        db.batch(include_str!("local_inputs.sql"))?;
        // Records kept by an older version name their kind as text and hold JSON; they are
        // not readable here, and generating from them would silently start with none.
        if db
            .value(
                "SELECT 1 FROM generation_records WHERE typeof(kind)<>'integer' LIMIT 1",
                &[],
            )?
            .is_some()
        {
            return Err(io::Error::other(
                "These saved generation inputs were made by an older version and cannot be read",
            ));
        }
        Ok(Self { db })
    }
    pub fn document(&self, reference: &MapRef) -> io::Result<Document> {
        let value = self
            .db
            .value(
                "SELECT document FROM generation_catalogs WHERE map_id=? AND revision=?",
                &[reference.map_id.into(), reference.revision.into()],
            )?
            .ok_or_else(|| io::Error::other("This map revision has no completed inputs"))?;
        crate::generation_document::FORMAT.parse(value.text()?)
    }
    pub fn store(
        &self,
        reference: &MapRef,
        document: &Document,
        features: &dyn FeatureReader,
        networks: &dyn NetworkReader,
        geography: &[Value],
    ) -> io::Result<()> {
        if reference.map_id != document.scope.located.area_id {
            return Err(io::Error::other(
                "Retain completed inputs for their own map",
            ));
        }
        if self.contains(reference)? {
            return Ok(());
        }
        sql::transaction(self.db.as_ref(), || {
            self.db.execute(
                "INSERT INTO generation_catalogs VALUES(?,?,?)",
                &[
                    reference.map_id.into(),
                    reference.revision.into(),
                    crate::generation_document::FORMAT.text(document)?.into(),
                ],
            )?;
            for feature in features.values(FeatureSelection::default())? {
                let feature = feature?;
                self.record(reference, Retained::Feature, feature.id, &feature)?;
            }
            for node in networks.nodes()? {
                let node = node?;
                self.record(reference, Retained::Node, node.id, &node)?;
            }
            for reach in networks.reaches(Selection::default())? {
                let reach = reach?;
                self.record(reference, Retained::Reach, reach.id, &reach)?;
            }
            for value in geography {
                let scope: Scope = serde_json::from_value(value["scope"].clone())?;
                let id = value["id"]
                    .as_str()
                    .ok_or_else(|| io::Error::other("Field geography has an identity"))?;
                self.db.execute(
                    "INSERT INTO generation_geography VALUES(?,?,?,?)",
                    &[
                        scope.world_id.into(),
                        scope.area_id.into(),
                        id.into(),
                        serde_json::to_string(value)?.into(),
                    ],
                )?;
            }
            Ok(())
        })
    }
    fn record(
        &self,
        r: &MapRef,
        kind: Retained,
        id: atlas_map::Id,
        data: &impl serde::Serialize,
    ) -> io::Result<()> {
        self.db.execute(
            "INSERT INTO generation_records VALUES(?,?,?,?,?)",
            &[
                r.map_id.into(),
                r.revision.into(),
                (kind as i64).into(),
                id.into(),
                sql::Value::Blob(codec::encode(data)?),
            ],
        )?;
        Ok(())
    }
    pub fn load_records(
        &self,
        r: &MapRef,
        features: &mut dyn FeatureWorkspace,
        networks: &mut dyn NetworkWorkspace,
    ) -> io::Result<()> {
        self.document(r)?;
        for kind in [Retained::Feature, Retained::Node, Retained::Reach] {
            let mut after = atlas_map::Id::NIL;
            loop {
                let rows = self.db.query(
                    "SELECT id,data FROM generation_records WHERE map_id=? AND revision=?
                     AND kind=? AND id>? ORDER BY id LIMIT 128",
                    &[
                        r.map_id.into(),
                        r.revision.into(),
                        (kind as i64).into(),
                        after.into(),
                    ],
                )?;
                if rows.is_empty() {
                    break;
                }
                for row in rows {
                    after = column(&row, "id")?.id()?;
                    let data = column(&row, "data")?.bytes()?;
                    match kind {
                        Retained::Feature => features.put(codec::decode(data)?)?,
                        Retained::Node => networks.put_node(codec::decode(data)?)?,
                        Retained::Reach => networks.put_reach(codec::decode(data)?)?,
                    }
                }
            }
        }
        Ok(())
    }
    pub fn geography(&self, scope: &Scope, id: &str) -> io::Result<Value> {
        let data = self
            .db
            .value(
                "SELECT data FROM generation_geography WHERE world_id=? AND area_id=? AND id=?",
                &[scope.world_id.into(), scope.area_id.into(), id.into()],
            )?
            .ok_or_else(|| io::Error::other("Completed field geography is missing"))?;
        Ok(serde_json::from_str(data.text()?)?)
    }
    pub fn unbind(&self, r: &MapRef) -> io::Result<()> {
        sql::transaction(self.db.as_ref(), || {
            let values = [r.map_id.into(), r.revision.into()];
            self.db.execute(
                "DELETE FROM generation_records WHERE map_id=? AND revision=?",
                &values,
            )?;
            self.db.execute(
                "DELETE FROM generation_catalogs WHERE map_id=? AND revision=?",
                &values,
            )?;
            Ok(())
        })
    }
}
