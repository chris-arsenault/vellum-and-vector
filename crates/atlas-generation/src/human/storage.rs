use super::{
    catalogue::{self, LayerId},
    identity::{IdentityColumn, IdentityLayer, Tradition, IDENTITY_SLOTS},
};
use crate::{
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::{io, rc::Rc};
pub(super) fn positive(value: f64) -> f64 {
    if value > 0.0 && value.is_finite() {
        value
    } else {
        0.0
    }
}
pub(super) fn unit(value: f64) -> f64 {
    if value > 0.0 {
        value.min(1.0)
    } else {
        0.0
    }
}
#[derive(Clone, Copy)]
pub enum HumanField {
    Layer(LayerId),
    RuinedBuiltUp,
    RuinedStanding,
    RuinCover,
    Tenure,
    WalkedRoute,
    MassDeath,
    KeptLine,
}
pub struct IdentityView {
    pub people: ReadBand<f64>,
    pub hardness: ReadBand<f64>,
    pub age: ReadBand<f64>,
    pub traditions: [ReadBand<i32>; 5],
}
pub(super) struct IdentityBands {
    pub people: Band<f64>,
    hardness: Band<f64>,
    age: Band<f64>,
    traditions: [Band<i32>; 5],
}
impl IdentityBands {
    fn new(coverage: &mut Coverage) -> Self {
        Self {
            people: coverage.allocate(0.0),
            hardness: coverage.allocate(0.0),
            age: coverage.allocate(0.0),
            traditions: std::array::from_fn(|_| coverage.allocate(0)),
        }
    }
    fn read(&self, cell: usize) -> io::Result<IdentityLayer> {
        let mut traditions = [0; 5];
        for (value, band) in traditions.iter_mut().zip(&self.traditions) {
            *value = band.get(cell)?;
        }
        Ok(IdentityLayer {
            people: self.people.get(cell)?,
            hardness: self.hardness.get(cell)?,
            age: self.age.get(cell)?,
            traditions,
        })
    }
    fn write(&mut self, cell: usize, layer: &IdentityLayer) -> io::Result<()> {
        self.people.set(cell, layer.people)?;
        self.hardness.set(cell, layer.hardness)?;
        self.age.set(cell, layer.age)?;
        for (band, value) in self.traditions.iter_mut().zip(layer.traditions) {
            band.set(cell, value)?;
        }
        Ok(())
    }
}
pub(super) struct LayerBands {
    pub layers: [Band<f64>; 5],
    pub remains: [Band<f64>; 3],
    pub ruin_tongue: Band<i32>,
    pub identity: [IdentityBands; IDENTITY_SLOTS],
}
impl LayerBands {
    pub fn snapshot(&self, coverage: &mut Coverage) -> io::Result<Self> {
        let identity = self
            .identity
            .iter()
            .map(|slot| {
                Ok(IdentityBands {
                    people: coverage.copy_band(&slot.people)?,
                    hardness: coverage.copy_band(&slot.hardness)?,
                    age: coverage.copy_band(&slot.age)?,
                    traditions: copy_array(&slot.traditions, coverage)?,
                })
            })
            .collect::<io::Result<Vec<_>>>()?
            .try_into()
            .map_err(|_| io::Error::other("Identity column width"))?;
        Ok(Self {
            layers: copy_array(&self.layers, coverage)?,
            remains: copy_array(&self.remains, coverage)?,
            ruin_tongue: coverage.copy_band(&self.ruin_tongue)?,
            identity,
        })
    }
    pub fn clear(&mut self, count: usize) -> io::Result<()> {
        for cell in 0..count {
            for band in self.layers.iter_mut().chain(&mut self.remains) {
                band.set(cell, 0.0)?;
            }
            self.ruin_tongue.set(cell, 0)?;
            self.write_column(cell, &[])?;
        }
        Ok(())
    }
    fn new(coverage: &mut Coverage) -> Self {
        Self {
            layers: std::array::from_fn(|_| coverage.allocate(0.0)),
            remains: std::array::from_fn(|_| coverage.allocate(0.0)),
            ruin_tongue: coverage.allocate(0),
            identity: std::array::from_fn(|_| IdentityBands::new(coverage)),
        }
    }
    pub fn column(&self, cell: usize) -> io::Result<IdentityColumn> {
        let mut result = Vec::new();
        for slot in &self.identity {
            if slot.people.get(cell)? > 0.0 {
                result.push(slot.read(cell)?);
            }
        }
        Ok(result)
    }
    pub fn write_column(&mut self, cell: usize, column: &[IdentityLayer]) -> io::Result<()> {
        if column.len() > IDENTITY_SLOTS {
            return Err(io::Error::other(
                "Settle identity before installing its column",
            ));
        }
        for (slot, band) in self.identity.iter_mut().enumerate() {
            band.write(cell, column.get(slot).unwrap_or(&IdentityLayer::default()))?;
        }
        Ok(())
    }
}
fn copy_array<T: crate::storage::Sample, const N: usize>(
    bands: &[Band<T>; N],
    coverage: &mut Coverage,
) -> io::Result<[Band<T>; N]> {
    bands
        .iter()
        .map(|band| coverage.copy_band(band))
        .collect::<io::Result<Vec<_>>>()?
        .try_into()
        .map_err(|_| io::Error::other("Band collection width"))
}
pub struct HumanSeed {
    bands: LayerBands,
    records: [Band<f64>; 4],
}
impl HumanSeed {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            bands: LayerBands::new(coverage),
            records: std::array::from_fn(|_| coverage.allocate(0.0)),
        }
    }
    pub fn initialize(&mut self, field: HumanField, cell: usize, value: f64) -> io::Result<()> {
        scalar(&mut self.bands, &mut self.records, field).set(cell, value)
    }
    pub fn initialize_column(&mut self, cell: usize, column: &[IdentityLayer]) -> io::Result<()> {
        self.bands.write_column(cell, column)
    }
    pub fn initialize_ruin_tongue(&mut self, cell: usize, tongue: i32) -> io::Result<()> {
        self.bands.ruin_tongue.set(cell, tongue)
    }
}
fn scalar<'a>(
    bands: &'a mut LayerBands,
    records: &'a mut [Band<f64>; 4],
    field: HumanField,
) -> &'a mut Band<f64> {
    match field {
        HumanField::Layer(kind) => &mut bands.layers[kind as usize],
        HumanField::RuinedBuiltUp => &mut bands.remains[0],
        HumanField::RuinedStanding => &mut bands.remains[1],
        HumanField::RuinCover => &mut bands.remains[2],
        HumanField::Tenure => &mut records[0],
        HumanField::WalkedRoute => &mut records[1],
        HumanField::MassDeath => &mut records[2],
        HumanField::KeptLine => &mut records[3],
    }
}
/// Mutations are private to the owner and its registered operations; construction consumes the seed.
/// ```compile_fail
/// use atlas_generation::human::HumanLayers;
/// fn spill(owner: &mut HumanLayers) { owner.bands.layers[0].set(0, 10.0); }
/// ```
/// ```compile_fail
/// use atlas_generation::human::{HumanLayers, operations::Lay};
/// fn bypass(owner: &mut HumanLayers, input: &Lay) { owner.lay(input); }
/// ```
pub struct HumanLayers {
    pub(super) bands: LayerBands,
    pub(super) records: [Band<f64>; 4],
    pub(super) place_kept: Option<Band<f64>>,
    pub(super) mesh: Rc<TriangularLattice>,
}
impl HumanLayers {
    pub(crate) fn restore_authored(
        &mut self,
        name: &str,
        cell: usize,
        value: f64,
    ) -> io::Result<bool> {
        for (index, field) in ["Population", "Farmland", "Pasture", "BuiltUp", "Standing"]
            .into_iter()
            .enumerate()
        {
            if name == field {
                self.bands.layers[index].set(cell, value)?;
                return Ok(true);
            }
        }
        for (index, field) in ["RuinedBuiltUp", "RuinedStanding", "RuinCover"]
            .into_iter()
            .enumerate()
        {
            if name == field {
                self.bands.remains[index].set(cell, value)?;
                return Ok(true);
            }
        }
        if name == "RuinTongue" {
            self.bands
                .ruin_tongue
                .set(cell, (value + 0.5).floor() as i32)?;
            return Ok(true);
        }
        for (slot, bands) in self.bands.identity.iter_mut().enumerate() {
            for (part, band) in [
                ("People", &mut bands.people),
                ("Hardness", &mut bands.hardness),
                ("Age", &mut bands.age),
            ] {
                if name == format!("Identity{part}{slot}") {
                    band.set(cell, value)?;
                    return Ok(true);
                }
            }
            for (part, band) in ["Tongue", "Faith", "Custom", "Allegiance", "Craft"]
                .into_iter()
                .zip(&mut bands.traditions)
            {
                if name == format!("Identity{part}{slot}") {
                    band.set(cell, (value + 0.5).floor() as i32)?;
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    pub fn identity(&self, slot: usize) -> IdentityView {
        let bands = &self.bands.identity[slot];
        IdentityView {
            people: bands.people.read_only(),
            hardness: bands.hardness.read_only(),
            age: bands.age.read_only(),
            traditions: std::array::from_fn(|i| bands.traditions[i].read_only()),
        }
    }
    pub fn new(seed: HumanSeed, mesh: Rc<TriangularLattice>) -> Self {
        Self {
            bands: seed.bands,
            records: seed.records,
            place_kept: None,
            mesh,
        }
    }
    pub fn view(&self, field: HumanField) -> ReadBand<f64> {
        match field {
            HumanField::Layer(kind) => self.bands.layers[kind as usize].read_only(),
            HumanField::RuinedBuiltUp => self.bands.remains[0].read_only(),
            HumanField::RuinedStanding => self.bands.remains[1].read_only(),
            HumanField::RuinCover => self.bands.remains[2].read_only(),
            HumanField::Tenure => self.records[0].read_only(),
            HumanField::WalkedRoute => self.records[1].read_only(),
            HumanField::MassDeath => self.records[2].read_only(),
            HumanField::KeptLine => self.records[3].read_only(),
        }
    }
    pub fn ruin_tongue(&self) -> ReadBand<i32> {
        self.bands.ruin_tongue.read_only()
    }
    pub fn tradition(&self, slot: usize, field: Tradition) -> ReadBand<i32> {
        self.bands.identity[slot].traditions[field as usize].read_only()
    }
    pub fn column(&self, cell: usize) -> io::Result<IdentityColumn> {
        self.bands.column(cell)
    }
    pub fn free_area(&self, cell: usize) -> io::Result<f64> {
        let mut taken = 0.0;
        for kind in LayerId::ALL {
            if catalogue::facts(kind).area {
                taken += self.bands.layers[kind as usize].get(cell)?;
            }
        }
        Ok((1.0 - taken).max(0.0))
    }
    pub fn standing(&self, cell: usize) -> io::Result<f64> {
        let built = self.bands.layers[catalogue::BUILT as usize].get(cell)?;
        Ok(if built > 0.0 {
            unit(
                self.bands.layers[catalogue::WORKS as usize].get(cell)?
                    / (built * catalogue::FULL_STANDING_PER_BUILT_KM2),
            )
        } else {
            0.0
        })
    }
    pub fn people(&self, cell: usize) -> io::Result<f64> {
        self.bands.layers[catalogue::PEOPLE as usize].get(cell)
    }
    pub(super) fn room(&self, kind: LayerId, cell: usize) -> io::Result<f64> {
        if catalogue::facts(kind).area {
            self.free_area(cell)
        } else {
            Ok(f64::INFINITY)
        }
    }
    pub(super) fn ground(&self, cell: i32) -> bool {
        cell >= 0 && (cell as usize) < self.mesh.len() && self.mesh.area(cell as usize) > 0.0
    }
    pub(super) fn km2(&self, cell: usize) -> f64 {
        use crate::scale::{AreaUnit, MapScale};
        MapScale::area_units(
            self.mesh.area(cell),
            AreaUnit::SquareMetre,
            AreaUnit::SquareKilometre,
        )
    }
    pub(super) fn thin_column(&mut self, cell: usize, kept: f64) -> io::Result<()> {
        for slot in &mut self.bands.identity {
            slot.people.set(cell, slot.people.get(cell)? * unit(kept))?;
        }
        Ok(())
    }
}
