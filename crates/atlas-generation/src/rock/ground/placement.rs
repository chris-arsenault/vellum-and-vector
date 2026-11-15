use super::{Ground, GroundField as F};
use crate::{
    rock::{catalogue, columns::Column, material::MaterialLayer},
    settlement::removal::Facet,
};
use std::io;
pub(super) fn rock_column(facet: Facet) -> Column {
    match facet {
        Facet::Land => Column::Land,
        Facet::Cut => Column::Cut,
    }
}
pub(super) fn cover_column(facet: Facet) -> Column {
    match facet {
        Facet::Land => Column::Loose,
        Facet::Cut => Column::CutLoose,
    }
}
#[derive(Clone)]
pub struct SectionLayer {
    pub material: MaterialLayer,
    pub top: f64,
    pub bottom: f64,
    pub share: f64,
    pub loose: bool,
    pub basement: bool,
}
impl Ground {
    pub fn open_cut(&mut self, cell: usize, share: f64) -> io::Result<()> {
        if self.share(cell, Facet::Cut)? > 0.0 {
            return Ok(());
        }
        for (from, to) in [
            (Column::Land, Column::Cut),
            (Column::Loose, Column::CutLoose),
        ] {
            for slot in 0..from.size() {
                self.columns.copy_layer(cell, (from, slot), (to, slot))?;
            }
        }
        self.set(F::GroundCutShare, cell, share.clamp(0.0, 1.0))?;
        self.set(F::GroundCutDepth, cell, 0.0)?;
        self.project(cell)
    }
    pub fn share(&self, cell: usize, facet: Facet) -> io::Result<f64> {
        let cut = self.get(F::GroundCutShare, cell)?.clamp(0.0, 1.0);
        Ok(if facet == Facet::Cut { cut } else { 1.0 - cut })
    }
    pub fn rock_surface(&self, cell: usize, facet: Facet) -> io::Result<f64> {
        Ok(self.get(F::BedrockElevation, cell)?
            + (self.share(cell, Facet::Cut)? - if facet == Facet::Cut { 1.0 } else { 0.0 })
                * self.get(F::GroundCutDepth, cell)?)
    }
    pub fn cover_depth(&self, cell: usize, facet: Facet) -> io::Result<f64> {
        self.columns.thickness(cell, cover_column(facet))
    }
    pub fn surface(&self, cell: usize, facet: Facet) -> io::Result<f64> {
        Ok(self.rock_surface(cell, facet)? + self.cover_depth(cell, facet)?)
    }
    // Arconis: docs/architecture/subsystems.arconis#item=g_proj — projects a cell's columns to elevation and exposed rock.
    pub(super) fn project(&mut self, cell: usize) -> io::Result<()> {
        self.events.changed(cell)?;
        let share = self.share(cell, Facet::Cut)?;
        let land_cover = self.cover_depth(cell, Facet::Land)?;
        let cut_cover = if share > 0.0 {
            self.cover_depth(cell, Facet::Cut)?
        } else {
            0.0
        };
        let cover = (1.0 - share) * land_cover + share * cut_cover;
        let land = self.columns.read_layer(cell, Column::Land, 0)?;
        let cut = if share > 0.0 {
            self.columns.read_layer(cell, Column::Cut, 0)?
        } else {
            land.clone()
        };
        self.set(F::SedimentThickness, cell, cover)?;
        self.set(F::GroundCutCover, cell, cut_cover)?;
        self.set(
            F::Elevation,
            cell,
            self.get(F::BedrockElevation, cell)? + cover,
        )?;
        self.set(
            F::RockKindCodes,
            cell,
            if share > 0.5 { cut.kind } else { land.kind } as f64,
        )?;
        self.set(
            F::RockResistance,
            cell,
            land.material_strength(
                false,
                catalogue::kind_of_code(catalogue::ALLUVIUM)
                    .facts
                    .resistance,
            ) * (1.0 - share)
                + cut.material_strength(
                    false,
                    catalogue::kind_of_code(catalogue::ALLUVIUM)
                        .facts
                        .resistance,
                ) * share,
        )?;
        self.set(
            F::StructuralGrainX,
            cell,
            land.grain_x * (1.0 - share) + cut.grain_x * share,
        )?;
        self.set(
            F::StructuralGrainY,
            cell,
            land.grain_y * (1.0 - share) + cut.grain_y * share,
        )?;
        if let Some(reconcile) = &mut self.reconcile {
            reconcile(cell)?;
        }
        Ok(())
    }
    pub fn resolve_cut(&mut self, cell: usize, share: f64) -> io::Result<()> {
        if self.share(cell, Facet::Cut)? <= 0.0 {
            return Ok(());
        }
        let held = share.clamp(0.0, 1.0);
        self.set(
            F::BedrockElevation,
            cell,
            self.rock_surface(cell, Facet::Land)? - held * self.get(F::GroundCutDepth, cell)?,
        )?;
        self.set(F::GroundCutShare, cell, held)?;
        if held <= 0.0 {
            self.set(F::GroundCutDepth, cell, 0.0)?;
            self.set(F::GroundCutCover, cell, 0.0)?;
            for column in [Column::Cut, Column::CutLoose] {
                for slot in 0..column.size() {
                    self.columns
                        .set_layer(cell, column, slot, &MaterialLayer::default())?;
                }
            }
        }
        self.project(cell)
    }
    pub fn section(&self, cell: usize, facet: Facet) -> io::Result<Vec<SectionLayer>> {
        let share = self.share(cell, facet)?;
        let mut result = Vec::new();
        if share <= 0.0 {
            return Ok(result);
        }
        let mut top = self.surface(cell, facet)?;
        for column in [cover_column(facet), rock_column(facet)] {
            let last = self.columns.deepest(cell, column)?;
            for slot in 0..=last {
                let material = self.columns.read_layer(cell, column, slot)?;
                let basement = !column.finite() && slot == last;
                let bottom = top - material.depth;
                if (material.depth <= 0.0 || top == bottom) && !basement {
                    continue;
                }
                result.push(SectionLayer {
                    material,
                    top,
                    bottom,
                    share,
                    loose: column.finite(),
                    basement,
                });
                top = bottom;
            }
        }
        Ok(result)
    }
}
