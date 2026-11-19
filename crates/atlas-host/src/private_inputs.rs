//! Completed generation captures. This capability is never supplied to map readers.
mod documents;
mod inventory;
use atlas_map::{Id, MapRef};
use postgres::{Client, NoTls};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, io};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedInputs {
    pub reference: MapRef,
    pub world_id: atlas_map::Id,
    pub area_id: atlas_map::Id,
    pub revision: u64,
    pub catalog_id: String,
}
// Arconis: docs/architecture/subsystems.arconis#item=numerical — captured inputs in the private generation schema.
pub struct PrivateInputs {
    db: RefCell<Client>,
}
pub struct CaptureInputs<'a> {
    pub resources: &'a crate::native_resources::NativeResources,
    pub private: &'a PrivateInputs,
}
impl crate::regional_capture::Source for CaptureInputs<'_> {
    fn resource(&self, id: &str) -> io::Result<serde_json::Value> {
        Ok(serde_json::from_slice(&std::fs::read(
            self.resources.directory(id)?.join("resource.json"),
        )?)?)
    }
    fn geography(
        &self,
        scope: &crate::numerical_resource::Scope,
        id: &str,
    ) -> io::Result<serde_json::Value> {
        self.private.geography(scope, id)
    }
}
impl PrivateInputs {
    pub fn connect(url: &str) -> io::Result<Self> {
        Ok(Self {
            db: RefCell::new(Client::connect(url, NoTls).map_err(io::Error::other)?),
        })
    }
    pub fn initialize(&self) -> io::Result<()> {
        self.db
            .borrow_mut()
            .batch_execute(include_str!("private_inputs.sql"))
            .map_err(io::Error::other)
    }
    pub fn bind(&self, input: &CompletedInputs) -> io::Result<()> {
        self.db
            .borrow_mut()
            .execute(
                "INSERT INTO generation.inputs VALUES($1,$2,$3,$4,$5,$6)",
                &[
                    &uuid(input.reference.map_id),
                    &uuid(input.reference.revision),
                    &uuid(input.world_id),
                    &uuid(input.area_id),
                    &i64::try_from(input.revision).map_err(io::Error::other)?,
                    &input.catalog_id,
                ],
            )
            .map_err(io::Error::other)?;
        Ok(())
    }
    pub fn read(&self, reference: &MapRef) -> io::Result<CompletedInputs> {
        let row = self
            .db
            .borrow_mut()
            .query_opt(
                "SELECT * FROM generation.inputs WHERE map_id=$1 AND map_revision=$2",
                &[&uuid(reference.map_id), &uuid(reference.revision)],
            )
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("This map revision has no completed inputs"))?;
        Ok(CompletedInputs {
            reference: reference.clone(),
            world_id: id(row.try_get("world_id").map_err(io::Error::other)?),
            area_id: id(row.try_get("area_id").map_err(io::Error::other)?),
            revision: u64::try_from(
                row.try_get::<_, i64>("revision")
                    .map_err(io::Error::other)?,
            )
            .map_err(io::Error::other)?,
            catalog_id: row.try_get("catalog_id").map_err(io::Error::other)?,
        })
    }
    pub fn at_version(&self, world_id: Id, area_id: Id, revision: u64) -> io::Result<MapRef> {
        let row=self.db.borrow_mut().query_opt("SELECT map_id,map_revision FROM generation.inputs WHERE world_id=$1 AND area_id=$2 AND revision<=$3 ORDER BY revision DESC,map_revision DESC LIMIT 1",&[&uuid(world_id),&uuid(area_id),&i64::try_from(revision).map_err(io::Error::other)?]).map_err(io::Error::other)?.ok_or_else(||io::Error::other("The parent has no completed map at this revision"))?;
        Ok(MapRef {
            map_id: id(row.try_get("map_id").map_err(io::Error::other)?),
            revision: id(row.try_get("map_revision").map_err(io::Error::other)?),
        })
    }
    pub fn unbind(&self, r: &MapRef) -> io::Result<()> {
        self.db
            .borrow_mut()
            .execute(
                "DELETE FROM generation.inputs WHERE map_id=$1 AND map_revision=$2",
                &[&uuid(r.map_id), &uuid(r.revision)],
            )
            .map_err(io::Error::other)?;
        Ok(())
    }
}
/// An identity as PostgreSQL's `uuid`.
pub(crate) fn uuid(value: Id) -> uuid::Uuid {
    uuid::Uuid::from_bytes(value.to_bytes())
}
pub(crate) fn id(value: uuid::Uuid) -> Id {
    Id::from_bytes(value.into_bytes())
}
