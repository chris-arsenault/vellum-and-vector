use super::operator::Operator;
use crate::storage::{Band, Coverage, ReadValues};
use std::io;

pub(super) fn aggregate(
    matrix: &Operator,
    coverage: &mut Coverage,
) -> io::Result<(Band<i32>, usize)> {
    let mut groups = coverage.scratch(matrix.count, -1i32);
    let offsets = matrix.offsets.read_values()?;
    let neighbors = matrix.neighbors.read_values()?;
    let mut assigned = groups.write_values()?;
    let mut count = 0;
    for i in 0..matrix.count {
        if assigned.get(i)? >= 0 {
            continue;
        }
        assigned.set(i, count)?;
        for at in offsets.get(i)?..offsets.get(i + 1)? {
            let j = neighbors.get(at as usize)? as usize;
            if assigned.get(j)? < 0 {
                assigned.set(j, count)?;
            }
        }
        count += 1;
    }
    drop(assigned);
    Ok((groups, count as usize))
}
struct MatrixValues<'a> {
    areas: ReadValues<'a, f64>,
    offsets: ReadValues<'a, u32>,
    neighbors: ReadValues<'a, u32>,
    weights: ReadValues<'a, f64>,
    groups: ReadValues<'a, i32>,
}
struct Gather {
    heads: Band<i32>,
    next: Band<i32>,
    mark: Band<i32>,
    value: Band<f64>,
    columns: Vec<u32>,
}
impl Gather {
    fn new(coverage: &mut Coverage, groups: &Band<i32>, count: usize) -> io::Result<Self> {
        let mut heads = coverage.scratch(count, -1i32);
        let mut next = coverage.scratch(groups.len(), 0i32);
        {
            let length = groups.len();
            let groups = groups.read_values()?;
            let mut heads = heads.write_values()?;
            let mut next = next.write_values()?;
            for i in (0..length).rev() {
                let group = groups.get(i)? as usize;
                next.set(i, heads.get(group)?)?;
                heads.set(group, i as i32)?;
            }
        }
        Ok(Self {
            heads,
            next,
            mark: coverage.scratch(count, -1),
            value: coverage.scratch(count, 0.0),
            columns: Vec::new(),
        })
    }
    fn row(&mut self, matrix: &MatrixValues<'_>, a: usize) -> io::Result<f64> {
        let heads = self.heads.read_values()?;
        let next = self.next.read_values()?;
        let mut mark = self.mark.write_values()?;
        let mut value = self.value.write_values()?;
        let mut area = 0.0;
        self.columns.clear();
        let mut i = heads.get(a)?;
        while i >= 0 {
            let row = i as usize;
            area += matrix.areas.get(row)?;
            for at in matrix.offsets.get(row)?..matrix.offsets.get(row + 1)? {
                let at = at as usize;
                let b = matrix.groups.get(matrix.neighbors.get(at)? as usize)? as usize;
                if a == b {
                    continue;
                }
                if mark.get(b)? != a as i32 {
                    mark.set(b, a as i32)?;
                    value.set(b, 0.0)?;
                    self.columns.push(b as u32);
                }
                value.set(b, value.get(b)? + matrix.weights.get(at)?)?;
            }
            i = next.get(row)?;
        }
        Ok(area)
    }
}
pub(super) fn operator(
    matrix: &Operator,
    groups: &Band<i32>,
    count: usize,
    coverage: &mut Coverage,
) -> io::Result<Operator> {
    let mut row = Gather::new(coverage, groups, count)?;
    let matrix = MatrixValues {
        areas: matrix.areas.read_values()?,
        offsets: matrix.offsets.read_values()?,
        neighbors: matrix.neighbors.read_values()?,
        weights: matrix.weights.read_values()?,
        groups: groups.read_values()?,
    };
    let mut offsets = coverage.scratch(count + 1, 0u32);
    let mut faces = 0usize;
    {
        let mut offsets = offsets.write_values()?;
        for a in 0..count {
            offsets.set(a, u32::try_from(faces).map_err(io::Error::other)?)?;
            row.row(&matrix, a)?;
            faces += row.columns.len();
        }
        offsets.set(count, u32::try_from(faces).map_err(io::Error::other)?)?;
    }
    for a in 0..count {
        row.mark.set(a, -1)?;
    }
    let mut areas = coverage.scratch(count, 0.0);
    let mut diagonal = coverage.scratch(count, 0.0);
    let mut neighbors = coverage.scratch(faces, 0u32);
    let mut weights = coverage.scratch(faces, 0.0);
    {
        let offsets = offsets.read_values()?;
        let mut areas = areas.write_values()?;
        let mut diagonal = diagonal.write_values()?;
        let mut neighbors = neighbors.write_values()?;
        let mut weights = weights.write_values()?;
        for a in 0..count {
            let area = row.row(&matrix, a)?;
            let value = row.value.read_values()?;
            let start = offsets.get(a)? as usize;
            let mut sum = area;
            areas.set(a, area)?;
            for (offset, &j) in row.columns.iter().enumerate() {
                let at = start + offset;
                let weight = value.get(j as usize)?;
                neighbors.set(at, j)?;
                weights.set(at, weight)?;
                sum += weight;
            }
            diagonal.set(a, sum)?;
        }
    }
    Ok(Operator {
        count,
        cells: None,
        areas,
        diagonal,
        offsets,
        neighbors,
        weights,
    })
}
