use super::operator::Operator;
use crate::storage::{Band, Coverage};
use std::io;

pub(super) fn aggregate(
    matrix: &Operator,
    coverage: &mut Coverage,
) -> io::Result<(Band<i32>, usize)> {
    let mut groups = coverage.scratch(matrix.count, -1i32);
    let mut count = 0;
    for i in 0..matrix.count {
        if groups.get(i)? >= 0 {
            continue;
        }
        groups.set(i, count)?;
        for at in matrix.offsets.get(i)?..matrix.offsets.get(i + 1)? {
            let j = matrix.neighbors.get(at as usize)? as usize;
            if groups.get(j)? < 0 {
                groups.set(j, count)?;
            }
        }
        count += 1;
    }
    Ok((groups, count as usize))
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
        for i in (0..groups.len()).rev() {
            let group = groups.get(i)? as usize;
            next.set(i, heads.get(group)?)?;
            heads.set(group, i as i32)?;
        }
        Ok(Self {
            heads,
            next,
            mark: coverage.scratch(count, -1),
            value: coverage.scratch(count, 0.0),
            columns: Vec::new(),
        })
    }
    fn row(&mut self, matrix: &Operator, groups: &Band<i32>, a: usize) -> io::Result<f64> {
        let mut area = 0.0;
        self.columns.clear();
        let mut i = self.heads.get(a)?;
        while i >= 0 {
            let row = i as usize;
            area += matrix.areas.get(row)?;
            for at in matrix.offsets.get(row)?..matrix.offsets.get(row + 1)? {
                let at = at as usize;
                let b = groups.get(matrix.neighbors.get(at)? as usize)? as usize;
                if a == b {
                    continue;
                }
                if self.mark.get(b)? != a as i32 {
                    self.mark.set(b, a as i32)?;
                    self.value.set(b, 0.0)?;
                    self.columns.push(b as u32);
                }
                self.value
                    .set(b, self.value.get(b)? + matrix.weights.get(at)?)?;
            }
            i = self.next.get(row)?;
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
    let mut offsets = coverage.scratch(count + 1, 0u32);
    let mut faces = 0usize;
    for a in 0..count {
        offsets.set(a, u32::try_from(faces).map_err(io::Error::other)?)?;
        row.row(matrix, groups, a)?;
        faces += row.columns.len();
    }
    offsets.set(count, u32::try_from(faces).map_err(io::Error::other)?)?;
    for a in 0..count {
        row.mark.set(a, -1)?;
    }
    let mut areas = coverage.scratch(count, 0.0);
    let mut diagonal = coverage.scratch(count, 0.0);
    let mut neighbors = coverage.scratch(faces, 0u32);
    let mut weights = coverage.scratch(faces, 0.0);
    for a in 0..count {
        let area = row.row(matrix, groups, a)?;
        let start = offsets.get(a)? as usize;
        let mut sum = area;
        areas.set(a, area)?;
        for (offset, &j) in row.columns.iter().enumerate() {
            let at = start + offset;
            let weight = row.value.get(j as usize)?;
            neighbors.set(at, j)?;
            weights.set(at, weight)?;
            sum += weight;
        }
        diagonal.set(a, sum)?;
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
