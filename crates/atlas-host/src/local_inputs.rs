//! Browser-local completed inputs. This database is separate from the finished-map catalog.
// Arconis: docs/architecture/subsystems.arconis#item=j_bw_inputs — browser inputs.sqlite holding captured private inputs.
use crate::{generation_document::Document, numerical_resource::Scope};
use atlas_generation::features::{
    network::{NetworkReader, NetworkWorkspace, Selection},
    FeatureReader, FeatureSelection, FeatureWorkspace,
};
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
                &[
                    reference.map_id.as_str().into(),
                    reference.revision.as_str().into(),
                ],
            )?
            .is_some())
    }
    pub fn copy_from(&self, source: &str, references: &[MapRef]) -> io::Result<()> {
        sql::attached(self.db.as_ref(), source, || {
            sql::transaction(self.db.as_ref(), || {
                for reference in references {
                    let values = [
                        reference.map_id.as_str().into(),
                        reference.revision.as_str().into(),
                    ];
                    let Some(data) = self.db.value("SELECT document FROM imported.generation_catalogs WHERE map_id=? AND revision=?", &values)? else { continue; };
                    let document: Document = serde_json::from_str(data.text()?)?;
                    self.db.execute("INSERT OR IGNORE INTO generation_catalogs SELECT * FROM imported.generation_catalogs WHERE map_id=? AND revision=?", &values)?;
                    self.db.execute("INSERT OR IGNORE INTO generation_records SELECT * FROM imported.generation_records WHERE map_id=? AND revision=?", &values)?;
                    for field in document.world["fields"].as_array().into_iter().flatten() {
                        let area = field["areaId"]
                            .as_str()
                            .ok_or_else(|| io::Error::other("A completed field has an area"))?;
                        self.db.execute("INSERT OR IGNORE INTO generation_geography SELECT * FROM imported.generation_geography WHERE world_id=? AND area_id=?", &[document.scope.located.world_id.as_str().into(), area.into()])?;
                    }
                }
                Ok(())
            })
        })
    }
    pub fn open(db: Rc<Database>) -> io::Result<Self> {
        db.batch(include_str!("local_inputs.sql"))?;
        Ok(Self { db })
    }
    pub fn document(&self, reference: &MapRef) -> io::Result<Document> {
        let value = self
            .db
            .value(
                "SELECT document FROM generation_catalogs WHERE map_id=? AND revision=?",
                &[
                    reference.map_id.as_str().into(),
                    reference.revision.as_str().into(),
                ],
            )?
            .ok_or_else(|| io::Error::other("This map revision has no completed inputs"))?;
        Ok(serde_json::from_str(value.text()?)?)
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
        sql::transaction(self.db.as_ref(), || {
            self.db.execute(
                "INSERT INTO generation_catalogs VALUES(?,?,?)",
                &[
                    reference.map_id.as_str().into(),
                    reference.revision.as_str().into(),
                    serde_json::to_string(document)?.into(),
                ],
            )?;
            for feature in features.values(FeatureSelection::default())? {
                let feature = feature?;
                self.record(reference, "feature", &feature.id, &feature)?;
            }
            for node in networks.nodes()? {
                let node = node?;
                self.record(reference, "node", &node.id, &node)?;
            }
            for reach in networks.reaches(Selection::default())? {
                let reach = reach?;
                self.record(reference, "reach", &reach.id, &reach)?;
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
        kind: &str,
        id: &str,
        data: &impl serde::Serialize,
    ) -> io::Result<()> {
        self.db.execute(
            "INSERT INTO generation_records VALUES(?,?,?,?,?)",
            &[
                r.map_id.as_str().into(),
                r.revision.as_str().into(),
                kind.into(),
                id.into(),
                serde_json::to_string(data)?.into(),
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
        for kind in ["feature", "node", "reach"] {
            let mut after = String::new();
            loop {
                let rows=self.db.query("SELECT id,data FROM generation_records WHERE map_id=? AND revision=? AND kind=? AND id>? ORDER BY id LIMIT 128",&[r.map_id.as_str().into(),r.revision.as_str().into(),kind.into(),after.as_str().into()])?;
                if rows.is_empty() {
                    break;
                }
                for row in rows {
                    after = column(&row, "id")?.text()?.into();
                    let data = column(&row, "data")?.text()?;
                    match kind {
                        "feature" => features.put(serde_json::from_str(data)?)?,
                        "node" => networks.put_node(serde_json::from_str(data)?)?,
                        _ => networks.put_reach(serde_json::from_str(data)?)?,
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
                &[
                    scope.world_id.as_str().into(),
                    scope.area_id.as_str().into(),
                    id.into(),
                ],
            )?
            .ok_or_else(|| io::Error::other("Completed field geography is missing"))?;
        Ok(serde_json::from_str(data.text()?)?)
    }
    pub fn unbind(&self, r: &MapRef) -> io::Result<()> {
        sql::transaction(self.db.as_ref(), || {
            let values = [r.map_id.as_str().into(), r.revision.as_str().into()];
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
