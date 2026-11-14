mod components;
mod reactivation;
mod roots;
pub mod settings;
mod shape;
mod sheets;
use super::{
    shared::{CellCode as C, Scalar as S},
    Field,
};
use crate::{
    execution::{Command, CommandKind, ExecutionError},
    processes::runner::PhysicalContext,
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale, RelativeMeasure},
};
use settings::Settings;
use std::{io, rc::Rc};
fn read(field: &Field, name: S, cell: usize) -> io::Result<f64> {
    field.shared.scalar(name).get(cell)
}
fn code(field: &Field, name: C, cell: usize) -> io::Result<i32> {
    field.shared.code(name).get(cell)
}
fn ground(field: &Field, name: G, cell: usize) -> io::Result<f64> {
    field.ground().view(name).get(cell)
}
fn metres(value: f64) -> f64 {
    MapScale::metres(value, LengthUnit::Native)
}
fn sign(value: f64) -> f64 {
    if value == 0.0 {
        0.0
    } else {
        value.signum()
    }
}
fn crust_per_rock(fraction: f64) -> f64 {
    (1.0 - 0.8) / ((300.0 + 400.0 * fraction.clamp(0.0, 1.0)) / 1000.0)
}
fn length(field: &Field, fraction: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
fn record_activity(field: &mut Field, p: &Settings, cell: usize, admitted: f64) -> io::Result<()> {
    let value = metres(admitted).round();
    let band = field.shared.scalar_mut(S::TectonicActivityHistory);
    band.set(cell, (band.get(cell)? + value.abs()).min(2147483647.0))?;
    if value <= 0.0 {
        return Ok(());
    }
    let uplift = value / (field.mesh.spacing() * p.thrust_ramp_gradient).max(1.0);
    let band = field.shared.float_mut(super::shared::FloatField::Uplift);
    band.set(cell, f64::from(band.get(cell)?).max(uplift) as f32)?;
    let band = field
        .shared
        .float_mut(super::shared::FloatField::RidgeInfluence);
    band.set(
        cell,
        f64::from(band.get(cell)?).max((uplift * 1.3).clamp(0.0, 1.0)) as f32,
    )
}
fn construct(field: &mut Field, p: &Settings, context: &PhysicalContext) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        field
            .shared
            .code_mut(C::OrogenicComponentIds)
            .set(cell, -1)?;
        field
            .shared
            .scalar_mut(S::OrogenicConstruction)
            .set(cell, 0.0)?;
    }
    if context.tectonic_strength <= 0.0 || context.span <= 0.0 {
        return Ok(());
    }
    let mut ids = field.coverage.get_mut().scratch(field.mesh.len(), -1);
    let mut components = components::discover(field, p, context, &mut ids)?;
    let mut frame = components::influence(field, p, &components, &ids)?;
    sheets::advance(field, p, &mut components, &frame)?;
    let climb = sheets::slip(field, p, context, &components, &mut frame)?;
    if !field.crust_formed {
        roots::pile_up(field, p)?;
    }
    let roots = roots::distribute(field, p, context, &components, &frame)?;
    let mut surface = field.coverage.get_mut().scratch(field.mesh.len(), 0.0);
    sheets::climb(field, p, components.len(), &climb)?;
    for cell in 0..field.mesh.len() {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id < 0 || components[id as usize].code != 1 {
            continue;
        }
        let c = &components[id as usize];
        let source = frame.source.get(cell)? as usize;
        let section = shape::cross_section(field, c, &frame, cell)?;
        let admitted = roots.get(cell)?;
        field
            .shared
            .scalar_mut(S::OrogenicConstruction)
            .set(cell, admitted)?;
        record_activity(field, p, cell, admitted)?;
        let value = metres(admitted).round();
        if value <= 0.0 {
            continue;
        }
        let tx = read(field, S::TectonicTangentX, source)? / 1000.0;
        let ty = read(field, S::TectonicTangentY, source)? / 1000.0;
        if tx.hypot(ty) >= 0.01 {
            field
                .ground
                .try_borrow_mut()
                .map_err(io::Error::other)?
                .deform(cell, [tx, ty], 1.0, admitted)?;
        }
        let fraction = ground(field, G::CrustContinentalFraction, cell)? / 1000.0;
        if fraction < 0.35 {
            continue;
        }
        let crest = (section / shape::CREST).clamp(0.0, 1.0);
        let buoyancy = (300.0 + 400.0 * fraction.clamp(0.0, 1.0)) / 1000.0;
        let rock = value / buoyancy / crust_per_rock(fraction) * p.orogenic_rock_share;
        surface.set(
            cell,
            MapScale::native(
                rock * (0.2 + crest * 0.8) * shape::summit(field, p, context, c, cell, source)?,
            ),
        )?;
    }
    field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .raise_field(&surface.read_only(), "mountains", field.coverage.get_mut())?;
    shape::fault_blocks(field, p)?;
    if field.crust_formed {
        reactivation::run(field, p, context)?;
    }
    Ok(())
}
fn relax(field: &mut Field, p: &Settings, context: &PhysicalContext) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        field
            .shared
            .code_mut(C::OrogenicComponentIds)
            .set(cell, -1)?;
    }
    let mut ids = field.coverage.get_mut().scratch(field.mesh.len(), -1);
    let components = components::discover(field, p, context, &mut ids)?;
    let _frame = components::influence(field, p, &components, &ids)?;
    roots::flow(field, p, context, |field, cell| {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        Ok(context.tectonic_strength > 0.0
            && id >= 0
            && components[id as usize].code == 1
            && sheets::in_belt(field, &components[id as usize], cell)?)
    })
}
impl Field {
    pub fn orogenic_construction(settings: Rc<Settings>) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "orogenic-construction",
            CommandKind::Event,
            vec![],
            move |scope, context| {
                construct(scope.state_mut(), &settings, context)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
    pub fn relax_orogenic_crust(settings: Rc<Settings>) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "relax-orogenic-crust",
            CommandKind::Event,
            vec![],
            move |scope, context| {
                relax(scope.state_mut(), &settings, context)
                    .map_err(|e| ExecutionError::Failed(e.to_string()))
            },
        )
    }
}
