//! Detached sparse cargo follows the same donor as the complete retained material columns.
use super::{super::Field, sampling::write_range};
use crate::{
    rock::{cargo::MaterialCargo, columns::Column},
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Cargo {
    pub keys: Vec<String>,
    pub released_to: Vec<String>,
    pub slots: Vec<String>,
    offsets: Band<u32>,
    records: Band<f64>,
}
impl Cargo {
    pub(super) fn empty(coverage: &mut Coverage) -> Self {
        Self {
            keys: Vec::new(),
            released_to: Vec::new(),
            slots: Vec::new(),
            offsets: coverage.scratch(0, 0),
            records: coverage.scratch(0, 0.0),
        }
    }
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        archive.value("keys", &mut self.keys)?;
        archive.value("released-to", &mut self.released_to)?;
        archive.value("slots", &mut self.slots)?;
        archive.allocated_band("offsets", &mut self.offsets, coverage)?;
        archive.allocated_band("records", &mut self.records, coverage)
    }
    pub fn offsets(&self) -> ReadBand<u32> {
        self.offsets.read_only()
    }
    pub fn records(&self) -> ReadBand<f64> {
        self.records.read_only()
    }
}
pub fn capture(
    field: &Field,
    coverage: &mut Coverage,
    samples: &ReadBand<i32>,
) -> io::Result<Cargo> {
    let ground = field.ground();
    let mut offsets = coverage.scratch(samples.len() + 1, 0u32);
    let mut entries = Vec::new();
    for cell in 0..samples.len() {
        offsets.set(cell, record_count(&entries)?)?;
        let donor = usize::try_from(samples.get(cell)?)
            .map_err(|_| io::Error::other("Material capture requires a complete donor"))?;
        let mut slot = 0;
        for column in Column::ALL {
            for layer in 0..column.size() {
                if ground.columns().depth(donor, column, layer)? > 0.0 {
                    append(
                        &mut entries,
                        slot,
                        ground
                            .columns()
                            .read_layer(donor, column, layer)?
                            .cargo
                            .as_ref(),
                    )?;
                }
                slot += 1;
            }
        }
        append(
            &mut entries,
            slot,
            field.ground_load.get(donor)?.cargo.as_ref(),
        )?;
        append(
            &mut entries,
            slot + 1,
            field.sea_load.get(donor)?.cargo.as_ref(),
        )?;
    }
    offsets.set(samples.len(), record_count(&entries)?)?;
    let mut records = coverage.scratch(entries.len(), 0.0);
    write_range(&mut records, 0, &entries)?;
    offsets.retain();
    records.retain();
    let mut slots = Vec::new();
    for (column, name) in Column::ALL
        .into_iter()
        .zip(["land", "cut", "loose", "cutLoose"])
    {
        for layer in 0..column.size() {
            slots.push(format!("{name}:{layer}"));
        }
    }
    slots.extend(["ground-load".into(), "sea-load".into()]);
    Ok(Cargo {
        keys: ground.cargo_identities().names().to_vec(),
        released_to: ground
            .cargo_identities()
            .release_names()
            .map(str::to_owned)
            .collect(),
        slots,
        offsets,
        records,
    })
}
fn record_count(entries: &[f64]) -> io::Result<u32> {
    u32::try_from(entries.len() / 4)
        .map_err(|_| io::Error::other("Material cargo exceeds offset representation"))
}
fn append(entries: &mut Vec<f64>, slot: usize, cargo: Option<&MaterialCargo>) -> io::Result<()> {
    if let Some(cargo) = cargo {
        for (key, host, density) in cargo.entries() {
            if key <= 0 || host < 0 || !density.is_finite() || density <= 0.0 {
                return Err(io::Error::other(
                    "Cargo requires a named reservoir, constituent and positive density",
                ));
            }
            entries.extend([slot as f64, f64::from(key), f64::from(host), density]);
        }
    }
    Ok(())
}
