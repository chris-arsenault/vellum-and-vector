mod growth;
mod realization;
pub mod settings;
use super::{
    shared::{FloatField as F, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError, Query, QueryValue},
    lattice::TriangularLattice,
    noise::hash_unit,
    processes::runner::PhysicalContext,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, ReadBand},
    tectonics::sources::{area_budget, medium_area, world_candidates},
};
use settings::Settings;
use std::{io, rc::Rc};

#[derive(Clone)]
pub struct Fault {
    pub id: String,
    pub coordinates: Vec<[f64; 2]>,
    pub width: f64,
}
impl QueryValue for Fault {}
struct Work<'a> {
    mesh: &'a TriangularLattice,
    conductance: &'a mut Band<f64>,
    faults: &'a mut Vec<Fault>,
    strain: ReadBand<f64>,
    settings: &'a Settings,
    context: &'a PhysicalContext,
    noise_span: f64,
}
fn length(scale: MapScale, value: f64) -> io::Result<f64> {
    Ok(scale
        .resolve(RelativeMeasure::length(value).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
fn prepare(work: &mut Work<'_>, forming: bool) -> io::Result<()> {
    let p = work.settings;
    let keep = if forming {
        1.0
    } else {
        (p.fracture_retention_per_span / 1000.0).powf(work.context.span)
    };
    for cell in 0..work.mesh.len() {
        let floor = p.fracture_conductance_floor;
        work.conductance.set(
            cell,
            floor.max((floor + (work.conductance.get(cell)? - floor) * keep).round()),
        )?;
    }
    Ok(())
}
fn separated_root(
    candidates: &[[f64; 2]],
    roots: &[[f64; 2]],
    branch: usize,
    minimum: f64,
) -> [f64; 2] {
    let skip = branch % (candidates.len() / 8).max(1);
    candidates[skip..]
        .iter()
        .find(|point| {
            roots
                .iter()
                .all(|root| (point[0] - root[0]).hypot(point[1] - root[1]) >= minimum)
        })
        .copied()
        .unwrap_or(candidates[branch % candidates.len()])
}
fn network(work: &mut Work<'_>, field: &Field) -> io::Result<()> {
    prepare(work, field.crust_forming())?;
    let area = field
        .scale
        .resolve(RelativeMeasure::new(0.75, 2, 1.0, LengthUnit::Metre).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let count = if work.context.tectonic_strength == 0.0 {
        0
    } else {
        area_budget(
            work.settings.fracture_branch_count * work.context.tectonic_strength / 1000.0,
            medium_area(work.mesh),
            area,
        )
    };
    if count == 0 {
        return Ok(());
    }
    let uplift = field.shared.float(F::Uplift);
    let ridge = field.shared.float(F::RidgeInfluence);
    let candidates = world_candidates(
        work.mesh,
        work.context.seed,
        count
            .checked_mul(256)
            .ok_or_else(|| io::Error::other("Fracture candidates exceed address space"))?
            .max(1024),
    );
    let mut ranked = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let cell = work
            .mesh
            .cell_at(candidate.position[0], candidate.position[1])
            .ok_or_else(|| io::Error::other("Fracture candidate lies outside the lattice"))?;
        let score = work.strain.get(cell)? * 0.48
            + f64::from(uplift.get(cell)?) * 310.0
            + f64::from(ridge.get(cell)?) * 120.0
            + candidate.priority * 90.0;
        ranked.push((candidate.position, score));
    }
    // hpc-exempt: seeded world candidates are ranked once, as in the source process.
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let points: Vec<_> = ranked.into_iter().map(|c| c.0).collect();
    let mut nodes = Vec::new();
    let mut roots = Vec::new();
    for branch in 0..count {
        let root = if branch > 0 && branch % 3 == 0 && !nodes.is_empty() {
            nodes[(hash_unit(work.context.seed ^ 0x29f1, branch as f64, 0.0) * nodes.len() as f64)
                .trunc() as usize
                % nodes.len()]
        } else {
            separated_root(
                &points,
                &roots,
                branch,
                work.settings.fracture_minimum_spacing,
            )
        };
        roots.push(root);
        growth::grow(work, root, branch, &mut nodes)?;
    }
    Ok(())
}
fn failure(e: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(e.to_string())
}
impl Field {
    pub fn faults(&self) -> &[Fault] {
        &self.faults
    }
    fn plan_fractures(&self, p: &Settings, c: &PhysicalContext) -> io::Result<Vec<Fault>> {
        let mut conductance = self.coverage.borrow_mut().allocate(0.0);
        let source = self.shared.scalar(S::FractureConductance);
        for cell in 0..self.mesh.len() {
            conductance.set(cell, source.get(cell)?)?;
        }
        let mut faults = self.faults.clone();
        network(
            &mut Work {
                mesh: &self.mesh,
                conductance: &mut conductance,
                faults: &mut faults,
                strain: self.shared.scalar(S::TectonicStrain),
                settings: p,
                context: c,
                noise_span: length(self.scale, 0.0025)?,
            },
            self,
        )?;
        Ok(faults.split_off(self.faults.len()))
    }
    pub fn planned_fractures(settings: Rc<Settings>) -> Query<Self, Vec<Fault>> {
        Query::new("planned-fractures", vec![], move |field: &Field, scope| {
            let context = scope.input::<PhysicalContext>()?;
            field.plan_fractures(&settings, &context).map_err(failure)
        })
    }
    pub fn fracture_network(settings: Rc<Settings>) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "fracture-network",
            CommandKind::Work,
            vec![],
            move |scope, context| {
                let field: &mut Field = scope.state_mut();
                let mut faults = std::mem::take(&mut field.faults);
                let result = {
                    let mut conductance = field.shared.derive_scalar(S::FractureConductance);
                    network(
                        &mut Work {
                            mesh: &field.mesh,
                            conductance: &mut conductance,
                            faults: &mut faults,
                            strain: field.shared.scalar(S::TectonicStrain),
                            settings: &settings,
                            context,
                            noise_span: length(field.scale, 0.0025).map_err(failure)?,
                        },
                        field,
                    )
                };
                field.faults = faults;
                result.map_err(failure)
            },
        )
    }
    pub fn apply_planned_fractures(
        settings: Rc<Settings>,
    ) -> Command<Self, (PhysicalContext, Vec<Fault>)> {
        Command::with_inputs(
            "apply-planned-fractures",
            CommandKind::Work,
            vec![],
            move |scope, (context, faults): &(PhysicalContext, Vec<Fault>)| {
                let field: &mut Field = scope.state_mut();
                let forming = field.crust_forming();
                let noise_span = length(field.scale, 0.0025).map_err(failure)?;
                let strain = field.shared.scalar(S::TectonicStrain);
                let mut work = Work {
                    mesh: &field.mesh,
                    conductance: field.shared.scalar_mut(S::FractureConductance),
                    faults: &mut field.faults,
                    strain,
                    settings: &settings,
                    context,
                    noise_span,
                };
                apply(&mut work, faults, forming).map_err(failure)
            },
        )
    }
}
fn apply(work: &mut Work<'_>, faults: &[Fault], forming: bool) -> io::Result<()> {
    prepare(work, forming)?;
    for (branch, fault) in faults.iter().enumerate() {
        let mut distance = 0.0;
        for (index, &point) in fault.coordinates.iter().enumerate() {
            if index > 0 {
                let previous = fault.coordinates[index - 1];
                distance += (point[0] - previous[0]).hypot(point[1] - previous[1]);
            }
            let strength = 760.0
                + (hash_unit(
                    work.context.seed,
                    branch as f64,
                    (distance / work.noise_span).floor(),
                ) * 240.0)
                    .trunc();
            growth::widen(work, point, fault.width, strength)?;
        }
        work.faults.push(fault.clone());
    }
    Ok(())
}
