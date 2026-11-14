use super::{
    geographic_contours::{self as contours, ReadCell},
    poi::map_records::MapState,
    region_partition,
    significance::measure,
};
use crate::{hpc::SmallIntSet, lattice::Membership, storage::Band};
use atlas_map::Geometry;
use std::io;
fn label_contour(
    state: &impl MapState,
    labels: &Band<i32>,
    label: i32,
    leaves: &[usize],
    weight: Option<ReadCell<'_>>,
) -> io::Result<Option<Geometry>> {
    let mesh = &state.field()?.mesh;
    let mut touching = SmallIntSet::default();
    for &cell in leaves {
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(cell, edge) {
                let other = labels.get(next)?;
                if other >= 0 && other != label {
                    touching.add(other);
                }
            }
        }
    }
    let mut peak = if weight.is_some() { 1e-9f64 } else { 1.0 };
    if let Some(weight) = weight {
        for &cell in leaves {
            peak = peak.max(weight(cell)?);
        }
    }
    let share = |cell| -> io::Result<f64> {
        Ok(if labels.get(cell)? == label {
            weight
                .map(|weight| weight(cell))
                .transpose()?
                .map_or(1.0, |weight| weight / peak)
        } else {
            0.0
        })
    };
    if touching.items().is_empty() {
        return contours::membership(state, leaves, &share);
    }
    let others = touching
        .items()
        .iter()
        .map(|&other| move |cell| Ok(f64::from(labels.get(cell)? == other)))
        .collect::<Vec<_>>();
    let mut terms: Vec<ReadCell<'_>> = vec![&share];
    terms.extend(others.iter().map(|read| read as ReadCell<'_>));
    contours::combined(state, leaves, &terms, &|values| {
        let others = &values[1..];
        values[0]
            - others
                .iter()
                .copied()
                .fold(0.5 * (1.0 - others.iter().sum::<f64>()), f64::max)
    })
}
pub fn shape(
    state: &impl MapState,
    labels: &Band<i32>,
    label: i32,
    leaves: &[usize],
    weight: Option<ReadCell<'_>>,
) -> io::Result<Option<Geometry>> {
    let Some(&first) = leaves.first() else {
        return Ok(None);
    };
    let Some(outline) = label_contour(state, labels, label, leaves, weight)? else {
        return Ok(None);
    };
    let field = state.field()?;
    let water = field.water().column.kind;
    let wet = water.get(first)? != 0;
    let filled = contours::fill_small_holes(
        state,
        outline,
        measure(&field.scale, 0.000125, 2, 1.0)?,
        &|cell| {
            let held = labels.get(cell)?;
            Ok((water.get(cell)? != 0) != wet || (held != -1 && held != label))
        },
    )?;
    contours::clip(state, Some(filled))
}
pub fn outline(
    state: &impl MapState,
    cells: &[usize],
    weight: Option<ReadCell<'_>>,
) -> io::Result<Option<Geometry>> {
    let mut labels = state.field()?.coverage.borrow_mut().allocate(-1);
    for &cell in cells {
        labels.set(cell, 0)?;
    }
    shape(state, &labels, 0, cells, weight)
}
pub struct Components {
    pub polygonal: bool,
    pub splits: bool,
}
pub struct Region {
    pub members: Vec<usize>,
    pub geometry: Option<Geometry>,
}
pub struct Regions {
    pub regions: Vec<Region>,
    pub retained_continental_domains: usize,
}
pub fn components(
    state: &impl MapState,
    includes: &dyn Fn(usize) -> io::Result<bool>,
    options: Components,
    weight: Option<ReadCell<'_>>,
) -> io::Result<Regions> {
    let field = state.field()?;
    let mesh = &field.mesh;
    let mut labels = field.coverage.borrow_mut().allocate(-1);
    for cell in 0..mesh.len() {
        if mesh.membership(cell) == Membership::Content && includes(cell)? {
            labels.set(cell, -2)?;
        }
    }
    let land = options
        .splits
        .then(|| region_partition::land_area(field))
        .transpose()?;
    let mut serial = 0;
    let mut result = Regions {
        regions: Vec::new(),
        retained_continental_domains: 0,
    };
    for start in 0..mesh.len() {
        if labels.get(start)? != -2 {
            continue;
        }
        let members = connected(mesh, &mut labels, start, serial)?;
        let pieces = match land {
            None => vec![members],
            Some(land) => region_partition::partition(field, &members, land, || {
                result.retained_continental_domains += 1
            })?,
        };
        for (n, piece) in pieces.iter().enumerate() {
            for &cell in piece {
                labels.set(cell, serial + n as i32)?;
            }
        }
        let count = pieces.len();
        for (n, members) in pieces.into_iter().enumerate() {
            let geometry = if options.polygonal {
                shape(state, &labels, serial + n as i32, &members, weight)?
            } else {
                None
            };
            result.regions.push(Region { members, geometry });
        }
        serial += count as i32;
    }
    Ok(result)
}
fn connected(
    mesh: &crate::lattice::TriangularLattice,
    labels: &mut Band<i32>,
    start: usize,
    serial: i32,
) -> io::Result<Vec<usize>> {
    let mut members = vec![start];
    labels.set(start, serial)?;
    let mut head = 0;
    while head < members.len() {
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(members[head], edge) {
                if labels.get(next)? == -2 {
                    labels.set(next, serial)?;
                    members.push(next);
                }
            }
        }
        head += 1;
    }
    Ok(members)
}
