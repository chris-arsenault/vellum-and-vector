//! Ground-owned column storage and bed operations. Placement is the ground owner's concern.
use super::{
    cargo::CargoStore,
    catalogue,
    coarsening::{coarsen_one, same_material, ObserveFold},
    layer_bands::{LayerBands, LayerValues},
    material::{blend_layers, MaterialLayer},
};
use crate::storage::{Band, Coverage};
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Column {
    Land,
    Cut,
    Loose,
    CutLoose,
}
impl Column {
    pub const ALL: [Self; 4] = [Self::Land, Self::Cut, Self::Loose, Self::CutLoose];
    pub fn finite(self) -> bool {
        matches!(self, Self::Loose | Self::CutLoose)
    }
    pub fn size(self) -> usize {
        if self.finite() {
            4
        } else {
            8
        }
    }
    fn offset(self) -> usize {
        match self {
            Self::Land => 0,
            Self::Cut => 8,
            Self::Loose => 16,
            Self::CutLoose => 20,
        }
    }
}
// Arconis: docs/architecture/subsystems.arconis#item=g_columns — per-cell rock layers in intact and cut shares, plus loose cover.
pub struct RockColumns {
    layers: [Vec<LayerBands>; 4],
    cargo: CargoStore,
    cargo_cells: Band<u8>,
    revisions: Band<f64>,
    count: usize,
}
pub(crate) struct ColumnValues<'a> {
    layers: Vec<LayerValues<'a>>,
    cargo: &'a CargoStore,
    count: usize,
}
impl ColumnValues<'_> {
    pub(crate) fn depth(&self, cell: usize, column: Column, slot: usize) -> io::Result<f64> {
        self.layers[column.offset() + slot].depth(cell)
    }
    pub(crate) fn layer(
        &self,
        cell: usize,
        column: Column,
        slot: usize,
    ) -> io::Result<MaterialLayer> {
        let at = column.offset() + slot;
        let mut layer = self.layers[at].read(cell, catalogue::facts())?;
        layer.cargo = self.cargo.get(at * self.count + cell)?;
        Ok(layer)
    }
}
impl RockColumns {
    pub(super) fn surface_material(
        &self,
        cell: usize,
        column: Column,
    ) -> io::Result<MaterialLayer> {
        self.layers[column as usize][0].surface_material(cell, catalogue::facts())
    }
    pub(super) fn transform(&mut self, cell: usize, deformation: [f64; 4]) -> io::Result<()> {
        for layer in self.layers.iter_mut().flatten() {
            layer.transform(cell, deformation)?;
        }
        self.revisions.set(cell, self.revisions.get(cell)? + 24.0)
    }
    pub(super) fn tilt_field(
        &mut self,
        gradients: &[[f64; 2]],
        cut_share: &crate::storage::ReadBand<f64>,
        epoch: f64,
    ) -> io::Result<()> {
        let shares = cut_share.read_values()?;
        let mut revisions = self.revisions.write_values()?;
        for column in Column::ALL {
            let cut = matches!(column, Column::Cut | Column::CutLoose);
            for layer in &mut self.layers[column as usize] {
                layer.tilt_field(
                    gradients,
                    |cell| {
                        let share = shares.get(cell)?.clamp(0.0, 1.0);
                        Ok(if cut { share > 0.0 } else { share < 1.0 })
                    },
                    epoch,
                    &mut revisions,
                )?;
            }
        }
        Ok(())
    }
    pub(crate) fn read_values(&self) -> io::Result<ColumnValues<'_>> {
        Ok(ColumnValues {
            layers: self
                .layers
                .iter()
                .flatten()
                .map(LayerBands::read_values)
                .collect::<io::Result<_>>()?,
            cargo: &self.cargo,
            count: self.count,
        })
    }
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.label("rock-columns")?;
        for column in &mut self.layers {
            for layer in column {
                layer.checkpoint(archive)?;
            }
        }
        self.cargo.checkpoint(archive)?;
        archive.band("cargo-cells", &mut self.cargo_cells)?;
        archive.band("column-revisions", &mut self.revisions)
    }
    pub fn view(&self, column: Column, slot: usize) -> super::layer_bands::ReadLayerBands {
        self.layers[column as usize][slot].read_only()
    }
    pub fn new(coverage: &mut Coverage) -> Self {
        let count = coverage.len();
        Self {
            layers: std::array::from_fn(|i| {
                (0..Column::ALL[i].size())
                    .map(|_| LayerBands::new(coverage))
                    .collect()
            }),
            cargo: CargoStore::new(
                coverage,
                count
                    .checked_mul(24)
                    .expect("Cargo slots exceed address representation"),
            ),
            cargo_cells: coverage.allocate(0u8),
            revisions: coverage.allocate(0.0),
            count,
        }
    }
    fn cargo_slot(&self, cell: usize, column: Column, slot: usize) -> usize {
        (column.offset() + slot) * self.count + cell
    }
    pub(super) fn has_cargo(&self, cell: usize) -> io::Result<bool> {
        Ok(self.cargo_cells.get(cell)? > 0)
    }
    pub(super) fn revision(&self, cell: usize) -> io::Result<f64> {
        self.revisions.get(cell)
    }
    pub(super) fn cargo_density(
        &self,
        cell: usize,
        column: Column,
        slot: usize,
        key: i32,
    ) -> io::Result<f64> {
        self.cargo
            .density(self.cargo_slot(cell, column, slot), key, None)
    }
    pub(super) fn set_cargo(
        &mut self,
        cell: usize,
        column: Column,
        slot: usize,
        cargo: Option<&super::cargo::MaterialCargo>,
    ) -> io::Result<()> {
        let at = self.cargo_slot(cell, column, slot);
        let before = u8::from(self.cargo.has(at)?);
        self.cargo.set(at, cargo)?;
        let after = u8::from(self.cargo.has(at)?);
        self.cargo_cells
            .set(cell, self.cargo_cells.get(cell)? - before + after)?;
        self.revisions.set(cell, self.revisions.get(cell)? + 1.0)
    }
    pub fn read_layer(
        &self,
        cell: usize,
        column: Column,
        slot: usize,
    ) -> io::Result<MaterialLayer> {
        let mut layer = self.layers[column as usize][slot].read(cell, catalogue::facts())?;
        layer.cargo = self.cargo.get(self.cargo_slot(cell, column, slot))?;
        Ok(layer)
    }
    /// Construction imports custody without changing the captured material scalars.
    pub fn import_cargo(
        &mut self,
        cell: usize,
        column: Column,
        slot: usize,
        cargo: Option<&super::cargo::MaterialCargo>,
    ) -> io::Result<()> {
        if cargo.is_some() && self.depth(cell, column, slot)? <= 0.0 {
            return Err(io::Error::other(
                "Cargo must arrive with an occupied material bed",
            ));
        }
        self.set_cargo(cell, column, slot, cargo)
    }
    pub(super) fn read_raw_layer(
        &self,
        cell: usize,
        column: Column,
        slot: usize,
    ) -> io::Result<MaterialLayer> {
        let mut layer = self.layers[column as usize][slot].read_raw(cell)?;
        layer.cargo = self.cargo.get(self.cargo_slot(cell, column, slot))?;
        Ok(layer)
    }
    pub fn depth(&self, cell: usize, column: Column, slot: usize) -> io::Result<f64> {
        self.layers[column as usize][slot].depth(cell)
    }
    pub fn thickness(&self, cell: usize, column: Column) -> io::Result<f64> {
        (0..column.size()).try_fold(0.0, |sum, slot| Ok(sum + self.depth(cell, column, slot)?))
    }
    pub fn deepest(&self, cell: usize, column: Column) -> io::Result<usize> {
        let mut slot = 0;
        while slot < column.size() - 1 && self.depth(cell, column, slot + 1)? > 0.0 {
            slot += 1;
        }
        Ok(slot)
    }
    pub fn snapshot(&self, coverage: &mut Coverage) -> io::Result<Self> {
        let mut layers: [Vec<LayerBands>; 4] = std::array::from_fn(|_| Vec::new());
        for (into, from) in layers.iter_mut().zip(&self.layers) {
            for layer in from {
                into.push(layer.snapshot(coverage)?);
            }
        }
        Ok(Self {
            layers,
            cargo: self.cargo.snapshot(coverage)?,
            cargo_cells: coverage.copy_band(&self.cargo_cells)?,
            revisions: coverage.copy_band(&self.revisions)?,
            count: self.count,
        })
    }
    /// The construction owner holds this writer; readers receive only detached slabs.
    pub fn set_layer(
        &mut self,
        cell: usize,
        column: Column,
        slot: usize,
        material: &MaterialLayer,
    ) -> io::Result<()> {
        self.layers[column as usize][slot].write(cell, material)?;
        let cargo = if material.depth > 0.0 {
            material.cargo.as_ref()
        } else {
            None
        };
        self.set_cargo(cell, column, slot, cargo)
    }
    pub fn copy_layer(
        &mut self,
        cell: usize,
        from: (Column, usize),
        to: (Column, usize),
    ) -> io::Result<()> {
        let mut layer = self.layers[from.0 as usize][from.1].read_raw(cell)?;
        layer.cargo = self.cargo.get(self.cargo_slot(cell, from.0, from.1))?;
        self.set_layer(cell, to.0, to.1, &layer)
    }
    fn set_depth(
        &mut self,
        cell: usize,
        column: Column,
        slot: usize,
        depth: f64,
    ) -> io::Result<()> {
        self.layers[column as usize][slot].set_depth(cell, depth)?;
        self.revisions.set(cell, self.revisions.get(cell)? + 1.0)
    }
    pub fn write_column(
        &mut self,
        cell: usize,
        column: Column,
        layers: &[MaterialLayer],
    ) -> io::Result<()> {
        if layers.len() > column.size() {
            return Err(io::Error::other(
                "Coarsen a package before installing its column",
            ));
        }
        for (slot, layer) in layers.iter().enumerate() {
            let mut layer = layer.clone();
            layer.cargo = layer.cargo.as_ref().and_then(|cargo| {
                cargo.aggregate_hosts(layer.kind as i32, layer.secondary_kind as i32)
            });
            self.set_layer(cell, column, slot, &layer)?;
        }
        for slot in layers.len()..column.size() {
            self.set_depth(cell, column, slot, 0.0)?;
            self.set_cargo(cell, column, slot, None)?;
        }
        Ok(())
    }
    /// Top-first input is buried from its bottom; coarsen after each arrival as in the source.
    pub fn insert(
        &mut self,
        cell: usize,
        column: Column,
        incoming: &[MaterialLayer],
        epoch: f64,
        observe: &mut ObserveFold<'_>,
    ) -> io::Result<()> {
        let mut layers = Vec::new();
        for slot in 0..column.size() {
            if self.depth(cell, column, slot)? <= 0.0 {
                break;
            }
            layers.push(self.read_layer(cell, column, slot)?);
        }
        if layers.is_empty() && !column.finite() {
            layers.push(catalogue::material(catalogue::STRATA, 1.0, epoch));
        }
        for bed in incoming.iter().rev().filter(|bed| bed.depth > 0.0) {
            if let Some(top) = layers.first().filter(|top| same_material(top, bed)) {
                layers[0] = MaterialLayer {
                    depth: top.depth + bed.depth,
                    formed_min: top.formed_min.min(bed.formed_min),
                    formed_max: top.formed_max.max(bed.formed_max),
                    ..bed.clone()
                };
            } else {
                layers.insert(0, bed.clone());
                if layers.len() > column.size() {
                    coarsen_one(&mut layers, !column.finite(), observe)?;
                }
            }
        }
        self.write_column(cell, column, &layers)
    }
    /// Finite cover may run out. Solid basement always retains its positive occupancy marker.
    pub fn strip(&mut self, cell: usize, column: Column, amount: f64) -> io::Result<f64> {
        let mut left = amount.max(0.0);
        while left > 0.0 {
            let top = self.depth(cell, column, 0)?;
            let second = self.depth(cell, column, 1)?;
            if top > left || second <= 0.0 {
                let floor = if column.finite() || second > 0.0 {
                    0.0
                } else {
                    1.0
                };
                let remaining = (top - left).max(floor);
                self.set_depth(cell, column, 0, remaining)?;
                if remaining <= floor {
                    self.set_cargo(cell, column, 0, None)?;
                }
                left = if column.finite() {
                    (left - top).max(0.0)
                } else {
                    0.0
                };
                break;
            }
            left -= top;
            for slot in 0..column.size() - 1 {
                self.copy_layer(cell, (column, slot + 1), (column, slot))?;
            }
            self.set_depth(cell, column, column.size() - 1, 0.0)?;
            self.set_cargo(cell, column, column.size() - 1, None)?;
        }
        Ok(amount.max(0.0) - left)
    }
    pub fn material_through(
        &self,
        cell: usize,
        column: Column,
        amount: f64,
    ) -> io::Result<Option<MaterialLayer>> {
        let mut result: Option<MaterialLayer> = None;
        self.visit_withdrawal(cell, column, amount, &mut |part| {
            result = Some(match result.take() {
                Some(held) => blend_layers(&held, &part, held.depth, part.depth),
                None => part,
            });
            Ok(())
        })?;
        Ok(result)
    }
    fn visit_withdrawal(
        &self,
        cell: usize,
        column: Column,
        amount: f64,
        receive: &mut dyn FnMut(MaterialLayer) -> io::Result<()>,
    ) -> io::Result<f64> {
        let bottom = self.deepest(cell, column)?;
        let mut left = amount.max(0.0);
        for slot in 0..=bottom {
            if left <= 0.0 {
                break;
            }
            let layer = self.read_layer(cell, column, slot)?;
            let basement = slot == bottom && !column.finite();
            let taken = left.min(if basement { left } else { layer.depth });
            if taken > 0.0 {
                receive(layer.finite_slice(taken, basement, 0.0))?;
            }
            left -= taken;
        }
        Ok(amount.max(0.0) - left)
    }
    /// The ground owner applies custody release to each receipt before handing it to a carrier.
    pub fn withdraw(
        &mut self,
        cell: usize,
        column: Column,
        amount: f64,
        receive: &mut dyn FnMut(MaterialLayer) -> io::Result<()>,
    ) -> io::Result<f64> {
        let removed = self.visit_withdrawal(cell, column, amount, receive)?;
        self.strip(cell, column, removed)?;
        Ok(removed)
    }
    pub fn withdraw_buried(
        &mut self,
        cell: usize,
        column: Column,
        amount: f64,
        receive: &mut dyn FnMut(MaterialLayer) -> io::Result<()>,
    ) -> io::Result<f64> {
        let mut left = amount.max(0.0);
        for slot in (0..column.size()).rev() {
            if left <= 0.0 {
                break;
            }
            let mut layer = self.read_layer(cell, column, slot)?;
            let taken = left.min(layer.depth);
            if taken <= 0.0 {
                continue;
            }
            let remaining = layer.depth - taken;
            layer.depth = taken;
            receive(layer)?;
            self.set_depth(cell, column, slot, remaining)?;
            if remaining <= 0.0 {
                self.set_cargo(cell, column, slot, None)?;
            }
            left -= taken;
        }
        Ok(amount.max(0.0) - left)
    }
    pub fn change_layer(
        &mut self,
        cell: usize,
        column: Column,
        slot: usize,
        kind: usize,
        epoch: f64,
    ) -> io::Result<()> {
        let mut was = self.read_layer(cell, column, slot)?;
        was.kind = kind;
        was.secondary_kind = kind;
        was.secondary_share = 0.0;
        was.strength = catalogue::kind_of_code(kind).facts.resistance;
        was.mixed = 0.0;
        was.altered = epoch;
        self.set_layer(cell, column, slot, &was)
    }
    pub fn intrude_basement(
        &mut self,
        cell: usize,
        column: Column,
        kind: usize,
        shell: f64,
        epoch: f64,
    ) -> io::Result<()> {
        let deepest = self.deepest(cell, column)?;
        if deepest > 0 {
            return self.change_layer(cell, column, deepest, kind, epoch);
        }
        let mut was = self.read_layer(cell, column, 0)?;
        if was.depth <= shell {
            return Ok(());
        }
        self.set_depth(cell, column, 0, shell)?;
        was.depth -= shell;
        self.set_layer(cell, column, 1, &was)?;
        self.change_layer(cell, column, 1, kind, epoch)
    }
    pub fn shuffle(&mut self, cell: usize, column: Column, share: f64) -> io::Result<()> {
        let upper = usize::from(share >= 0.5);
        if self.depth(cell, column, upper + 1)? <= 0.0 {
            return Ok(());
        }
        let was = self.read_layer(cell, column, upper)?;
        self.copy_layer(cell, (column, upper + 1), (column, upper))?;
        self.set_layer(cell, column, upper + 1, &was)
    }
}
