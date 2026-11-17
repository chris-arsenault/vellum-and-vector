use super::{channels::Quantity, values::Values, Surface};
use crate::{
    field::Field,
    magic::{
        channels::Quantity as MagicQuantity,
        projection::{self, Projector},
        workspace::Workspace,
    },
};
use std::io;

struct Projection<'a> {
    surface: &'a mut Surface,
    field: &'a Field,
}
impl Projector for Projection<'_> {
    fn channel(
        &mut self,
        name: &str,
        unit: &'static str,
        quantity: MagicQuantity,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<()> {
        let quantity = match quantity {
            MagicQuantity::Intensive => Quantity::Intensive,
            MagicQuantity::Extensive => Quantity::Extensive,
            MagicQuantity::Category => Quantity::Category,
        };
        let mut values = Values::F64(self.surface.coverage.allocate(0.0));
        let density = |cell| {
            if quantity != Quantity::Extensive {
                return read(cell);
            }
            let area = self.field.mesh.area(cell);
            Ok(if area > 0.0 { read(cell)? / area } else { 0.0 })
        };
        self.surface.interpolation.project(
            &density,
            quantity == Quantity::Category,
            |start, block| values.write(start, block),
        )?;
        if quantity == Quantity::Extensive {
            let projected = values.read();
            for start in (0..projected.len()).step_by(4096) {
                let end = (start + 4096).min(projected.len());
                let block = (start..end)
                    .map(|cell| Ok(projected.get(cell)? * self.surface.grid.measures.get(cell)?))
                    .collect::<io::Result<Vec<_>>>()?;
                values.write(start, &block)?;
            }
        }
        self.surface.put(name, unit, quantity, values);
        Ok(())
    }
}
impl Surface {
    pub fn project_magic(&mut self, field: &Field, workspace: &Workspace) -> io::Result<()> {
        projection::project(
            workspace,
            field,
            &mut Projection {
                surface: self,
                field,
            },
        )?;
        if let Some(support) = &mut self.support {
            support.project(
                &self.grid,
                field.mesh(),
                &workspace.surfaces,
                &mut self.coverage,
            )?;
        } else {
            self.support = Some(super::support::Support::capture(
                &self.grid,
                field.mesh(),
                &workspace.surfaces,
                &mut self.coverage,
            )?);
        }
        Ok(())
    }
}
