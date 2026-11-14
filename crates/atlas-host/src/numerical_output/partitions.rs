use super::vectors::{Group, Vector, REGULAR_HEIGHT, REGULAR_WIDTH};
use atlas_generation::{
    lattice::BLOCK_CELLS,
    reconstruction::{topology::Topology, Grid, Layout},
};
use serde::Serialize;
use std::{collections::BTreeMap, io};

#[derive(Clone, Serialize)]
pub struct Slice {
    pub offset: Vec<usize>,
    pub shape: Vec<usize>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Partition {
    pub id: String,
    pub bounds: [f64; 4],
    pub cell_start: usize,
    pub cell_count: usize,
    pub neighbors: Vec<String>,
    pub array_slices: BTreeMap<String, Slice>,
}
pub fn create(grid: &Grid, vectors: &[Vector]) -> io::Result<Vec<Partition>> {
    match &grid.layout {
        Layout::Raster { width, height } => Ok(regular(grid.bounds, *width, *height, vectors)),
        Layout::Adaptive(topology) => linear(grid, topology, vectors),
    }
}
fn regular(
    [w, s, e, n]: [f64; 4],
    width: usize,
    height: usize,
    vectors: &[Vector],
) -> Vec<Partition> {
    let (dx, dy) = ((e - w) / (width - 1) as f64, (n - s) / (height - 1) as f64);
    let mut result = Vec::new();
    for y in (0..height).step_by(REGULAR_HEIGHT) {
        for x in (0..width).step_by(REGULAR_WIDTH) {
            let columns = REGULAR_WIDTH.min(width - x);
            let rows = REGULAR_HEIGHT.min(height - y);
            let slice = Slice {
                offset: vec![y, x],
                shape: vec![rows, columns],
            };
            result.push(Partition {
                id: format!("cells:{x}:{y}"),
                cell_start: y * width + x,
                cell_count: rows * columns,
                neighbors: Vec::new(),
                bounds: [
                    w.max(w + (x as f64 - 0.5) * dx),
                    s.max(s + (y as f64 - 0.5) * dy),
                    e.min(w + ((x + columns) as f64 - 0.5) * dx),
                    n.min(s + ((y + rows) as f64 - 0.5) * dy),
                ],
                array_slices: vectors
                    .iter()
                    .map(|v| (v.array.name.clone(), slice.clone()))
                    .collect(),
            });
        }
    }
    result
}
fn linear(grid: &Grid, topology: &Topology, vectors: &[Vector]) -> io::Result<Vec<Partition>> {
    let mut result = Vec::new();
    for group in [Group::Cells, Group::Faces, Group::Tree] {
        if !vectors.iter().any(|v| v.group == group) {
            continue;
        }
        let length = if group == Group::Cells {
            grid.measures.len()
        } else {
            vectors
                .iter()
                .filter(|v| v.group == group)
                .map(|v| v.array.shape[0] / v.components)
                .max()
                .unwrap_or(0)
        };
        for start in (0..length.max(1)).step_by(BLOCK_CELLS) {
            let count = BLOCK_CELLS.min(length - start);
            result.push(linear_partition(
                grid, topology, vectors, group, start, count,
            )?);
        }
    }
    Ok(result)
}
fn face_owner(topology: &Topology, face: usize) -> io::Result<usize> {
    let (mut low, mut high) = (0, topology.offsets.len() - 1);
    while low + 1 < high {
        let middle = (low + high) / 2;
        if topology.offsets.get(middle)? as usize <= face {
            low = middle;
        } else {
            high = middle;
        }
    }
    Ok(low)
}
fn linear_partition(
    grid: &Grid,
    topology: &Topology,
    vectors: &[Vector],
    group: Group,
    start: usize,
    count: usize,
) -> io::Result<Partition> {
    let (first, last) = if group == Group::Faces && count > 0 {
        (
            face_owner(topology, start)?,
            face_owner(topology, start + count - 1)? + 1,
        )
    } else {
        (start, start + count)
    };
    let bounds = if group == Group::Tree {
        grid.bounds
    } else {
        cell_extent(topology, first, last.min(grid.measures.len()), grid.bounds)?
    };
    Ok(Partition {
        id: format!("{}:{start}", group.name()),
        bounds,
        cell_start: first,
        cell_count: if group == Group::Cells {
            count.min(grid.measures.len() - start)
        } else {
            0
        },
        neighbors: Vec::new(),
        array_slices: vectors
            .iter()
            .map(|vector| {
                let offset = if vector.group == group {
                    start * vector.components
                } else {
                    0
                };
                let requested = count * vector.components
                    + usize::from(group == Group::Cells && vector.array.name == "offsets");
                let size = if vector.group == group {
                    requested.min(vector.array.shape[0] - offset)
                } else {
                    0
                };
                (
                    vector.array.name.clone(),
                    Slice {
                        offset: vec![offset],
                        shape: vec![size],
                    },
                )
            })
            .collect(),
    })
}
fn cell_extent(
    topology: &Topology,
    first: usize,
    last: usize,
    fallback: [f64; 4],
) -> io::Result<[f64; 4]> {
    if first >= last {
        return Ok(fallback);
    }
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for cell in first..last {
        let b = topology.cell(cell)?;
        bounds = [
            bounds[0].min(b[0]),
            bounds[1].min(b[1]),
            bounds[2].max(b[2]),
            bounds[3].max(b[3]),
        ];
    }
    Ok(bounds)
}
pub fn cargo(bounds: [f64; 4], partitions: &mut Vec<Partition>, vector: &Vector) {
    for start in (0..vector.array.shape[0]).step_by(BLOCK_CELLS) {
        partitions.push(Partition {
            id: format!("{}:{start}", vector.array.name),
            bounds,
            cell_start: 0,
            cell_count: 0,
            neighbors: Vec::new(),
            array_slices: BTreeMap::from_iter([(
                vector.array.name.clone(),
                Slice {
                    offset: vec![start],
                    shape: vec![BLOCK_CELLS.min(vector.array.shape[0] - start)],
                },
            )]),
        });
    }
}
