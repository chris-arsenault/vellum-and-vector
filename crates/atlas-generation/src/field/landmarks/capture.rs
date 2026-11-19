use super::{
    canyon::{base, length},
    changes::{add, cut},
    measurement::distance,
    path::Path,
};
use crate::{
    field::{
        landmark_ledger::{Capture, LandmarkRecord},
        shared::Scalar as S,
        Field,
    },
    hpc::{radix_order, BitSet, Direction, NumericKey},
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale},
    spatial::SpatialKernel,
    water::network::RiverTerrain,
};
use std::io;
pub(super) fn on_river(field: &Field, cell: usize) -> io::Result<bool> {
    let water = field.water.try_borrow().map_err(io::Error::other)?;
    Ok(water
        .river_reader()
        .order_at(cell, water.read_only().column.kind.get(cell)?)
        > 0)
}
pub(super) fn water_at(field: &Field, cell: usize) -> io::Result<f64> {
    let water = field.water.try_borrow().map_err(io::Error::other)?;
    Ok(water
        .river_reader()
        .water_at(cell, false, water.read_only().flow.mean.get(cell)?))
}
pub(super) fn successor(field: &Field, cell: usize) -> io::Result<Option<usize>> {
    let water = field.water.try_borrow().map_err(io::Error::other)?;
    let view = water.read_only();
    water.river_reader().successor(
        cell,
        None,
        &RiverTerrain {
            mesh: &field.mesh,
            water_kind: &view.column.kind,
            targets: &view.routing.targets,
        },
    )
}
fn follows(
    field: &Field,
    from: usize,
    steps: usize,
    mut found: impl FnMut(usize) -> io::Result<bool>,
) -> io::Result<bool> {
    let mut at = Some(from);
    for _ in 0..steps {
        let Some(cell) = at else {
            break;
        };
        if found(cell)? {
            return Ok(true);
        }
        at = successor(field, cell)?;
    }
    Ok(false)
}
fn nearby(field: &Field, head: usize, reach: f64, floor: &BitSet) -> io::Result<Vec<usize>> {
    let base = base(field)? + MapScale::native(length(field, 1.25e-6)?);
    let near_sea = field.scale.cell_count(reach).ceil() as usize;
    let water = field.water();
    let elevation = field.ground().view(G::Elevation);
    let mut candidates = Vec::new();
    let mut flow = Vec::new();
    for cell in 0..field.mesh.len() {
        if water.column.kind.get(cell)? != 0 || !on_river(field, cell)? || floor.has(cell) {
            continue;
        }
        if elevation.get(cell)? <= base
            || follows(
                field,
                cell,
                near_sea,
                |i| Ok(water.column.kind.get(i)? == 1),
            )?
        {
            continue;
        }
        if distance(field, cell, field.mesh.position(head)) > reach {
            continue;
        }
        candidates.push(cell);
        flow.push(water_at(field, cell)?);
    }
    let order = radix_order(&[NumericKey::Float(&flow)], Direction::Descending)
        .map_err(io::Error::other)?;
    Ok(order.into_iter().map(|i| candidates[i]).collect())
}
fn river_at(field: &Field, cell: usize) -> io::Result<Capture> {
    let [x, y] = field.mesh.position(cell);
    Ok(Capture {
        x,
        y,
        accumulation: water_at(field, cell)?,
    })
}
fn corridor(
    field: &mut Field,
    from: usize,
    to: usize,
    width: f64,
    kernel: &dyn SpatialKernel,
) -> io::Result<Option<(f64, Vec<u32>)>> {
    let start_point = field.mesh.position(from);
    let end_point = field.mesh.position(to);
    let distance_to_head = distance(field, to, start_point);
    let elevation = field.ground().view(G::Elevation);
    let mut lowest = elevation.get(from)?;
    for edge in 0..3 {
        if let Some(cell) = field.mesh.neighbor(from, edge) {
            lowest = lowest.min(elevation.get(cell)?);
        }
    }
    let start = lowest - MapScale::native(length(field, 7.5e-7)?);
    if start <= base(field)? {
        return Ok(None);
    }
    let fall = if let Some(exit) = successor(field, from)? {
        (elevation.get(from)? - elevation.get(exit)?) / distance(field, exit, start_point).max(1.0)
    } else {
        0.0
    };
    let gradient = (1.5 * fall).max(0.002);
    let end = elevation
        .get(to)?
        .min(start - MapScale::native(length(field, 5e-7)?) - gradient * distance_to_head);
    let hits = Path::new(&field.mesh, &[start_point, end_point]).hits(field, kernel)?;
    let mut cells = Vec::new();
    let mut applied: f64 = 0.0;
    for cell in 0..field.mesh.len() {
        if cell == from {
            continue;
        }
        if hits.distance.get(cell)? > width && cell != to {
            continue;
        }
        let level = start + (end - start) * hits.along.get(cell)? / distance_to_head.max(1.0);
        let done = cut(field, cell, elevation.get(cell)? - level)?;
        add(field, S::LandmarkMaintenance, cell, done)?;
        applied = applied.max(done);
        cells.push(cell as u32);
    }
    Ok(Some((applied, cells)))
}
pub(super) struct Target {
    pub head: Option<usize>,
    pub floor: Vec<u32>,
    pub floor_width: f64,
    pub reach: f64,
    pub label: &'static str,
}
pub(super) fn into(
    field: &mut Field,
    record: &mut LandmarkRecord,
    target: &Target,
    kernel: &dyn SpatialKernel,
) -> io::Result<f64> {
    let Some(head) = target.head else {
        return Ok(0.0);
    };
    let mut floor = BitSet::new(field.mesh.len());
    let mut held = 0.0;
    record.capture = None;
    for &cell in &target.floor {
        let cell = cell as usize;
        floor.add(cell);
        if on_river(field, cell)? && water_at(field, cell)? > held {
            held = water_at(field, cell)?;
            record.capture = Some(river_at(field, cell)?);
        }
    }
    let mut any = false;
    for cell in 0..field.mesh.len() {
        if on_river(field, cell)? {
            any = true;
            break;
        }
    }
    if !any {
        return Ok(0.0);
    }
    let steps = 4 * field.scale.cell_count(target.reach).ceil() as usize + 8;
    for best in nearby(field, head, target.reach, &floor)? {
        if water_at(field, best)? <= held {
            break;
        }
        if follows(field, best, steps, |cell| Ok(floor.has(cell)))? {
            return Ok(0.0);
        }
        let Some((applied, cells)) = corridor(field, best, head, target.floor_width, kernel)?
        else {
            continue;
        };
        let mut in_corridor = BitSet::new(field.mesh.len());
        for &cell in &record.corridor {
            in_corridor.add(cell as usize);
        }
        for cell in cells {
            if in_corridor.add(cell as usize) {
                record.corridor.push(cell);
            }
        }
        record.capture = Some(river_at(field, best)?);
        let p = field.mesh.position(best);
        let origin = field.mesh.origin();
        record.note(&format!(
            "Captured the river at ({}, {}) into the {}.",
            (p[0] + origin[0] + 0.5).floor(),
            (p[1] + origin[1] + 0.5).floor(),
            target.label
        ));
        return Ok(MapScale::metres(applied, LengthUnit::Native));
    }
    if record.capture.is_none() {
        record.note(&format!(
            "No river within {} km of the {}; it carries local drainage only.",
            MapScale::in_units(target.reach, LengthUnit::Kilometre).round(),
            target.label
        ));
    }
    Ok(0.0)
}
pub(super) fn with_record<T>(
    field: &mut Field,
    id: atlas_map::Id,
    work: impl FnOnce(&mut Field, &mut LandmarkRecord) -> io::Result<T>,
) -> io::Result<T> {
    let at = field
        .landmark_ledger
        .iter()
        .position(|r| r.id == id)
        .ok_or_else(|| io::Error::other("Landmark capture needs its emplaced record"))?;
    let mut record = field.landmark_ledger.remove(at);
    let result = work(field, &mut record);
    field.landmark_ledger.insert(at, record);
    result
}
pub(super) fn channel_cell(field: &Field, point: [f64; 2]) -> io::Result<Option<usize>> {
    let Some(center) = field.mesh.cell_at(point[0], point[1]) else {
        return Ok(None);
    };
    let height = field.ground().view(G::Elevation);
    let mut best = center;
    for edge in 0..3 {
        if let Some(cell) = field.mesh.neighbor(center, edge) {
            if height.get(cell)? < height.get(best)? {
                best = cell;
            }
        }
    }
    Ok(Some(best))
}
