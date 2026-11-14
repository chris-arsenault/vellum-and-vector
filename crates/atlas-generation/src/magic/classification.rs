use super::{
    confluences::Workspace, regions::independent_interaction, state::MagicField, surface::Surfaces,
};
use crate::storage::{Band, Coverage};
use std::io;
pub const MAGIC_SURFACE_BASE: i32 = 100;
pub const SECOND_SURFACE_FLOOR: f64 = 0.2;
struct Ranking {
    held: Band<f64>,
    priority: Band<f64>,
    second: Band<f64>,
}
impl Ranking {
    fn paint(
        &mut self,
        surfaces: &mut Surfaces,
        code: i32,
        priority: f64,
        members: &Band<f64>,
        shares: &Band<f64>,
    ) -> io::Result<()> {
        for cell in 0..members.len() {
            let share = shares.get(cell)?;
            if members.get(cell)? <= 0.0 || share <= 0.0 {
                continue;
            }
            self.place(surfaces, cell, code, priority, share)?;
        }
        Ok(())
    }
    fn place(
        &mut self,
        surfaces: &mut Surfaces,
        cell: usize,
        code: i32,
        priority: f64,
        share: f64,
    ) -> io::Result<()> {
        let current = self.held.get(cell)?;
        if share > current || (share == current && priority > self.priority.get(cell)?) {
            if current >= SECOND_SURFACE_FLOOR {
                surfaces
                    .second
                    .set(cell, surfaces.final_surface.get(cell)?)?;
                self.second.set(cell, current)?;
            }
            surfaces.final_surface.set(cell, code)?;
            self.held.set(cell, share)?;
            self.priority.set(cell, priority)?;
        } else if share > self.second.get(cell)? && share >= SECOND_SURFACE_FLOOR {
            surfaces.second.set(cell, code)?;
            self.second.set(cell, share)?;
        }
        Ok(())
    }
}
pub fn paint(
    surfaces: &mut Surfaces,
    fields: &[MagicField],
    meetings: &Workspace,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let count = surfaces.natural.len();
    let mut ranking = Ranking {
        held: coverage.scratch(count, f64::NEG_INFINITY),
        priority: coverage.scratch(count, f64::NEG_INFINITY),
        second: coverage.scratch(count, 0.0),
    };
    for cell in 0..count {
        surfaces.second.set(cell, -1)?;
    }
    let mut code = MAGIC_SURFACE_BASE;
    for field in fields {
        for (rule, state) in field.definition.features.iter().zip(&field.features) {
            if field.definition.enabled || independent_interaction(rule, &field.definition.id) {
                ranking.paint(
                    surfaces,
                    code,
                    rule.priority,
                    &state.members,
                    &state.coverage,
                )?;
            }
            code += 1;
        }
    }
    for state in &meetings.states {
        let definition = &meetings.definitions[state.definition];
        ranking.paint(
            surfaces,
            code + state.definition as i32,
            definition.rule.priority,
            &state.members,
            &state.coverage,
        )?;
    }
    Ok(())
}
