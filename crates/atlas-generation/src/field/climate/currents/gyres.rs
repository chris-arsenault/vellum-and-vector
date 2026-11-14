use super::{
    super::{latitude, ocean, read, write},
    settings::Settings,
};
use crate::{
    field::{shared::Scalar as S, Field},
    hpc::{Direction, KeyedHeap},
    storage::Band,
};
use std::io;

pub(super) fn ocean_path(field: &Field, distance: &mut Band<f64>, reach: f64) -> io::Result<()> {
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for cell in 0..field.mesh.len() {
        if ocean(field, cell)? && distance.get(cell)? < reach {
            queue.push(cell as u32, [distance.get(cell)?]);
        }
    }
    while let Some((cell, [d])) = queue.pop() {
        let cell = cell as usize;
        if d != distance.get(cell)? {
            continue;
        }
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            let value = d + field.mesh.edge_length(cell, edge);
            if !ocean(field, next)? || value >= distance.get(next)? {
                continue;
            }
            distance.set(next, value)?;
            queue.push(next as u32, [value]);
        }
    }
    Ok(())
}
fn coast_distance(field: &Field, reach: f64) -> io::Result<Band<f64>> {
    let mut distance = field.coverage.borrow_mut().allocate(0.0);
    for cell in 0..field.mesh.len() {
        if !ocean(field, cell)? {
            continue;
        }
        let mut value = reach;
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                if !ocean(field, next)? {
                    value = value.min(field.mesh.edge_length(cell, edge) / 2.0);
                }
            }
        }
        distance.set(cell, value)?;
    }
    ocean_path(field, &mut distance, reach)?;
    Ok(distance)
}
struct Flow {
    x: f64,
    y: f64,
    western: f64,
    upwelling: f64,
}
fn coastal(
    p: &Settings,
    latitude: f64,
    [x, y]: [f64; 2],
    [nx, ny]: [f64; 2],
    proximity: f64,
) -> Flow {
    let weight = (proximity * 2.5).clamp(0.0, 1.0) * nx.abs();
    let poleward = if latitude >= 0.0 { 1.0 } else { -1.0 };
    let gyre =
        if latitude.abs() < 90.0 / p.atmosphere.circulation_cells_per_hemisphere.max(1.0) * 1.5 {
            1.0
        } else {
            -1.0
        };
    let boundary = if nx < 0.0 { 1.0 } else { -1.0 };
    let (mut tx, mut ty) = (-ny, nx);
    if ty * poleward * gyre * boundary < 0.0 {
        tx = -tx;
        ty = -ty;
    }
    let length = x.hypot(y);
    Flow {
        x: (1.0 - weight) * (x / length) + weight * tx,
        y: (1.0 - weight) * (y / length) + weight * ty,
        western: if nx < 0.0 { weight } else { 0.0 },
        upwelling: if nx > 0.0 && gyre > 0.0 && ty * poleward < 0.0 {
            weight
        } else {
            0.0
        },
    }
}
fn circulation(p: &Settings, lat: f64) -> [f64; 2] {
    let width = 90.0 / p.atmosphere.circulation_cells_per_hemisphere.max(1.0);
    let distance = lat.abs().min(89.999);
    let cell = (distance / width).floor() as usize;
    let within = ((distance - cell as f64 * width) / width * std::f64::consts::PI).sin();
    let poleward = if lat >= 0.0 { 1.0 } else { -1.0 };
    let westerly = cell & 1 == 1;
    [
        if westerly { 1.0 } else { -1.0 },
        if westerly { poleward } else { -poleward } * within * p.atmosphere.circulation_cell_turn
            / 1000.0,
    ]
}
pub(super) fn directions(field: &Field, p: &Settings) -> io::Result<Band<f64>> {
    let distance = coast_distance(field, p.gyre_coastal_length * 3.0)?;
    let mut coast = field.coverage.borrow_mut().allocate(0.0);
    let mut western = field.coverage.borrow_mut().allocate(0.0);
    for cell in 0..field.mesh.len() {
        coast.set(
            cell,
            (-distance.get(cell)? / p.gyre_coastal_length).exp() / 2.0,
        )?;
    }
    for cell in 0..field.mesh.len() {
        write(field, S::Upwelling, cell, 0.0)?;
        if !ocean(field, cell)? {
            continue;
        }
        let lat = latitude(field, &p.atmosphere, cell);
        let [nx, ny] = field.mesh.gradient(cell, &|i| coast.get(i))?;
        let slope = nx.hypot(ny);
        let normal = if slope > 0.0 {
            [nx / slope, ny / slope]
        } else {
            [0.0; 2]
        };
        let flow = coastal(p, lat, circulation(p, lat), normal, coast.get(cell)?);
        western.set(cell, flow.western)?;
        write(field, S::Upwelling, cell, (flow.upwelling * 1000.0).round())?;
        let length = flow.x.hypot(flow.y).max(1e-9);
        write(
            field,
            S::OceanCurrentX,
            cell,
            (flow.x / length * 1000.0).round(),
        )?;
        write(
            field,
            S::OceanCurrentY,
            cell,
            (flow.y / length * 1000.0).round(),
        )?;
    }
    Ok(western)
}
pub(super) fn intensify(field: &Field, p: &Settings, western: &Band<f64>) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        let weight = western.get(cell)?;
        if weight > 0.0 {
            write(
                field,
                S::OceanCurrentStrength,
                cell,
                (read(field, S::OceanCurrentStrength, cell)?
                    * (1.0 + p.gyre_boundary_strength * weight))
                    .round()
                    .clamp(1.0, 1000.0),
            )?;
        }
    }
    Ok(())
}
