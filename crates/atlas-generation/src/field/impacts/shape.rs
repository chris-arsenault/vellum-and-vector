use super::{settings::Settings, Field, C, S};
use crate::{
    rock::catalogue,
    scale::{LengthUnit, MapScale},
    settlement::stage::Pool,
    water::column::Store,
};
use std::io;

fn excavate(
    field: &mut Field,
    cell: usize,
    distance: f64,
    radius: f64,
    depth: f64,
) -> io::Result<f64> {
    if distance > radius {
        return Ok(0.0);
    }
    let requested = MapScale::native(depth * (1.0 - (distance / radius).powi(2))).max(1.0);
    let excavated = field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .excavate_rock(cell, requested, "impacts", Pool::Space, &mut |_| Ok(()))?;
    let band = field.shared.scalar_mut(S::ImpactExcavation);
    band.set(cell, band.get(cell)? + excavated)?;
    Ok(excavated)
}
fn raise_rim(
    field: &mut Field,
    cell: usize,
    distance: f64,
    radius: f64,
    height: f64,
) -> io::Result<()> {
    let influence = 1.0 - (distance / radius - 1.0).abs() / 0.34;
    if influence <= 0.0 {
        return Ok(());
    }
    let uplift = MapScale::native(height * influence).max(0.0);
    field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .displace(cell, uplift, "impacts")?;
    let band = field.shared.scalar_mut(S::ImpactRimUplift);
    band.set(cell, band.get(cell)? + uplift)
}
fn shock(
    field: &mut Field,
    p: &Settings,
    cell: usize,
    distance: f64,
    radius: f64,
    share: f64,
) -> io::Result<()> {
    let influence = 1.0 - distance / (radius * 1.45);
    if influence > 0.0 {
        let band = field.shared.scalar_mut(S::FractureConductance);
        band.set(
            cell,
            band.get(cell)?
                .max((p.impact_fracture_strength * influence).round()),
        )?;
    }
    if radius >= p.impact_thermal_radius_threshold && distance <= radius {
        let band = field.shared.scalar_mut(S::ImpactHeat);
        band.set(
            cell,
            band.get(cell)?
                .max((1000.0 * (1.0 - distance / radius)).round()),
        )?;
    }
    if distance > radius * 1.15 || share <= 0.0 {
        return Ok(());
    }
    let gain = 1600.0 * (1.0 - distance / (radius * 1.15).max(0.001)) * share;
    field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .harden_rock(
            cell,
            catalogue::IMPACTITE,
            catalogue::kind_of_code(catalogue::STRATA).facts.resistance + gain.round(),
        )
}
fn ejecta(
    field: &mut Field,
    p: &Settings,
    cells: &[usize],
    weights: &[f64],
    excavation: f64,
) -> io::Result<f64> {
    let mut remaining = (excavation * p.impact_ejecta_fraction / 1000.0).trunc();
    let mut total: f64 = weights.iter().sum();
    let mut deposited = 0.0;
    for (&cell, &weight) in cells.iter().zip(weights) {
        if remaining <= 0.0 || total <= 0.0 {
            break;
        }
        let area = field.mesh.area(cell);
        let requested = MapScale::in_units(remaining * weight / total / area, LengthUnit::Native);
        total -= weight;
        if requested <= 0.0 {
            continue;
        }
        let amount = field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .deposit_package(
                cell,
                &[catalogue::material(catalogue::ALLUVIUM, requested, 0.0)],
                "impacts",
                Pool::Space,
                None,
            )?;
        let band = field.shared.scalar_mut(S::ImpactEjectaThickness);
        band.set(cell, band.get(cell)? + amount)?;
        let volume = MapScale::metres(amount, LengthUnit::Native) * area;
        remaining -= volume;
        deposited += volume;
    }
    Ok(deposited)
}
pub(super) fn shape(
    field: &mut Field,
    p: &Settings,
    source: [f64; 2],
    radius: f64,
    depth: f64,
    rim: f64,
) -> io::Result<()> {
    let center = field
        .mesh
        .cell_at(source[0], source[1])
        .ok_or_else(|| io::Error::other("Impact center outside lattice"))?;
    let flags = field.shared.code_mut(C::FeatureFlags);
    flags.set(center, flags.get(center)? | (1 << 7))?;
    let share = 1.0
        - (field
            .water()
            .column
            .store(Store::Standing)
            .contents()
            .get(center)?
            / MapScale::native(p.impact_ocean_shock_depth))
        .clamp(0.0, 1.0);
    let mut excavation = 0.0;
    let (mut cells, mut weights) = (Vec::new(), Vec::new());
    for cell in 0..field.mesh.len() {
        let at = field.mesh.position(cell);
        let distance = field
            .mesh
            .delta_x(at[0] - source[0])
            .hypot(at[1] - source[1]);
        let area = field.mesh.area(cell);
        excavation += MapScale::metres(
            excavate(field, cell, distance, radius, depth)?,
            LengthUnit::Native,
        ) * area;
        raise_rim(field, cell, distance, radius, rim)?;
        shock(field, p, cell, distance, radius, share)?;
        if distance >= radius && distance <= radius * 2.2 {
            cells.push(cell);
            weights.push(area * (1.0 - (distance - radius) / (radius * 1.2)).max(0.0));
        }
    }
    let deposited = ejecta(field, p, &cells, &weights, excavation)?;
    field
        .ground
        .try_borrow_mut()
        .map_err(io::Error::other)?
        .record_sediment_export(excavation, excavation - deposited);
    Ok(())
}
