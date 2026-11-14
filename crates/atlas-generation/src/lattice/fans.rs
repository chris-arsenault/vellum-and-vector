//! Full interpolation support and directed cell fans for geographic contours.
use super::{sampling::vertex_members, Membership, TriangularLattice};
use crate::{contours::Sample, hpc::SmallIntSet};
use std::io;
pub fn support(mesh: &TriangularLattice, members: &[usize]) -> Vec<usize> {
    let mut selected = SmallIntSet::default();
    let mut result = Vec::new();
    let mut add = |cell| {
        if selected.add(cell as i32) {
            result.push(cell);
        }
    };
    for &cell in members {
        add(cell);
    }
    for &cell in members {
        for corner in 0..3 {
            for next in vertex_members(mesh, cell, corner) {
                add(next);
            }
        }
    }
    result
}
pub fn live(mesh: &TriangularLattice) -> impl Iterator<Item = usize> + '_ {
    (0..mesh.len()).filter(|&cell| mesh.membership(cell) != Membership::NoData)
}
pub fn face_neighbor(mesh: &TriangularLattice, cell: usize, opposite: usize) -> usize {
    mesh.neighbor(
        cell,
        if mesh.inverted(cell) && opposite > 0 {
            3 - opposite
        } else {
            opposite
        },
    )
    .unwrap_or(cell)
}
pub fn vertex(
    mesh: &TriangularLattice,
    cell: usize,
    corner: usize,
    read: &dyn Fn(usize) -> io::Result<f64>,
) -> io::Result<Sample> {
    let (u, v, inverted) = mesh.address(cell);
    let sign = if inverted { -1 } else { 1 };
    let x = 3 * (u + v) + if inverted { 4 } else { 2 } + if corner == 0 { -2 * sign } else { sign };
    let y = -u
        + v
        + match corner {
            0 => 0,
            1 => -1,
            _ => 1,
        };
    let members = vertex_members(mesh, cell, corner);
    let base = read(members[0])?;
    let mut sum = 0.0;
    for &member in &members {
        sum += read(member)? - base;
    }
    let [ox, oy] = mesh.origin();
    let [dx, dy] = mesh.offset();
    Ok([
        x as f64 * mesh.spacing() / 2.0 + dx + ox,
        y as f64 * 3.0f64.sqrt() * mesh.spacing_y() / 2.0 + dy + oy,
        base + sum / members.len() as f64,
    ])
}
pub fn cell_fans(
    mesh: &TriangularLattice,
    cell: usize,
    read: &dyn Fn(usize) -> io::Result<f64>,
) -> io::Result<[[Sample; 3]; 6]> {
    let [x, y] = mesh.position(cell);
    let [ox, oy] = mesh.origin();
    let value = read(cell)?;
    let center = [x + ox, y + oy, value];
    let corners = [
        vertex(mesh, cell, 0, read)?,
        vertex(mesh, cell, 1, read)?,
        vertex(mesh, cell, 2, read)?,
    ];
    let mut boundary = [[0.0; 3]; 6];
    for i in 0..3 {
        let a = corners[i];
        let b = corners[(i + 1) % 3];
        boundary[2 * i] = a;
        boundary[2 * i + 1] = [
            (a[0] + b[0]) / 2.0,
            (a[1] + b[1]) / 2.0,
            (value + read(face_neighbor(mesh, cell, (i + 2) % 3))?) / 2.0,
        ];
    }
    if mesh.inverted(cell) {
        boundary.reverse();
    }
    Ok(std::array::from_fn(|i| {
        [center, boundary[i], boundary[(i + 1) % 6]]
    }))
}
pub fn boundary(
    mesh: &TriangularLattice,
    cells: &[usize],
    selected: bool,
    read: &dyn Fn(usize) -> io::Result<f64>,
    mut emit: impl FnMut([Sample; 2]),
) -> io::Result<()> {
    let mut included = SmallIntSet::default();
    if selected {
        for &cell in cells {
            included.add(cell as i32);
        }
    }
    for &cell in cells {
        for corner in 0..3 {
            let neighbor = face_neighbor(mesh, cell, (corner + 2) % 3);
            let seam = mesh.periodic_width().is_some()
                && (mesh.position(neighbor)[0] - mesh.position(cell)[0]).abs()
                    > 2.0 * mesh.spacing();
            if neighbor != cell && (!selected || included.has(neighbor as i32)) && !seam {
                continue;
            }
            let a = vertex(mesh, cell, corner, read)?;
            let b = vertex(mesh, cell, (corner + 1) % 3, read)?;
            let middle = [
                (a[0] + b[0]) / 2.0,
                (a[1] + b[1]) / 2.0,
                (read(cell)? + read(neighbor)?) / 2.0,
            ];
            emit([if mesh.inverted(cell) { b } else { a }, middle]);
            emit([middle, if mesh.inverted(cell) { a } else { b }]);
        }
    }
    Ok(())
}
pub fn touches_boundary(mesh: &TriangularLattice, cell: usize) -> bool {
    if mesh.boundary(cell) {
        return true;
    }
    if mesh.periodic_width().is_none() {
        return false;
    }
    let y = mesh.position(cell)[1] + mesh.origin()[1];
    let height = mesh.cell_height();
    let atlas_map::Bounds(_, south, _, north) = mesh.bounds();
    y - height <= south
        || y + height >= north
        || (0..3)
            .filter_map(|edge| mesh.neighbor(cell, edge))
            .any(|next| {
                (mesh.position(next)[0] - mesh.position(cell)[0]).abs() > 2.0 * mesh.spacing()
            })
}
