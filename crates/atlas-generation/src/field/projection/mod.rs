//! Private generation surface projection. Finished-map readers never receive these bands.
pub mod cargo;
pub mod channels;
mod checkpoint;
pub mod local_magic;
mod local_material;
mod magic;
mod material;
mod protection;
pub mod sampling;
pub mod support;
pub mod values;

use super::{schema::NumericBand, shared::Scalar as S, Field};
use crate::{
    reconstruction::Grid,
    storage::{Coverage, SharedCache},
};
use channels::{Channel, Quantity};
use sampling::Interpolation;
use std::{
    // hpc-exempt: channel-name metadata, never cell-indexed numerical storage.
    collections::{BTreeMap, BTreeSet},
    io,
};
use values::Values;

pub struct ProjectedChannel {
    pub unit: String,
    pub quantity: Quantity,
    values: Values,
}
impl ProjectedChannel {
    pub fn values(&self) -> NumericBand {
        self.values.read()
    }
}
pub struct Surface {
    grid: Grid,
    interpolation: Interpolation,
    // hpc-exempt: channel catalogue metadata; numerical samples live in typed bands.
    channels: BTreeMap<String, ProjectedChannel>,
    cargo: Option<cargo::Cargo>,
    support: Option<support::Support>,
    coverage: Coverage,
    active: crate::storage::Band<u8>,
    input: Option<std::rc::Rc<crate::field::inheritance::resources::Resource>>,
}
pub struct Selection<'a> {
    pub forcing_only: bool,
    pub physical: &'a [Channel],
    // hpc-exempt: selected publication channel names.
    pub derived: Option<&'a BTreeSet<String>>,
}
impl Surface {
    pub fn support(&self) -> Option<support::ReadSupport> {
        self.support.as_ref().map(support::Support::read)
    }
    pub(crate) fn begin_process(&self) -> u64 {
        self.coverage.begin_process()
    }
    pub(crate) fn release_process(&mut self, start: u64) {
        self.coverage.release_process(start);
    }
    pub fn captured(
        resource: std::rc::Rc<crate::field::inheritance::resources::Resource>,
        field: &Field,
        cache: SharedCache,
    ) -> io::Result<Self> {
        let mut surface = Self::new((*resource.grid).clone(), field, cache)?;
        surface.import(&resource)?;
        surface.input = Some(resource);
        Ok(surface)
    }
    pub fn active(&self) -> crate::storage::ReadBand<u8> {
        self.active.read_only()
    }
    pub fn import(
        &mut self,
        resource: &crate::field::inheritance::resources::Resource,
    ) -> io::Result<()> {
        if resource.active.len() != self.coverage.len() {
            return Err(io::Error::other("Surface mask differs from its grid"));
        }
        for cell in 0..self.coverage.len() {
            self.active.set(cell, resource.active.get(cell)?)?;
        }
        for (name, channel) in &resource.channels {
            if channel.values.len() != self.coverage.len() {
                return Err(io::Error::other(
                    "Captured surface channel length differs from its grid",
                ));
            }
            let mut values = Values::like(&channel.values, &mut self.coverage);
            for start in (0..channel.values.len()).step_by(4096) {
                let end = (start + 4096).min(channel.values.len());
                let block = (start..end)
                    .map(|i| channel.values.get(i))
                    .collect::<io::Result<Vec<_>>>()?;
                values.write(start, &block)?;
            }
            self.channels.insert(
                name.clone(),
                ProjectedChannel {
                    unit: channel.unit.clone(),
                    quantity: channel.quantity,
                    values,
                },
            );
        }
        Ok(())
    }
    /// Population and identity distributions use the captured cell of each map sample.
    pub fn sample_channel(
        &mut self,
        name: &str,
        unit: &'static str,
        read: impl Fn(usize) -> io::Result<f64>,
    ) -> io::Result<()> {
        let samples = self.interpolation.samples();
        let mut values = self.coverage.allocate(0.0);
        for sample in 0..samples.len() {
            let cell = samples.get(sample)?;
            if cell >= 0 {
                values.set(sample, read(cell as usize)?)?;
            }
        }
        self.put(name, unit, Quantity::Intensive, Values::F64(values));
        Ok(())
    }
    pub fn new(mut grid: Grid, field: &Field, cache: SharedCache) -> io::Result<Self> {
        let mut coverage = Coverage::samples(grid.measures.len(), cache);
        let origin = field.mesh.origin();
        let interpolation = Interpolation::new(
            field.mesh(),
            coverage.len(),
            |i| {
                let p = grid.position(i)?;
                Ok([p[0] - origin[0], p[1] - origin[1]])
            },
            &mut coverage,
        )?;
        grid.periodic_width = field.mesh.coordinate_width();
        let active = coverage.allocate(1u8);
        Ok(Self {
            grid,
            interpolation,
            // hpc-exempt: one entry per channel schema.
            channels: BTreeMap::new(),
            cargo: None,
            support: None,
            coverage,
            active,
            input: None,
        })
    }
    pub fn grid(&self) -> &Grid {
        &self.grid
    }
    // hpc-exempt: read-only channel catalogue; each value owns a typed band.
    pub fn channels(&self) -> &BTreeMap<String, ProjectedChannel> {
        &self.channels
    }
    pub fn cargo(&self) -> Option<&cargo::Cargo> {
        self.cargo.as_ref()
    }
    pub fn samples(&self) -> crate::storage::ReadBand<i32> {
        self.interpolation.samples()
    }
    /// Refresh the human layers selected for inheritance after the settled eras.
    pub fn project_people(&mut self, field: &Field) -> io::Result<()> {
        let bands = field.bands();
        for channel in channels::humans() {
            if self.channels.contains_key(&channel.name) {
                let source = bands
                    .iter()
                    .find(|band| band.name == channel.name)
                    .ok_or_else(|| {
                        io::Error::other(format!("Missing human layer {}", channel.name))
                    })?;
                self.physical(field, &source.values, &channel)?;
            }
        }
        Ok(())
    }
    pub fn project(&mut self, field: &Field, selection: Selection<'_>) -> io::Result<()> {
        let bands = field.bands();
        for channel in selection.physical {
            if selection.forcing_only
                && ![
                    "Elevation",
                    "BedrockElevation",
                    "SedimentThickness",
                    "FractureConductance",
                    "RockResistance",
                    "WaterKindCodes",
                    "Temperature",
                ]
                .contains(&channel.name.as_str())
            {
                continue;
            }
            let source = bands
                .iter()
                .find(|band| band.name == channel.name)
                .ok_or_else(|| {
                    io::Error::other(format!("Physical projection is missing {}", channel.name))
                })?;
            self.physical(field, &source.values, channel)?;
        }
        let selected = if selection.forcing_only {
            None
        } else {
            selection.derived
        };
        for (name, level) in [
            ("BaseSeaLevel", field.water().base_sea_level),
            ("EffectiveSeaLevel", field.ground().effective_sea_level()),
        ] {
            if selected.is_none_or(|names| names.contains(name)) {
                let values = Values::F64(self.coverage.allocate(level));
                self.put(name, "native-length", Quantity::Intensive, values);
            }
        }
        if selection.forcing_only {
            for (from, to, unit) in [
                ("Temperature", "NaturalTemperature", "native-temperature"),
                ("RockResistance", "NaturalRockResistance", "rock-strength"),
            ] {
                let values = self
                    .channels
                    .get(from)
                    .ok_or_else(|| io::Error::other(format!("Natural forcing requires {from}")))?
                    .values
                    .snapshot(&mut self.coverage)?;
                self.put(to, unit, Quantity::Intensive, values);
            }
            return Ok(());
        }
        self.derived(field, selected)?;
        if channels::material().iter().all(|required| {
            selection
                .physical
                .iter()
                .any(|channel| channel.name == required.name)
        }) {
            self.cargo = Some(cargo::capture(
                field,
                &mut self.coverage,
                &self.interpolation.samples(),
            )?);
        }
        Ok(())
    }
    fn put(&mut self, name: &str, unit: &'static str, quantity: Quantity, values: Values) {
        self.channels.insert(
            name.into(),
            ProjectedChannel {
                unit: unit.into(),
                quantity,
                values,
            },
        );
    }
    fn physical(
        &mut self,
        field: &Field,
        source: &NumericBand,
        channel: &Channel,
    ) -> io::Result<()> {
        let existing = self.channels.remove(&channel.name);
        let mut output = match existing {
            Some(existing)
                if existing.values.read().sample_type() == source.sample_type()
                    && existing.values.read().len() == self.coverage.len() =>
            {
                existing.values
            }
            _ => Values::like(source, &mut self.coverage),
        };
        let extensive = channel.quantity == Quantity::Extensive;
        let source = source.read_values()?;
        self.interpolation.project(
            &|cell| {
                let value = source.get(cell)?;
                if !extensive {
                    return Ok(value);
                }
                let area = field.mesh.area(cell);
                Ok(if area > 0.0 { value / area } else { 0.0 })
            },
            channel.discrete,
            |start, values| output.write(start, values),
        )?;
        if extensive {
            // Conversion to the source type precedes the area multiplication in the source.
            let read = output.read();
            for start in (0..read.len()).step_by(4096) {
                let end = (start + 4096).min(read.len());
                let values = (start..end)
                    .map(|i| Ok(read.get(i)? * self.grid.measures.get(i)?))
                    .collect::<io::Result<Vec<_>>>()?;
                output.write(start, &values)?;
            }
        }
        self.put(&channel.name, channel.unit, channel.quantity, output);
        Ok(())
    }
    // hpc-exempt: selected publication names, not geographic membership.
    fn derived(&mut self, field: &Field, selected: Option<&BTreeSet<String>>) -> io::Result<()> {
        let materials = material::Materials::new(field)?;
        let volcanic_depth = material::length(field, 0.000025)?;
        for (name, unit, discrete, quantity) in [
            (
                "Precipitation",
                "millimetre/year",
                false,
                Quantity::Intensive,
            ),
            ("SurfaceMaterial", "category", true, Quantity::Category),
            ("TotalErosion", "native-length", false, Quantity::Intensive),
            ("PhysicalMaterial", "category", true, Quantity::Category),
            ("CarbonateFraction", "ratio", false, Quantity::Intensive),
        ] {
            if selected.is_some_and(|names| !names.contains(name)) {
                continue;
            }
            let read = |cell| match name {
                "Precipitation" => Ok(field.shared.scalar(S::Rainfall).get(cell)?
                    + field.shared.scalar(S::Snowfall).get(cell)?),
                "SurfaceMaterial" => materials.surface(cell),
                "TotalErosion" => Ok(field.shared.scalar(S::CumulativeFluvialErosion).get(cell)?
                    + field.shared.scalar(S::CumulativeGlacialErosion).get(cell)?
                    + field.shared.scalar(S::CumulativeCoastalErosion).get(cell)?),
                "PhysicalMaterial" => materials.physical(cell),
                _ => material::carbonate(field, cell, volcanic_depth),
            };
            let mut values = Values::F64(self.coverage.allocate(0.0));
            self.interpolation
                .project(&read, discrete, |start, block| values.write(start, block))?;
            self.put(name, unit, quantity, values);
        }
        Ok(())
    }
}
