//! One evaluation's place requests, kept separate from the owners that execute them.
use super::{
    catalogue::Catalogue,
    contract::Entry,
    ground_targets::{Band as GroundBand, Target},
    state::State,
    values::{Carried, Change, FieldChange, MagicBand, PhysicalBand, PhysicalChange, Place},
};
use crate::{
    field::{contributions::Medium, shared::Scalar},
    hpc::BitSet,
    rock::ground::GroundField,
    storage::{Band, Coverage},
};
use std::io;

pub struct Changes {
    pub cells: Vec<usize>,
    present: BitSet,
    add: Band<f64>,
    at_most: Band<f64>,
    at_least: Band<f64>,
}
impl Changes {
    pub fn kept_line_targets(&self) -> crate::human::operations::KeptLineTargets {
        crate::human::operations::KeptLineTargets {
            add: self.add.read_only(),
            at_most: self.at_most.read_only(),
            at_least: self.at_least.read_only(),
        }
    }
    pub fn new(coverage: &mut Coverage, length: usize) -> Self {
        Self {
            cells: Vec::new(),
            present: BitSet::new(length),
            add: coverage.allocate(0.0),
            at_most: coverage.allocate(f64::INFINITY),
            at_least: coverage.allocate(f64::NEG_INFINITY),
        }
    }
    pub fn contains(&self, cell: usize) -> bool {
        self.present.has(cell)
    }
    pub fn at(&self, cell: usize) -> io::Result<Target> {
        Ok(Target {
            add: self.add.get(cell)?,
            at_most: self.at_most.get(cell)?,
            at_least: self.at_least.get(cell)?,
        })
    }
    pub fn take(&mut self, cell: usize, change: Change) -> io::Result<()> {
        if !self.present.has(cell) {
            self.present.add(cell);
            self.cells.push(cell);
        }
        let mut target = self.at(cell)?;
        target.take(change);
        self.add.set(cell, target.add)?;
        self.at_most.set(cell, target.at_most)?;
        self.at_least.set(cell, target.at_least)
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Material {
    Ground(GroundBand),
    Shared(Medium),
}
pub fn material(band: &PhysicalBand) -> io::Result<Material> {
    Ok(match band {
        PhysicalBand::Ground(GroundField::Elevation) => Material::Ground(GroundBand::Elevation),
        PhysicalBand::Ground(GroundField::SedimentThickness) => {
            Material::Ground(GroundBand::SedimentThickness)
        }
        PhysicalBand::Ground(GroundField::RockResistance) => {
            Material::Ground(GroundBand::RockResistance)
        }
        PhysicalBand::Ground(GroundField::SoilDepth) => Material::Ground(GroundBand::SoilDepth),
        PhysicalBand::Scalar(Scalar::IceThickness) => Material::Ground(GroundBand::IceThickness),
        PhysicalBand::Scalar(name) => Material::Shared(Medium::Shared(*name)),
        PhysicalBand::Code(name) => Material::Shared(Medium::Code(*name)),
        PhysicalBand::Float(name) => Material::Shared(Medium::Float(*name)),
        PhysicalBand::Flag(name) => Material::Shared(Medium::Flag(*name)),
        _ => return Err(io::Error::other("Unsupported owned place target")),
    })
}
pub struct WaterInfluences {
    pub withdrawal: Band<f64>,
    pub transmission: Band<f64>,
    pub soil_wetting: Band<f64>,
    pub soil_held: Band<f64>,
}
impl WaterInfluences {
    pub fn for_field(field: &crate::field::Field) -> Self {
        Self::new(&mut field.coverage.borrow_mut())
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            withdrawal: coverage.allocate(0.0),
            transmission: coverage.allocate(1.0),
            soil_wetting: coverage.allocate(0.0),
            soil_held: coverage.allocate(0.0),
        }
    }
    pub fn clear(&mut self) -> io::Result<()> {
        for cell in 0..self.withdrawal.len() {
            self.withdrawal.set(cell, 0.0)?;
            self.transmission.set(cell, 1.0)?;
            self.soil_wetting.set(cell, 0.0)?;
            self.soil_held.set(cell, 0.0)?;
        }
        Ok(())
    }
    fn wet_soil(&mut self, change: &PhysicalChange) -> io::Result<()> {
        match change.change {
            Change::Add(v) => self
                .soil_wetting
                .set(change.cell, self.soil_wetting.get(change.cell)? + v),
            Change::AtLeast(v) => self
                .soil_held
                .set(change.cell, self.soil_held.get(change.cell)?.max(v)),
            _ => Err(io::Error::other(
                "A place cannot hold the soil's water down",
            )),
        }
    }
}
pub enum WaterWork {
    HoldSurface { cell: usize, surface: f64 },
    ShoalBed { cell: usize, depth: f64 },
}
pub struct Declared {
    pub bands: Vec<(Material, Changes)>,
    pub magic: Vec<(MagicBand, Changes)>,
    pub grades: Changes,
    pub kept_lines: Changes,
    pub water_works: Vec<WaterWork>,
}
impl Declared {
    pub fn new(coverage: &mut Coverage, length: usize) -> Self {
        Self {
            bands: Vec::new(),
            magic: Vec::new(),
            grades: Changes::new(coverage, length),
            kept_lines: Changes::new(coverage, length),
            water_works: Vec::new(),
        }
    }
    fn ask_water(
        &mut self,
        change: &PhysicalChange,
        water: Option<&mut WaterInfluences>,
    ) -> io::Result<()> {
        match (&change.band, change.change) {
            (PhysicalBand::SoilWater, _) => {
                if let Some(water) = water {
                    water.wet_soil(change)?;
                }
            }
            (PhysicalBand::WaterSurfaceElevations, Change::AtLeast(surface)) => {
                self.water_works.push(WaterWork::HoldSurface {
                    cell: change.cell,
                    surface,
                })
            }
            (PhysicalBand::RiverDepth, Change::AtMost(depth)) => {
                self.water_works.push(WaterWork::ShoalBed {
                    cell: change.cell,
                    depth,
                })
            }
            _ => {
                return Err(io::Error::other(
                    "A place's water request must go through the water owner",
                ))
            }
        }
        Ok(())
    }
    pub fn collect(
        &mut self,
        change: FieldChange,
        water: Option<&mut WaterInfluences>,
        coverage: &mut Coverage,
        length: usize,
    ) -> io::Result<()> {
        match change {
            FieldChange::WaterPassage {
                cell,
                withdrawal,
                transmission,
            } => {
                if let Some(water) = water {
                    water
                        .withdrawal
                        .set(cell, water.withdrawal.get(cell)? + withdrawal.max(0.0))?;
                    water.transmission.set(
                        cell,
                        water.transmission.get(cell)? * transmission.clamp(0.0, 1.0),
                    )?;
                }
            }
            FieldChange::GradeGround { cell, gradient } => {
                self.grades.take(cell, Change::AtMost(gradient))?
            }
            FieldChange::Magic { band, cell, change } => {
                take(&mut self.magic, band, cell, change, coverage, length)?;
            }
            FieldChange::Physical(change) => {
                if matches!(
                    change.band,
                    PhysicalBand::Human(crate::human::HumanField::KeptLine)
                ) {
                    self.kept_lines.take(change.cell, change.change)?;
                } else if matches!(
                    change.band,
                    PhysicalBand::SoilWater
                        | PhysicalBand::WaterSurfaceElevations
                        | PhysicalBand::RiverDepth
                ) {
                    self.ask_water(&change, water)?;
                } else {
                    take(
                        &mut self.bands,
                        material(&change.band)?,
                        change.cell,
                        change.change,
                        coverage,
                        length,
                    )?;
                }
            }
        }
        Ok(())
    }
}
fn take<K: PartialEq>(
    entries: &mut Vec<(K, Changes)>,
    key: K,
    cell: usize,
    change: Change,
    coverage: &mut Coverage,
    length: usize,
) -> io::Result<()> {
    let index = entries
        .iter()
        .position(|(held, _)| *held == key)
        .unwrap_or_else(|| {
            entries.push((key, Changes::new(coverage, length)));
            entries.len() - 1
        });
    entries[index].1.take(cell, change)
}
/// Carries exactly the current catalogue's places, including captured parent places.
pub fn declare<'a, S: State + 'a, Schedule: 'a>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
    places: impl Fn(&Entry<S, Schedule>) -> io::Result<Vec<Place>>,
    carried: impl IntoIterator<Item = (&'a Entry<S, Schedule>, &'a Carried)>,
    mut water: Option<&mut WaterInfluences>,
    water_only: bool,
) -> io::Result<Declared> {
    state.held().release();
    if let Some(water) = water.as_deref_mut() {
        water.clear()?;
    }
    let field = state.field()?;
    let length = field.mesh.len();
    let mut declared = Declared::new(&mut field.coverage.borrow_mut(), length);
    for entry in catalogue.entries() {
        let roles = &entry.roles.fields;
        let effects = if water_only {
            vec![&roles.water]
        } else {
            vec![
                &roles.terrain,
                &roles.water,
                &roles.climate,
                &roles.cover,
                &roles.magic,
            ]
        };
        if !effects.iter().any(|e| e.value().is_some()) {
            continue;
        }
        let mut changes = Vec::new();
        for place in places(entry)? {
            for effect in effects.iter().filter_map(|e| e.value()) {
                changes.extend(effect(state, &place)?);
            }
        }
        collect_all(
            state,
            &mut declared,
            changes
                .into_iter()
                .filter(|c| !water_only || water_influence(c)),
            water.as_deref_mut(),
        )?;
    }
    if state.regional() {
        for (entry, place) in carried {
            if let Some(realize) = entry.across_maps.realize.value() {
                collect_all(
                    state,
                    &mut declared,
                    realize(state, place)?,
                    water.as_deref_mut(),
                )?;
            }
        }
    }
    state.held().release();
    Ok(declared)
}
fn water_influence(change: &FieldChange) -> bool {
    matches!(
        change,
        FieldChange::WaterPassage { .. }
            | FieldChange::Physical(PhysicalChange {
                band: PhysicalBand::SoilWater,
                ..
            })
    )
}
fn collect_all(
    state: &impl State,
    declared: &mut Declared,
    changes: impl IntoIterator<Item = FieldChange>,
    mut water: Option<&mut WaterInfluences>,
) -> io::Result<()> {
    let field = state.field()?;
    for change in changes {
        declared.collect(
            change,
            water.as_deref_mut(),
            &mut field.coverage.borrow_mut(),
            field.mesh.len(),
        )?;
    }
    Ok(())
}

/// Before the first regional round, grading comes only from captured places.
pub fn carried<'a, S: State + 'a, Schedule: 'a>(
    state: &S,
    places: impl IntoIterator<Item = (&'a Entry<S, Schedule>, &'a Carried)>,
) -> io::Result<Declared> {
    let field = state.field()?;
    let mut declared = Declared::new(&mut field.coverage.borrow_mut(), field.mesh.len());
    for (entry, place) in places {
        if let Some(realize) = entry.across_maps.realize.value() {
            collect_all(state, &mut declared, realize(state, place)?, None)?;
        }
    }
    Ok(declared)
}
