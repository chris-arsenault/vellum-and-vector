use super::{Fault, Work};
use crate::{
    hpc::BitSet,
    noise::{hash_signed, hash_unit},
};
use std::io;

pub(super) fn widen(
    work: &mut Work<'_>,
    point: [f64; 2],
    width: f64,
    strength: f64,
) -> io::Result<()> {
    widen_values(work.mesh, work.conductance, point, width, strength)
}
pub(super) fn widen_values(
    mesh: &crate::lattice::TriangularLattice,
    conductance: &mut crate::storage::Band<f64>,
    point: [f64; 2],
    width: f64,
    strength: f64,
) -> io::Result<()> {
    let Some(source) = mesh.cell_at(point[0], point[1]) else {
        return Ok(());
    };
    let mut queue = vec![source];
    let mut visited = BitSet::new(mesh.len());
    visited.add(source);
    let support = width / 2.0 + mesh.cell_width().hypot(mesh.cell_height()) / 2.0;
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        let [x, y] = mesh.position(cell);
        let distance = mesh.delta_x(x - point[0]).hypot(y - point[1]);
        if distance > support && cell != source {
            continue;
        }
        let value = if cell == source {
            strength
        } else {
            (560.0 * (1.0 - distance / support).max(0.0)).round()
        };
        conductance.set(cell, conductance.get(cell)?.max(value))?;
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(cell, edge) {
                if visited.add(next) {
                    queue.push(next);
                }
            }
        }
    }
    Ok(())
}
struct Heading {
    point: [f64; 2],
    angle: f64,
}
fn directed_step(
    work: &Work<'_>,
    heading: &Heading,
    branch: usize,
    step: f64,
    distance: f64,
) -> io::Result<Option<Heading>> {
    let mut best = None;
    let mut score = f64::NEG_INFINITY;
    let seed = work.context.seed;
    for turn in [-0.65f64, -0.325, 0.0, 0.325, 0.65] {
        let angle = heading.angle + turn;
        let point = [
            heading.point[0] + angle.cos() * distance,
            heading.point[1] + angle.sin() * distance,
        ];
        let Some(cell) = work.mesh.cell_at(point[0], point[1]) else {
            continue;
        };
        let novelty = if work.conductance.get(cell)? < 560.0 {
            0.22
        } else {
            -0.08
        };
        let grid = ((point[0] / work.noise_span).floor() as i32)
            ^ ((point[1] / work.noise_span).floor() as i32);
        let value = turn.cos()
            + novelty
            + work.strain.get(cell)? / 1000.0 * 0.12
            + hash_signed(
                seed ^ 0x6c53,
                branch as f64 + (step / work.noise_span).floor(),
                f64::from(grid),
            ) * 0.12;
        if value > score {
            score = value;
            best = Some(Heading { point, angle });
        }
    }
    Ok(best)
}
pub(super) fn grow(
    work: &mut Work<'_>,
    root: [f64; 2],
    branch: usize,
    nodes: &mut Vec<[f64; 2]>,
) -> io::Result<()> {
    let seed = work.context.seed;
    let p = work.settings;
    let mut heading = Heading {
        point: root,
        angle: hash_unit(seed ^ 0x3da7, branch as f64, 0.0) * std::f64::consts::TAU,
    };
    let length = p.fracture_minimum_length
        + (p.fracture_maximum_length - p.fracture_minimum_length)
            * hash_unit(seed ^ 0x4f39, branch as f64, 1.0);
    let mut ordinal = work.faults.len();
    while work
        .faults
        .iter()
        .any(|f| f.id == format!("fault:{ordinal}"))
    {
        ordinal += 1;
    }
    let mut fault = Fault {
        id: format!("fault:{ordinal}"),
        coordinates: Vec::new(),
        width: p.fracture_width,
    };
    let increment = (fault.width / 2.0).min(length / 32.0);
    let mut step = 0.0;
    while step < length {
        let strength = 760.0
            + (hash_unit(seed, branch as f64, (step / work.noise_span).floor()) * 240.0).trunc();
        nodes.push(heading.point);
        fault.coordinates.push(heading.point);
        widen(work, heading.point, fault.width, strength)?;
        let Some(next) = directed_step(work, &heading, branch, step, increment.min(length - step))?
        else {
            break;
        };
        heading = next;
        heading.angle += hash_signed(
            seed ^ 0x5ac1,
            branch as f64,
            (step / work.noise_span).floor(),
        ) * 0.22;
        step += increment;
    }
    fault.coordinates.push(heading.point);
    work.faults.push(fault);
    Ok(())
}
