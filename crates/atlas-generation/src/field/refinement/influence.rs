use super::{
    super::{
        landmarks::{
            catalogue::{Kind, Landmark},
            path::Path,
            placement::{place, Placed},
        },
        shared::Scalar,
        Field,
    },
    network::repel,
    topology::distance,
};
use crate::{lattice::TriangularLattice, spatial::SpatialKernel, storage::Band};
use std::io;
pub fn course_weight(
    mesh: &TriangularLattice,
    seeds: &[usize],
    parent_span: f64,
    span: f64,
) -> Vec<f64> {
    let reach = ((parent_span * 0.3 / span + 0.5).floor() as usize).max(2);
    let mut steps = vec![-1i32; mesh.len()];
    let mut queue = Vec::with_capacity(mesh.len());
    for &cell in seeds {
        if steps[cell] < 0 {
            steps[cell] = 0;
            queue.push(cell);
        }
    }
    let mut weight = vec![0.0; mesh.len()];
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        let d = steps[cell] as f64 / reach as f64;
        weight[cell] = (-2.0 * d * d).exp();
        if steps[cell] as usize >= reach {
            continue;
        }
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            if steps[next] >= 0 {
                continue;
            }
            steps[next] = steps[cell] + 1;
            queue.push(next);
        }
    }
    weight
}
pub fn course_cost(
    mesh: &TriangularLattice,
    cost: &mut [f64],
    seeds: &[usize],
    parent_span: f64,
    span: f64,
) {
    for (cost, weight) in cost
        .iter_mut()
        .zip(course_weight(mesh, seeds, parent_span, span))
    {
        *cost *= 1.0 - 0.85 * weight;
    }
}
fn path_distance(
    field: &Field,
    placed: &Placed<'_>,
    kernel: &dyn SpatialKernel,
) -> io::Result<Band<f64>> {
    if placed.path.len() >= 2 {
        return Ok(Path::new(&field.mesh, &placed.path)
            .hits(field, kernel)?
            .distance);
    }
    let mut distance = field.coverage.borrow_mut().allocate(0.0);
    for cell in 0..field.mesh.len() {
        let [x, y] = field.mesh.position(cell);
        distance.set(
            cell,
            field
                .mesh
                .delta_x(x - placed.center[0])
                .hypot(y - placed.center[1]),
        )?;
    }
    Ok(distance)
}
pub fn captured_landmarks(
    field: &Field,
    landmarks: &[Landmark],
    kernel: &dyn SpatialKernel,
) -> io::Result<Vec<Landmark>> {
    let mut found = Vec::new();
    for landmark in landmarks {
        let Some(placed) = place(field, landmark, None)? else {
            continue;
        };
        let reach = field
            .scale
            .supported(landmark.kind.reach(&landmark.parameters), 1.0);
        let distances = path_distance(field, &placed, kernel)?;
        for cell in 0..field.mesh.len() {
            if distances.get(cell)? <= reach {
                found.push(landmark.clone());
                break;
            }
        }
    }
    Ok(found)
}
pub fn landmark_cost(
    field: &Field,
    landmark: &Landmark,
    cost: &mut [f64],
    fracture_strength: f64,
    kernel: &dyn SpatialKernel,
) -> io::Result<()> {
    let Some(placed) = place(field, landmark, None)? else {
        return Ok(());
    };
    let p = &landmark.parameters;
    let center = field.mesh.cell_at(placed.center[0], placed.center[1]);
    match landmark.kind {
        Kind::VolcanicMountain | Kind::ResistantMountain => {
            if let Some(center) = center {
                repel(&field.mesh, cost, center, p["baseRadius"] * 1000.0);
            }
        }
        Kind::DomeRing | Kind::ImpactRing => {
            if let Some(center) = center {
                for (cell, cost) in cost.iter_mut().enumerate() {
                    if (distance(&field.mesh, center, cell) - p["diameter"] * 500.0).abs()
                        <= field.scale.cells(1.0)
                    {
                        *cost *= 4.0;
                    }
                }
            }
        }
        Kind::Canyon | Kind::Falls | Kind::Escarpment => {
            let reach = match landmark.kind {
                Kind::Canyon => p["rimWidth"] * 500.0,
                Kind::Escarpment => p["scarpWidth"] * 1000.0,
                _ => field.scale.cells(2.0),
            };
            path_cost(field, &placed, cost, reach, fracture_strength, kernel)?;
        }
        _ => {}
    }
    Ok(())
}
fn path_cost(
    field: &Field,
    placed: &Placed<'_>,
    cost: &mut [f64],
    reach: f64,
    strength: f64,
    kernel: &dyn SpatialKernel,
) -> io::Result<()> {
    let distances = path_distance(field, placed, kernel)?;
    let mut fracture = field.shared.derive_scalar(Scalar::FractureConductance);
    for (cell, cost) in cost.iter_mut().enumerate() {
        let distance = distances.get(cell)?;
        if distance > reach {
            continue;
        }
        if placed.landmark.kind == Kind::Escarpment {
            let next = fracture
                .get(cell)?
                .max((strength * (1.0 - distance / reach) + 0.5).floor());
            fracture.set(cell, next)?;
        } else {
            *cost *= 0.15;
        }
    }
    Ok(())
}
