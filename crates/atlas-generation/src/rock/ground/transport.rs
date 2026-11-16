//! Immutable donor packages used by plate placement and lateral overlap reconstruction.
use super::{
    deformation::{deform_fabric, deform_slope},
    Ground, GroundField as F,
};
use crate::{
    rock::{
        columns::{Column, ColumnValues, RockColumns},
        material::MaterialLayer,
    },
    storage::{Band, Coverage},
};
use std::{
    cell::{Ref, RefCell},
    io,
    rc::Rc,
};
pub const PLACEMENT_FIELDS: [F; 3] = [
    F::BedrockElevation,
    F::CrustSupportElevation,
    F::SurfaceRockLoad,
];
pub const SHEET_FIELDS: [F; 5] = [
    F::ThrustPairIds,
    F::ThrustSheetIndex,
    F::ThrustSegmentIds,
    F::ThrustAcross,
    F::ThrustDip,
];
pub const MATERIAL_FIELDS: [F; 5] = [
    F::GroundCutShare,
    F::GroundCutDepth,
    F::CrustSutureStrength,
    F::CrustSuturePairIds,
    F::CrustProvinceSeam,
];
pub struct HeldRock {
    columns: RockColumns,
    fields: Vec<(F, Band<f64>)>,
    donor: RefCell<Donor>,
}
struct Donor {
    cell: usize,
    columns: [Option<Vec<MaterialLayer>>; 4],
}
impl HeldRock {
    pub(super) fn read_columns(&self) -> io::Result<ColumnValues<'_>> {
        self.columns.read_values()
    }
    pub fn get(&self, field: F, cell: usize) -> io::Result<f64> {
        self.fields
            .iter()
            .find(|(name, _)| *name == field)
            .ok_or_else(|| io::Error::other("Field is not in the captured ground package"))?
            .1
            .get(cell)
    }
    pub fn layer(&self, cell: usize, column: Column, slot: usize) -> io::Result<MaterialLayer> {
        self.columns.read_layer(cell, column, slot)
    }
    pub fn cover_depth(&self, cell: usize) -> io::Result<f64> {
        let share = self.get(F::GroundCutShare, cell)?;
        Ok(self.columns.thickness(cell, Column::Loose)? * (1.0 - share)
            + self.columns.thickness(cell, Column::CutLoose)? * share)
    }
    pub(super) fn layers(&self, cell: usize, column: Column) -> io::Result<Vec<MaterialLayer>> {
        (0..column.size())
            .map(|slot| self.layer(cell, column, slot))
            .collect()
    }
    /// Retain only the latest donor, whose footprint can land on many receivers.
    pub(super) fn collision_layers(
        &self,
        cell: usize,
        column: Column,
    ) -> io::Result<Ref<'_, [MaterialLayer]>> {
        {
            let mut donor = self.donor.borrow_mut();
            if donor.cell != cell {
                donor.cell = cell;
                donor.columns = std::array::from_fn(|_| None);
            }
            if donor.columns[column as usize].is_none() {
                donor.columns[column as usize] = Some(self.layers(cell, column)?);
            }
        }
        Ok(Ref::map(self.donor.borrow(), |donor| {
            donor.columns[column as usize]
                .as_deref()
                .expect("Decoded donor column")
        }))
    }
}
#[derive(Clone, Copy)]
pub enum TransferOperation {
    PlatePlacement,
    PlateRemap,
    RockAccretion,
    CoverAccretion,
    SheetMove,
}
#[derive(Clone, Copy)]
pub enum TransferPhase {
    Before,
    After,
}
pub struct TransferObservation {
    pub operation: TransferOperation,
    pub phase: TransferPhase,
    pub source: usize,
    pub target: usize,
    pub accepted: Option<f64>,
    pub retained_area_share: Option<f64>,
}
pub type TransferObserver = dyn Fn(&TransferObservation, &Ground, &HeldRock) -> io::Result<()>;
#[derive(Clone)]
pub struct TransferWatch {
    pub cells: Vec<usize>,
    pub observe: Rc<TransferObserver>,
}
impl Ground {
    pub fn hold(&self, coverage: &mut Coverage) -> io::Result<HeldRock> {
        let mut fields = Vec::new();
        for name in PLACEMENT_FIELDS
            .into_iter()
            .chain(SHEET_FIELDS)
            .chain(MATERIAL_FIELDS)
        {
            fields.push((
                name,
                coverage.copy_band(&self.storage.bands[name as usize])?,
            ));
        }
        Ok(HeldRock {
            columns: self.columns.snapshot(coverage)?,
            fields,
            donor: RefCell::new(Donor {
                cell: usize::MAX,
                columns: std::array::from_fn(|_| None),
            }),
        })
    }
    pub fn watch_transfers(&mut self, watch: Option<TransferWatch>) -> Option<TransferWatch> {
        std::mem::replace(&mut self.watcher, watch)
    }
    pub(super) fn observe_transfer(
        &self,
        held: &HeldRock,
        observation: TransferObservation,
    ) -> io::Result<()> {
        if let Some(watch) = &self.watcher {
            if watch.cells.contains(&observation.source)
                || watch.cells.contains(&observation.target)
            {
                (watch.observe)(&observation, self, held)?;
            }
        }
        Ok(())
    }
    fn take_sheet(&mut self, held: &HeldRock, cell: usize, source: usize) -> io::Result<()> {
        for name in SHEET_FIELDS {
            self.set(name, cell, held.get(name, source)?)?;
        }
        Ok(())
    }
    fn take_rock(
        &mut self,
        held: &HeldRock,
        cell: usize,
        source: usize,
        natural: bool,
    ) -> io::Result<()> {
        for name in MATERIAL_FIELDS {
            self.set(name, cell, held.get(name, source)?)?;
        }
        for column in Column::ALL {
            for slot in 0..column.size() {
                let mut layer = held.columns.read_raw_layer(source, column, slot)?;
                if natural {
                    layer = self.identities.released_material(layer);
                }
                self.columns.set_layer(cell, column, slot, &layer)?;
            }
        }
        self.take_sheet(held, cell, source)?;
        self.project(cell)
    }
    pub fn restore(
        &mut self,
        held: &HeldRock,
        cell: usize,
        source: usize,
        elevation: f64,
    ) -> io::Result<()> {
        self.take_rock(held, cell, source, false)?;
        let change = elevation
            - (self.get(F::BedrockElevation, cell)? + self.get(F::SedimentThickness, cell)?);
        if change != 0.0 {
            self.displace(cell, change, "ground restoration")
        } else {
            self.project(cell)
        }
    }
    pub fn transplant(&mut self, held: &HeldRock, cell: usize, source: usize) -> io::Result<()> {
        self.restore(held, cell, source, self.get(F::Elevation, cell)?)
    }
    pub fn place_carried(
        &mut self,
        held: &HeldRock,
        cell: usize,
        source: usize,
        deformation: [f64; 4],
    ) -> io::Result<()> {
        let event = |phase| TransferObservation {
            operation: TransferOperation::PlatePlacement,
            phase,
            source,
            target: cell,
            accepted: None,
            retained_area_share: None,
        };
        self.observe_transfer(held, event(TransferPhase::Before))?;
        self.take_rock(held, cell, source, true)?;
        for name in PLACEMENT_FIELDS {
            self.set(name, cell, held.get(name, source)?)?;
        }
        self.transform(cell, deformation)?;
        self.observe_transfer(held, event(TransferPhase::After))
    }
    pub fn join_sheet(&mut self, cell: usize, identity: [f64; 3], across: f64) -> io::Result<()> {
        for (field, value) in [F::ThrustPairIds, F::ThrustSheetIndex, F::ThrustSegmentIds]
            .into_iter()
            .zip(identity)
        {
            self.set(field, cell, value)?;
        }
        self.set(F::ThrustAcross, cell, (across * 1000.0).round())
    }
    pub fn leave_sheet(&mut self, cell: usize) -> io::Result<()> {
        self.set(F::ThrustPairIds, cell, 0.0)?;
        self.set(F::ThrustSheetIndex, cell, 0.0)
    }
    pub fn move_sheet(&mut self, held: &HeldRock, cell: usize, source: usize) -> io::Result<()> {
        let event = |phase, accepted| TransferObservation {
            operation: TransferOperation::SheetMove,
            phase,
            source,
            target: cell,
            accepted,
            retained_area_share: None,
        };
        self.observe_transfer(held, event(TransferPhase::Before, None))?;
        let wanted = held.get(F::SurfaceRockLoad, source)? - self.get(F::SurfaceRockLoad, cell)?;
        self.take_rock(held, cell, source, true)?;
        self.shift(cell, wanted, "mountains")?;
        self.observe_transfer(held, event(TransferPhase::After, Some(wanted)))
    }
    pub fn superpose_sheets(
        &mut self,
        held: &HeldRock,
        cell: usize,
        under: usize,
        top: usize,
    ) -> io::Result<()> {
        self.move_sheet(held, cell, under)?;
        self.land_collision(held, cell, top, 1.0, [1.0, 0.0, 0.0, 1.0])?;
        self.take_sheet(held, cell, top)
    }
}
pub(super) fn transform_layer(mut layer: MaterialLayer, deformation: [f64; 4]) -> MaterialLayer {
    [layer.grain_x, layer.grain_y] = deform_fabric(layer.grain_x, layer.grain_y, deformation);
    [layer.bed_slope_x, layer.bed_slope_y] =
        deform_slope(layer.bed_slope_x, layer.bed_slope_y, deformation);
    layer
}
