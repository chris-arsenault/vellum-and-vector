//! Streaming owner state at completed schedule boundaries. Hosts own durable replacement.
use crate::storage::{Band, Coverage, Sample};
use serde::{de::DeserializeOwned, Serialize};
use std::io::{self, Read, Write};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Point {
    WorldFormation,
    PhysicalEpoch { epoch: String },
    HumanEra { era: String },
    RegionalDetail,
    RegionalRound { round: usize },
    Publication,
}
impl Point {
    pub fn label(&self) -> String {
        match self {
            Self::WorldFormation => "World formation complete".into(),
            Self::PhysicalEpoch { epoch } => format!("Physical epoch {epoch} complete"),
            Self::HumanEra { era } => format!("Human era {era} complete"),
            Self::RegionalDetail => "Initial regional detail complete".into(),
            Self::RegionalRound { round } => format!("Regional development round {round} complete"),
            Self::Publication => "Generation complete; publication remaining".into(),
        }
    }
}

/// One private host-owned file. The host commits replacement only after `write` succeeds.
pub trait Recovery {
    fn open(&mut self) -> io::Result<Option<Box<dyn Read>>>;
    fn replace(
        &mut self,
        point: &Point,
        write: &mut dyn FnMut(&mut dyn Write) -> io::Result<()>,
    ) -> io::Result<()>;
}

pub enum Archive<'a> {
    Save(&'a mut dyn Write),
    Load(&'a mut dyn Read),
}
impl Archive<'_> {
    /// Try the current owner readers across format revisions; required meaning still matches.
    pub fn format(&mut self, semantics: &str, revision: u32) -> io::Result<()> {
        match self {
            Self::Save(writer) => ciborium::into_writer(&format!("{semantics}:{revision}"), writer)
                .map_err(io::Error::other),
            Self::Load(reader) => {
                let stored: String = ciborium::from_reader(reader).map_err(io::Error::other)?;
                if stored.rsplit_once(':').is_some_and(|(kind, revision)| {
                    kind == semantics && revision.parse::<u32>().is_ok()
                }) {
                    Ok(())
                } else {
                    Err(io::Error::other("Incompatible checkpoint meaning"))
                }
            }
        }
    }
    pub fn loading(&self) -> bool {
        matches!(self, Self::Load(_))
    }

    pub fn value<T: Serialize + DeserializeOwned>(
        &mut self,
        name: &str,
        value: &mut T,
    ) -> io::Result<()> {
        self.label(name)?;
        match self {
            Self::Save(writer) => ciborium::into_writer(value, writer).map_err(io::Error::other),
            Self::Load(reader) => {
                *value = ciborium::from_reader(reader).map_err(io::Error::other)?;
                Ok(())
            }
        }
    }

    pub fn band<T: Sample>(&mut self, name: &str, band: &mut Band<T>) -> io::Result<()> {
        self.label(name)?;
        self.label(std::any::type_name::<T>())?;
        let mut length = band.len();
        self.value("length", &mut length)?;
        if length != band.len() {
            return Err(io::Error::other(format!(
                "Checkpoint band {name} has a different shape"
            )));
        }
        for index in 0..length.div_ceil(crate::lattice::BLOCK_CELLS) {
            match self {
                Self::Save(writer) => {
                    writer.write_all(bytemuck::cast_slice(&band.read_only().read_block(index)?))?
                }
                Self::Load(reader) => {
                    reader.read_exact(bytemuck::cast_slice_mut(&mut band.write_block(index)?))?
                }
            }
        }
        Ok(())
    }

    pub fn optional_band<T: Sample>(
        &mut self,
        name: &str,
        band: &mut Option<Band<T>>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let mut length = band.as_ref().map(Band::len);
        self.value(name, &mut length)?;
        if self.loading() {
            *band = length.map(|length| {
                let mut band = coverage.scratch(length, T::default());
                band.retain();
                band
            });
        }
        if let Some(band) = band {
            self.band(name, band)?;
        }
        Ok(())
    }

    pub fn bands<T: Sample>(&mut self, name: &str, bands: &mut [Band<T>]) -> io::Result<()> {
        self.label(name)?;
        for (index, band) in bands.iter_mut().enumerate() {
            self.band(&index.to_string(), band)?;
        }
        Ok(())
    }

    pub fn allocated_band<T: Sample>(
        &mut self,
        name: &str,
        band: &mut Band<T>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let mut length = band.len();
        self.value(name, &mut length)?;
        if self.loading() {
            *band = coverage.scratch(length, T::default());
            band.retain();
        }
        self.band(name, band)
    }

    pub fn read_band<T: Sample>(
        &mut self,
        name: &str,
        band: &mut crate::storage::ReadBand<T>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        self.label(name)?;
        self.label(std::any::type_name::<T>())?;
        let mut length = band.len();
        self.value("length", &mut length)?;
        match self {
            Self::Save(writer) => {
                for index in 0..length.div_ceil(crate::lattice::BLOCK_CELLS) {
                    writer.write_all(bytemuck::cast_slice(&band.read_block(index)?))?;
                }
            }
            Self::Load(reader) => {
                let mut restored = coverage.scratch(length, T::default());
                restored.retain();
                for index in 0..length.div_ceil(crate::lattice::BLOCK_CELLS) {
                    reader
                        .read_exact(bytemuck::cast_slice_mut(&mut restored.write_block(index)?))?;
                }
                *band = restored.read_only();
            }
        }
        Ok(())
    }

    pub fn optional_read<T: Sample>(
        &mut self,
        name: &str,
        band: &mut Option<crate::storage::ReadBand<T>>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let mut present = band.is_some();
        self.value(name, &mut present)?;
        if self.loading() {
            *band = present.then(|| coverage.scratch(0, T::default()).read_only());
        }
        if let Some(band) = band {
            self.read_band(name, band, coverage)?;
        }
        Ok(())
    }

    pub fn label(&mut self, expected: &str) -> io::Result<()> {
        match self {
            Self::Save(writer) => ciborium::into_writer(expected, writer).map_err(io::Error::other),
            Self::Load(reader) => {
                let found: String = ciborium::from_reader(reader).map_err(io::Error::other)?;
                if found != expected {
                    return Err(io::Error::other(format!(
                        "Incompatible checkpoint: expected {expected}, found {found}"
                    )));
                }
                Ok(())
            }
        }
    }
}
