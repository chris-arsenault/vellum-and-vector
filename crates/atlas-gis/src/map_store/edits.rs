//! The SQLite side of authoring: undo steps and the one-transaction rewrite of an edited
//! revision. The browser's working catalog holds edits until **Save map** copies them.
use super::{column, queries::placeholders, reference_values, MapStore};
use crate::authoring::{EditStore, EditWrite, StepWrite};
use crate::sql::{transaction, Value};
use atlas_map::{authoring::EditRecord, authoring::EditStep, MapRef};
use std::io;

impl EditStore for MapStore {
    fn edit_steps(&self, reference: &MapRef) -> io::Result<Vec<EditStep>> {
        self.db
            .query(
                "SELECT sequence,label,undone FROM map_edits WHERE map_id=? AND revision=? ORDER BY sequence",
                &reference_values(reference),
            )?
            .iter()
            .map(|row| {
                Ok(EditStep {
                    sequence: u32::try_from(column(row, "sequence")?.integer()?)
                        .map_err(io::Error::other)?,
                    label: column(row, "label")?.text()?.into(),
                    undone: column(row, "undone")?.integer()? != 0,
                })
            })
            .collect()
    }
    fn edit_record(&self, reference: &MapRef, sequence: u32) -> io::Result<EditRecord> {
        let mut values = reference_values(reference);
        values.push(i64::from(sequence).into());
        let data = self
            .db
            .value(
                "SELECT data FROM map_edits WHERE map_id=? AND revision=? AND sequence=?",
                &values,
            )?
            .ok_or_else(|| io::Error::other("That edit is not on this map"))?;
        super::codec::decode(data.bytes()?)
    }
    fn write_edit(&self, write: EditWrite<'_>) -> io::Result<()> {
        let reference = &write.map.reference;
        transaction(self.db.as_ref(), || {
            for ids in write.removed.chunks(256) {
                let mut values = reference_values(reference);
                values.extend(ids.iter().copied().map(Value::from));
                self.db.execute(
                    &format!(
                        "DELETE FROM map_features WHERE map_id=? AND revision=? AND id IN ({})",
                        placeholders(ids.len())
                    ),
                    &values,
                )?;
            }
            self.replace_description(write.map)?;
            for feature in write.features {
                self.write_feature(write.map, feature)?;
            }
            self.write_step(reference, write.step)
        })
    }
}
impl MapStore {
    fn write_step(&self, reference: &MapRef, step: StepWrite<'_>) -> io::Result<()> {
        let values = reference_values(reference);
        match step {
            StepWrite::Append(record) => {
                self.db.execute(
                    "DELETE FROM map_edits WHERE map_id=? AND revision=? AND undone=1",
                    &values,
                )?;
                let next = self
                    .db
                    .value(
                        "SELECT coalesce(max(sequence),0)+1 FROM map_edits WHERE map_id=? AND revision=?",
                        &values,
                    )?
                    .ok_or_else(|| io::Error::other("Missing edit sequence"))?
                    .integer()?;
                let mut row = values;
                row.extend([
                    next.into(),
                    record.label.clone().into(),
                    0i64.into(),
                    Value::Blob(super::codec::encode(record)?),
                ]);
                self.db
                    .execute("INSERT INTO map_edits VALUES(?,?,?,?,?,?)", &row)?;
            }
            StepWrite::Mark { sequence, undone } => {
                let mut row = vec![i64::from(undone).into()];
                row.extend(values);
                row.push(i64::from(sequence).into());
                self.db.execute(
                    "UPDATE map_edits SET undone=? WHERE map_id=? AND revision=? AND sequence=?",
                    &row,
                )?;
            }
        }
        Ok(())
    }
    pub fn edits(&self) -> &dyn EditStore {
        self
    }
}
