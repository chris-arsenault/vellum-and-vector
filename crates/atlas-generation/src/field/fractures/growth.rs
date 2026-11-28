use super::{Fault, Work};
use crate::{
    chance::{Chance, Stride, Walker, Whims},
    hpc::BitSet,
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
/// The turns a growing fault may take at each step, in radians off its heading.
const FAN: [f64; 5] = [-0.65, -0.325, 0.0, 0.325, 0.65];
/// How open a fault stands `travelled` along it: drawn afresh every span of its length.
pub(super) fn strength(seed: i32, branch: usize, travelled: f64, span: f64) -> f64 {
    760.0 + (Chance::of(seed, 0).unit([branch as f64, (travelled / span).floor()]) * 240.0).trunc()
}
/// What ground is worth to a growing fault: more where no fault runs yet, and more the
/// more the crust there is strained. Ground off the map is worth nothing to it.
fn worth(work: &Work<'_>, point: [f64; 2]) -> io::Result<Option<f64>> {
    let Some(cell) = work.mesh.cell_at(point[0], point[1]) else {
        return Ok(None);
    };
    let novelty = if work.conductance.get(cell)? < 560.0 {
        0.22
    } else {
        -0.08
    };
    Ok(Some(novelty + work.strain.get(cell)? / 1000.0 * 0.12))
}
pub(super) fn grow(
    work: &mut Work<'_>,
    root: [f64; 2],
    branch: usize,
    nodes: &mut Vec<[f64; 2]>,
) -> io::Result<()> {
    let seed = work.context.seed;
    let p = work.settings;
    let number = branch as f64;
    // A fault sets out on a heading and for a length drawn for it, then walks: holding
    // its heading, drawn to unbroken and strained ground, and wandering by chance.
    let mut walker = Walker {
        point: root,
        heading: Chance::of(seed, 0x3da7).angle([number, 0.0]),
    };
    let length = Chance::of(seed, 0x4f39).between(
        [number, 1.0],
        [p.fracture_minimum_length, p.fracture_maximum_length],
    );
    let stride = Stride {
        fan: &FAN,
        whim: 0.12,
        drift: 0.22,
        span: work.noise_span,
    };
    let whims = Whims {
        turn: Chance::of(seed, 0x6c53),
        drift: Chance::of(seed, 0x5ac1),
    };
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
        nodes.push(walker.point);
        fault.coordinates.push(walker.point);
        let open = strength(seed, branch, step, work.noise_span);
        widen(work, walker.point, fault.width, open)?;
        let reach = increment.min(length - step);
        let went = walker.step(&stride, whims, [number, step], reach, |point| {
            worth(work, point)
        })?;
        if !went {
            break;
        }
        step += increment;
    }
    fault.coordinates.push(walker.point);
    work.faults.push(fault);
    Ok(())
}
