use super::{
    catalogue::Catalogue,
    effect_declarations::{self, Changes, Declared, Material, WaterWork},
    ground_targets::{self, Request, Target},
    values::{MagicBand, MagicChannel, PhysicalChange},
};
use crate::{
    execution::{CommandContext, ExecutionResult},
    field::{
        contributions::{Contributions, Medium},
        people::land_events::Struck,
        refinement::grading,
        shared::Scalar,
        Field,
    },
    hpc::BitSet,
    lattice::Membership,
    magic::{channels::Channel, place_effects, state::MagicField},
    storage::Band,
};
use std::io;

pub fn event_changes<S, Schedule>(
    catalogue: &Catalogue<S, Schedule>,
    state: &S,
    event: &Struck,
) -> io::Result<Vec<PhysicalChange>> {
    let mut changes = Vec::new();
    for entry in catalogue.entries() {
        if let Some(command) = &entry.event {
            if (command.accepts)(event) {
                changes.extend((command.changes)(state, event)?);
            }
        }
    }
    Ok(changes)
}
pub struct Operations {
    ground: ground_targets::Operations,
    people: crate::human::operations::Operations<Field>,
}
impl Default for Operations {
    fn default() -> Self {
        Self::new()
    }
}
impl Operations {
    pub fn new() -> Self {
        Self {
            ground: ground_targets::Operations::new(),
            people: Field::human_operations(),
        }
    }
    pub fn event(
        &self,
        context: &mut CommandContext<'_, Field>,
        changes: &[PhysicalChange],
    ) -> ExecutionResult<()> {
        for change in changes {
            let mut target = Target::default();
            target.take(change.change);
            match effect_declarations::material(&change.band)? {
                Material::Ground(band) => context.run(
                    &self.ground.execute,
                    &Request {
                        band,
                        cell: change.cell,
                        target,
                    },
                )?,
                Material::Shared(medium) => {
                    let current = medium.read(context.state(), change.cell)?;
                    medium.write(context.state_mut(), change.cell, target.next(current))?;
                }
            }
        }
        Ok(())
    }
    pub fn declare(
        &self,
        context: &mut CommandContext<'_, Field>,
        declared: &Declared,
        ledger: &mut Contributions,
    ) -> ExecutionResult<()> {
        context.run(
            &self.people.maintain_lines,
            &declared.kept_lines.kept_line_targets(),
        )?;
        for (band, cells) in &declared.bands {
            for &cell in &cells.cells {
                let target = cells.at(cell)?;
                match band {
                    Material::Ground(band) => context.run(
                        &self.ground.realize,
                        &Request {
                            band: *band,
                            cell,
                            target,
                        },
                    )?,
                    Material::Shared(medium) => {
                        let field = context.state_mut();
                        let base = medium.read(field, cell)? - ledger.applied_to(*medium, cell)?;
                        ledger.add(
                            *medium,
                            cell,
                            target.next(base) - base,
                            field.coverage.get_mut(),
                        )?;
                    }
                }
            }
        }
        let mut water = context.state_mut().water.borrow_mut();
        for work in &declared.water_works {
            match *work {
                WaterWork::HoldSurface { cell, surface } => water.hold_surface(cell, surface)?,
                WaterWork::ShoalBed { cell, depth } => water.shoal_bed(cell, depth)?,
            }
        }
        Ok(())
    }
    pub fn cycle(
        &self,
        context: &mut CommandContext<'_, Field>,
        declared: &Declared,
        ledger: &mut Contributions,
    ) -> ExecutionResult<()> {
        ledger.begin()?;
        for name in [
            Scalar::Temperature,
            Scalar::Moisture,
            Scalar::Rainfall,
            Scalar::Slope,
        ] {
            ledger.forget(Medium::Shared(name));
        }
        self.declare(context, declared, ledger)?;
        ledger.commit(context.state_mut(), Medium::bounds)?;
        Ok(())
    }
}
struct Applied {
    target: MagicBand,
    cells: Vec<usize>,
    marked: BitSet,
    values: Band<f64>,
}
#[derive(Default)]
pub struct MagicContributions {
    applied: Vec<Applied>,
}
fn magic_target(band: &MagicBand) -> place_effects::Target<'_> {
    match band {
        MagicBand::Stock { stock, .. } => place_effects::Target::Stock(stock),
        MagicBand::Channel { channel, .. } => place_effects::Target::Channel(match channel {
            MagicChannel::Intensity => Channel::Intensity,
            MagicChannel::Source => Channel::Source,
            MagicChannel::History => Channel::History,
            MagicChannel::Wild => Channel::Wild,
            MagicChannel::Stored => Channel::Stored,
        }),
    }
}
impl MagicContributions {
    pub fn apply(
        &mut self,
        field: &mut Field,
        fields: &mut [MagicField],
        declared: &Declared,
    ) -> io::Result<()> {
        for (target, changes) in &declared.magic {
            let system = match target {
                MagicBand::Channel { system, .. } | MagicBand::Stock { system, .. } => system,
            };
            let Some(magic) = fields.iter_mut().find(|f| f.definition().id == *system) else {
                continue;
            };
            let at = self
                .applied
                .iter()
                .position(|a| a.target == *target)
                .unwrap_or_else(|| {
                    self.applied.push(Applied {
                        target: target.clone(),
                        cells: Vec::new(),
                        marked: BitSet::new(field.mesh.len()),
                        values: field.coverage.get_mut().allocate(0.0),
                    });
                    self.applied.len() - 1
                });
            let applied = &mut self.applied[at];
            for &cell in &changes.cells {
                if !applied.marked.has(cell) {
                    applied.marked.add(cell);
                    applied.cells.push(cell);
                }
            }
            let mut ground = field.ground.borrow_mut();
            for &cell in &applied.cells {
                let desired = if changes.contains(cell) {
                    changes.at(cell)?
                } else {
                    Target::default()
                };
                if let Some(total) = magic.replace_place_contribution(
                    &mut ground,
                    magic_target(target),
                    cell,
                    applied.values.get(cell)?,
                    |base| desired.next(base),
                )? {
                    applied.values.set(cell, total)?;
                }
            }
        }
        Ok(())
    }
}
/// A requested grade applies to faces, including each neighboring dry content cell.
pub fn grade_places(
    field: &mut Field,
    grades: &Changes,
    channel: &[u8],
    basin: &[u8],
) -> io::Result<()> {
    let water = field.water().column.kind;
    let dry = |cell| -> io::Result<bool> {
        Ok(field.mesh.membership(cell) == Membership::Content && water.get(cell)? == 0)
    };
    let mut targets = Vec::new();
    let mut index = vec![usize::MAX; field.mesh.len()];
    for &cell in &grades.cells {
        if dry(cell)? {
            index[cell] = targets.len();
            targets.push(grading::Target {
                cell,
                gradient: grades.at(cell)?.at_most,
            });
        }
    }
    let original = targets.len();
    for at in 0..original {
        let cell = targets[at].cell;
        let gradient = grades.at(cell)?.at_most;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if !dry(next)? {
                continue;
            }
            if index[next] == usize::MAX {
                index[next] = targets.len();
                targets.push(grading::Target {
                    cell: next,
                    gradient,
                });
            } else {
                let value = &mut targets[index[next]].gradient;
                *value = value.min(gradient);
            }
        }
    }
    field.grade_ground(&targets, channel, basin)
}
