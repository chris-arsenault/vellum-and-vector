//! The PostGIS side of authoring. A LAN map is retained as soon as it is edited: the edit
//! rewrites the stored revision, which stays the map's head.
use super::{from_json, to_json, PostgresMaps};
use crate::authoring::{EditStore, EditWrite, StepWrite};
use atlas_map::{
    authoring::{EditRecord, EditStep},
    MapRef, PublicationBatch,
};
use std::io;

impl EditStore for PostgresMaps {
    fn edit_steps(&self, r: &MapRef) -> io::Result<Vec<EditStep>> {
        self.query(
            "SELECT sequence,label,undone FROM map.edits WHERE map_id=$1 AND revision=$2 ORDER BY sequence",
            &[&r.map_id, &r.revision],
        )?
        .iter()
        .map(|row| {
            Ok(EditStep {
                sequence: u32::try_from(row.try_get::<_, i32>("sequence").map_err(io::Error::other)?)
                    .map_err(io::Error::other)?,
                label: row.try_get("label").map_err(io::Error::other)?,
                undone: row.try_get("undone").map_err(io::Error::other)?,
            })
        })
        .collect()
    }
    fn edit_record(&self, r: &MapRef, sequence: u32) -> io::Result<EditRecord> {
        let sequence = i32::try_from(sequence).map_err(io::Error::other)?;
        let row = self
            .query(
                "SELECT data FROM map.edits WHERE map_id=$1 AND revision=$2 AND sequence=$3",
                &[&r.map_id, &r.revision, &sequence],
            )?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("That edit is not on this map"))?;
        from_json(row.try_get("data").map_err(io::Error::other)?)
    }
    fn write_edit(&self, write: EditWrite<'_>) -> io::Result<()> {
        let r = &write.map.reference;
        self.transaction(|| {
            self.lock(&r.map_id)?;
            self.execute(
                "DELETE FROM map.features WHERE map_id=$1 AND revision=$2 AND id=ANY($3::text[])",
                &[&r.map_id, &r.revision, &write.removed],
            )?;
            self.append_records(
                &super::records::Open::new(write.map.clone()),
                PublicationBatch {
                    features: write.features,
                    ..Default::default()
                },
            )?;
            self.execute(
                "UPDATE map.revisions SET descriptor=$3 WHERE map_id=$1 AND revision=$2",
                &[&r.map_id, &r.revision, &crate::stored::MAP.write(write.map)?],
            )?;
            match write.step {
                StepWrite::Append(record) => {
                    self.execute(
                        "DELETE FROM map.edits WHERE map_id=$1 AND revision=$2 AND undone",
                        &[&r.map_id, &r.revision],
                    )?;
                    self.execute(
                        "INSERT INTO map.edits SELECT $1,$2,coalesce(max(sequence),0)+1,$3,false,$4 FROM map.edits WHERE map_id=$1 AND revision=$2",
                        &[&r.map_id, &r.revision, &record.label, &to_json(record)?],
                    )?;
                }
                StepWrite::Mark { sequence, undone } => {
                    let sequence = i32::try_from(sequence).map_err(io::Error::other)?;
                    self.execute(
                        "UPDATE map.edits SET undone=$4 WHERE map_id=$1 AND revision=$2 AND sequence=$3",
                        &[&r.map_id, &r.revision, &sequence, &undone],
                    )?;
                }
            }
            Ok(())
        })
    }
}
impl PostgresMaps {
    pub fn edits(&self) -> &dyn EditStore {
        self
    }
}
