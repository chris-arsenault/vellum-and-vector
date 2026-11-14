use crate::{
    field::{
        refinement::{courses::cell_at, topology::Neighborhood},
        significance::measure,
        Field,
    },
    hpc::BitSet,
    lattice::Membership,
    rock::ground::GroundField,
    scale::MapScale,
};
use std::io;

pub fn channel_near(field: &Field, cell: usize) -> io::Result<Option<usize>> {
    if cell == usize::MAX {
        return Ok(None);
    }
    let water = field.water.borrow();
    let reader = water.river_reader();
    let view = water.read_only();
    let on_river =
        |cell| -> io::Result<bool> { Ok(reader.order_at(cell, view.column.kind.get(cell)?) > 0) };
    if on_river(cell)? {
        return Ok(Some(cell));
    }
    let reach = field.scale.cells(2.0);
    let [x, y] = field.mesh.position(cell);
    let mut queue = vec![cell];
    let mut seen = BitSet::new(field.mesh.len());
    seen.add(cell);
    let mut head = 0;
    while head < queue.len() {
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(queue[head], edge) else {
                continue;
            };
            let [nx, ny] = field.mesh.position(next);
            if seen.has(next) || (nx - x).hypot(ny - y) > reach {
                continue;
            }
            if on_river(next)? {
                return Ok(Some(next));
            }
            seen.add(next);
            queue.push(next);
        }
        head += 1;
    }
    Ok(None)
}
pub fn channel_at(field: &Field, position: [f64; 2]) -> io::Result<Option<usize>> {
    match cell_at(&field.mesh, position) {
        Some(cell) => channel_near(field, cell),
        None => Ok(None),
    }
}
pub struct Children {
    head: Vec<i32>,
    next: Vec<i32>,
}
pub fn upstream_index(receiver: &[i32]) -> Children {
    let mut children = Children {
        head: vec![-1; receiver.len()],
        next: vec![-1; receiver.len()],
    };
    for (cell, &target) in receiver.iter().enumerate() {
        if target < 0 {
            continue;
        }
        children.next[cell] = children.head[target as usize];
        children.head[target as usize] = cell as i32;
    }
    children
}
pub fn next_body(field: &Field) -> io::Result<i32> {
    let body = field.water().column.body;
    let mut next = 1;
    for cell in 0..field.mesh.len() {
        next = next.max(body.get(cell)? + 1);
    }
    Ok(next)
}
pub fn crest_at(field: &Field, dam: usize, neighborhood: &Neighborhood) -> io::Result<f64> {
    let elevation = field.ground().view(GroundField::Elevation);
    let bed = elevation.get(dam)?;
    let water = field.water.borrow();
    let reader = water.river_reader();
    let view = water.read_only();
    let mut highest = bed;
    let mut second = bed;
    let mut banks = 0;
    for &cell in neighborhood.of(dam) {
        let height = elevation.get(cell)?;
        let kind = view.column.kind.get(cell)?;
        if reader.order_at(cell, kind) > 0 || kind != 0 || height <= bed {
            continue;
        }
        banks += 1;
        if height >= highest {
            second = highest;
            highest = height;
        } else if height > second {
            second = height;
        }
    }
    let bank = if banks >= 2 { second } else { highest };
    Ok(bank.min(bed + MapScale::native(measure(&field.scale, 0.000015, 1, 0.5)?)))
}
pub fn hold_reservoir(
    field: &Field,
    dam: usize,
    children: &Children,
    body: i32,
    neighborhood: &Neighborhood,
) -> io::Result<bool> {
    let crest = crest_at(field, dam, neighborhood)?;
    let mut queue = Vec::new();
    let mut child = children.head[dam];
    while child >= 0 {
        queue.push(child as usize);
        child = children.next[child as usize];
    }
    let mut filled = 0;
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        if field.mesh.membership(cell) != Membership::Content
            || field.water().column.kind.get(cell)? == 1
            || field.ground().view(GroundField::Elevation).get(cell)? >= crest
        {
            continue;
        }
        field.water.borrow_mut().impound(cell, body, crest)?;
        filled += 1;
        let mut child = children.head[cell];
        while child >= 0 {
            queue.push(child as usize);
            child = children.next[child as usize];
        }
    }
    Ok(filled > 0)
}
