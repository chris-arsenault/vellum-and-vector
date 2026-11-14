use super::{
    code,
    components::{Component, Frame},
    crust_per_rock, ground, length, metres, read, Field, PhysicalContext, Settings, C, G, S,
};
use crate::{
    metric::smoothing::smooth, rock::ground::crust::ARC_CRUST_YIELD, scale::MapScale, storage::Band,
};
use std::io;
fn crust_height(field: &Field, thickness: f64, fraction: f64) -> io::Result<f64> {
    let f = fraction.clamp(0.0, 1.0);
    Ok(length(field, -0.00005 + 0.0001 * f)?
        + (thickness - length(field, 0.00025 + 0.00075 * f)?) * (300.0 + 400.0 * f) / 1000.0)
}
pub(super) fn add_root(field: &mut Field, cell: usize, volume: f64) -> io::Result<f64> {
    let before = metres(ground(field, G::CrustThickness, cell)?);
    let fraction = ground(field, G::CrustContinentalFraction, cell)? / 1000.0;
    let column = MapScale::in_units(
        volume / field.mesh.area(cell),
        crate::scale::LengthUnit::Native,
    );
    field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .add_continental_root(cell, column)?;
    let next =
        ground(field, G::CrustContinentalColumn, cell)? / ground(field, G::CrustThickness, cell)?;
    Ok(MapScale::native(
        crust_height(field, before + metres(column), next)?
            - crust_height(field, before, fraction)?,
    ))
}
pub(super) fn pile_up(field: &mut Field, p: &Settings) -> io::Result<()> {
    field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .initialize_crust()?;
    for cell in 0..field.mesh.len() {
        if code(field, C::TectonicBoundaryCodes, cell)? != 1 {
            continue;
        }
        let continent = ground(field, G::CrustContinentalFraction, cell)? / 1000.0;
        let returned = continent + (1.0 - continent) * ARC_CRUST_YIELD;
        let amount = read(field, S::TectonicStrain, cell)? / 1000.0 * p.orogenic_initial_shortening
            / p.orogenic_sheet_spacing
            * ground(field, G::CrustThickness, cell)?
            * returned;
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .accrue_root_reserve(cell, amount)?;
    }
    Ok(())
}
struct RootWeights {
    reserves: Vec<f64>,
    totals: Vec<f64>,
    weights: Band<f64>,
}
fn root_weights(
    field: &mut Field,
    p: &Settings,
    context: &PhysicalContext,
    components: &[Component],
    frame: &Frame,
) -> io::Result<RootWeights> {
    let mut reserves = vec![0.0; components.len()];
    let mut totals = vec![0.0; components.len()];
    let mut weights = field.coverage.get_mut().scratch(field.mesh.len(), 0.0);
    for cell in 0..field.mesh.len() {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id < 0 || components[id as usize].code != 1 {
            continue;
        }
        let id = id as usize;
        let area = field.mesh.area(cell);
        reserves[id] += metres(ground(field, G::CrustRootReserve, cell)?) * area;
        if ground(field, G::CrustContinentalFraction, cell)? < 350.0
            && components[id].maximum_continental >= 0.35
        {
            continue;
        }
        let weight = super::shape::weight(field, p, context, &components[id], frame, cell)? * area;
        if weight > 0.0 {
            weights.set(cell, weight)?;
            totals[id] += weight;
        }
    }
    Ok(RootWeights {
        reserves,
        totals,
        weights,
    })
}
pub(super) fn distribute(
    field: &mut Field,
    p: &Settings,
    context: &PhysicalContext,
    components: &[Component],
    frame: &Frame,
) -> io::Result<Band<f64>> {
    let RootWeights {
        reserves,
        totals,
        weights,
    } = root_weights(field, p, context, components, frame)?;
    let mut admitted = field.coverage.get_mut().scratch(field.mesh.len(), 0.0);
    for cell in 0..field.mesh.len() {
        let weight = weights.get(cell)?;
        if weight <= 0.0 {
            continue;
        }
        let id = code(field, C::OrogenicComponentIds, cell)? as usize;
        if reserves[id] <= 0.0 {
            continue;
        }
        let volume = reserves[id] * weight / totals[id];
        if volume > 0.0 {
            admitted.set(cell, admitted.get(cell)? + add_root(field, cell, volume)?)?;
        }
    }
    for cell in 0..field.mesh.len() {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        if id >= 0 && totals[id as usize] > 0.0 {
            field
                .ground
                .try_borrow_mut()
                .map_err(io::Error::other)?
                .retain_root_reserve(cell, 0.0)?;
        }
    }
    settle_stranded(field, components, context.span)?;
    Ok(admitted)
}
fn settle_stranded(field: &mut Field, components: &[Component], span: f64) -> io::Result<()> {
    let settled = 1.0 - 0.5f64.powf(span);
    for cell in 0..field.mesh.len() {
        let id = code(field, C::OrogenicComponentIds, cell)?;
        let held = ground(field, G::CrustRootReserve, cell)?;
        if held <= 0.0 || (id >= 0 && components[id as usize].code == 1) {
            continue;
        }
        let column = held * settled;
        if column <= 0.0 {
            continue;
        }
        add_root(field, cell, metres(column) * field.mesh.area(cell))?;
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .spend_root_reserve(cell, column)?;
    }
    Ok(())
}
pub(super) fn flow(
    field: &mut Field,
    p: &Settings,
    context: &PhysicalContext,
    squeezed: impl Fn(&Field, usize) -> io::Result<bool>,
) -> io::Result<()> {
    let n = field.mesh.len();
    let mut continent = field.coverage.get_mut().scratch(n, 0u8);
    let mut flowing = field.coverage.get_mut().scratch(n, 0.0);
    for cell in 0..n {
        let fraction = ground(field, G::CrustContinentalFraction, cell)?;
        continent.set(cell, u8::from(fraction >= 350.0))?;
        if fraction < 350.0 {
            continue;
        }
        let fraction = fraction / 1000.0;
        let column = metres(ground(field, G::CrustThickness, cell)?);
        let rock = metres(ground(field, G::SurfaceRockLoad, cell)?).max(0.0);
        let support = if squeezed(field, cell)? {
            p.crust_flow_yield
        } else {
            0.0
        };
        let over = column + rock * crust_per_rock(fraction)
            - (length(field, 0.00025 + 0.00075 * fraction.clamp(0.0, 1.0))? + support);
        if over > 0.0 && context.span > 0.0 {
            flowing.set(
                cell,
                column.max(0.0).min(
                    over * (1.0
                        - (p.crust_flow_ease / (over + p.crust_flow_ease)).powf(context.span)),
                ),
            )?;
        }
    }
    let spread = smooth(
        &field.mesh,
        field.coverage.get_mut(),
        &flowing.read_only(),
        p.crust_flow_length * context.span.sqrt(),
        Some(&continent.read_only()),
    )?;
    let mut ground = field.ground.try_borrow_mut().map_err(io::Error::other)?;
    for cell in 0..n {
        let change = spread.get(cell)? - flowing.get(cell)?;
        if change != 0.0 {
            let next = MapScale::native(
                (metres(ground.view(G::CrustThickness).get(cell)?) + change).max(0.0),
            );
            ground.adjust_crust(cell, next)?;
        }
    }
    Ok(())
}
