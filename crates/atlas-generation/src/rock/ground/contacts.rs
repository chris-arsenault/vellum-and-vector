//! Captured complete beds resolve into the finer map's occupied facets.
use super::{placement::rock_column, Ground};
use crate::{
    rock::material::MaterialLayer,
    scale::{LengthUnit, MapScale},
    settlement::removal::Facet,
};
use std::io;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Reference {
    pub position: [f64; 2],
    pub land: f64,
    pub cut: f64,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Beds {
    pub land: Vec<MaterialLayer>,
    pub cut: Vec<MaterialLayer>,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Plan {
    pub cells: Vec<usize>,
    pub reference: Reference,
    pub beds: Beds,
}
impl Ground {
    pub fn capture_contact_beds(&self, cell: usize) -> io::Result<Beds> {
        let read = |facet| {
            let column = rock_column(facet);
            (0..=self.columns.deepest(cell, column)?)
                .map(|layer| self.columns.read_layer(cell, column, layer))
                .collect::<io::Result<Vec<_>>>()
        };
        Ok(Beds {
            land: read(Facet::Land)?,
            cut: read(Facet::Cut)?,
        })
    }
    pub fn realize_contacts(&mut self, plan: &Plan) -> io::Result<()> {
        // owner-direction(2026-11-12): what is inside a parent cell comes from the rock column, shaped by all the relevant processes.
        self.resolve_contacts(plan, Facet::Land, &plan.beds.land)?;
        self.resolve_contacts(plan, Facet::Cut, &plan.beds.cut)?;
        for &cell in &plan.cells {
            self.project(cell)?;
        }
        Ok(())
    }
    fn resolve_contacts(
        &mut self,
        plan: &Plan,
        facet: Facet,
        layers: &[MaterialLayer],
    ) -> io::Result<()> {
        let mut cells = Vec::new();
        let mut areas = Vec::new();
        for &cell in &plan.cells {
            let share = self.share(cell, facet)?;
            if share > 0.0 {
                cells.push(cell);
                areas.push(self.mesh.area(cell) * share);
            }
        }
        if cells.is_empty() || layers.len() < 2 {
            return Ok(());
        }
        let mut depths = self.projected_contacts(&cells, &plan.reference, facet, layers)?;
        allocate_beds(layers, &mut depths, &areas);
        for (at, &cell) in cells.iter().enumerate() {
            let mut resolved = Vec::new();
            for (bed, values) in depths.iter().enumerate() {
                if values[at] > 0.0 {
                    let mut layer = layers[bed].clone();
                    layer.depth = values[at];
                    resolved.push(layer);
                }
            }
            resolved.push(layers.last().expect("captured basement").clone());
            self.columns
                .write_column(cell, rock_column(facet), &resolved)?;
        }
        Ok(())
    }
    fn projected_contacts(
        &self,
        cells: &[usize],
        reference: &Reference,
        facet: Facet,
        layers: &[MaterialLayer],
    ) -> io::Result<Vec<Vec<f64>>> {
        let mut depths = vec![vec![0.0; cells.len()]; layers.len() - 1];
        for (at, &cell) in cells.iter().enumerate() {
            let [x, y] = self.mesh.position(cell);
            let dx = self
                .mesh
                .delta_x(x + self.mesh.origin()[0] - reference.position[0]);
            let dy = y + self.mesh.origin()[1] - reference.position[1];
            let mut top = self.rock_surface(cell, facet)?;
            let mut contact = if facet == Facet::Land {
                reference.land
            } else {
                reference.cut
            };
            for (bed, values) in depths.iter_mut().enumerate() {
                let layer = &layers[bed];
                contact -= layer.depth;
                let bottom = top.min(
                    contact
                        + MapScale::in_units(
                            layer.bed_slope_x * dx + layer.bed_slope_y * dy,
                            LengthUnit::Native,
                        ),
                );
                values[at] = top - bottom;
                top = bottom;
            }
        }
        Ok(depths)
    }
}
fn allocate_beds(layers: &[MaterialLayer], depths: &mut [Vec<f64>], areas: &[f64]) {
    let area: f64 = areas.iter().sum();
    for (bed, values) in depths.iter_mut().enumerate() {
        let wanted: f64 = values.iter().zip(areas).map(|(d, a)| d * a).sum();
        if wanted <= 0.0 {
            values.fill(layers[bed].depth);
        } else {
            for value in values {
                *value *= layers[bed].depth * area / wanted;
            }
        }
    }
}
