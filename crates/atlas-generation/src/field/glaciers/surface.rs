use super::Settings;
use crate::{
    field::{
        shared::{CellCode as C, Flag, Scalar as S, SharedFields},
        Field,
    },
    rock::ground::{Ground, GroundField},
    scale::MapScale,
    storage::ReadBand,
    water::{column::Store, WaterView},
};
use std::io;
pub fn respond(
    book: &mut crate::answers::QuestionBook<Field, &'static str>,
) -> crate::execution::ExecutionResult<()> {
    book.respond(
        "iceBite",
        crate::answers::Responder {
            by: "plain ice".into(),
            queries: vec![],
            kind: crate::answers::ResponseKind::Base(Box::new(|_, _, _| Ok(1.0))),
        },
    )
}
pub struct Surface {
    elevation: ReadBand<f64>,
    ice: ReadBand<f64>,
    targets: ReadBand<i32>,
    flux: ReadBand<f64>,
    column: crate::water::column::WaterColumnView,
    sea_level: f64,
}
impl Surface {
    pub fn new(ground: &Ground, shared: &SharedFields, water: &WaterView) -> Self {
        Self {
            elevation: ground.view(GroundField::Elevation),
            ice: shared.scalar(S::IceThickness),
            targets: shared.code(C::IceFlowTargets),
            flux: shared.scalar(S::IceFlux),
            column: water.column.clone(),
            sea_level: water.effective_sea_level,
        }
    }
    pub fn support(&self, cell: usize) -> io::Result<f64> {
        if self.column.kind.get(cell)? == 0 {
            self.elevation.get(cell)
        } else {
            self.column.surface.get(cell)
        }
    }
    pub fn carries(&self, cell: usize) -> io::Result<bool> {
        Ok(matches!(self.column.kind.get(cell)?, 0 | 2))
    }
    pub fn grounded(&self, cell: usize, p: &Settings) -> io::Result<bool> {
        let ice = self.ice.get(cell)?;
        let water = self.column.kind.get(cell)?;
        if ice <= 0.0 || water == 1 {
            return Ok(false);
        }
        Ok(water == 0
            || (MapScale::native(ice) * p.glacier_grounding_fraction / 1000.0).trunc()
                >= self.column.store(Store::Standing).contents().get(cell)?)
    }
    pub fn speed(&self, cell: usize, spacing: f64) -> io::Result<f64> {
        let ice = self.ice.get(cell)?;
        Ok(if ice > 0.0 && self.targets.get(cell)? >= 0 {
            self.flux.get(cell)? / (ice * spacing)
        } else {
            0.0
        })
    }
    pub fn can_cut(&self, cell: usize, p: &Settings) -> io::Result<f64> {
        let Some(target) = usize::try_from(self.targets.get(cell)?).ok() else {
            return Ok(0.0);
        };
        let ice = MapScale::native(self.ice.get(cell)?);
        let water = if self.column.kind.get(cell)? == 2 {
            self.support(cell)?
        } else {
            self.sea_level
        };
        let floats = water - (ice * p.glacier_grounding_fraction / 1000.0).trunc();
        let there = self.support(target)? + MapScale::native(self.ice.get(target)?);
        Ok((self.elevation.get(cell)? - floats)
            .min(self.support(cell)? + ice - there)
            .max(0.0))
    }
}
pub fn refresh(field: &mut Field, p: &Settings) -> io::Result<()> {
    let surface = Surface::new(&field.ground(), &field.shared, &field.water());
    for cell in 0..field.mesh.len() {
        field
            .shared
            .flag_mut(Flag::GroundedIce)
            .set(cell, u8::from(surface.grounded(cell, p)?))?;
    }
    Ok(())
}
