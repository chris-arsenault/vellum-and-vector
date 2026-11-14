//! The two-ring weighted curvature fit used by adaptiveFit.ts.
use super::topology::Topology;
use crate::storage::{Band, Coverage};
use std::io;
pub struct Fits {
    values: Band<f64>,
    ready: Band<u8>,
}
impl Fits {
    pub fn new(count: usize, coverage: &mut Coverage) -> Self {
        Self {
            values: coverage.scratch(count * 5, 0.0),
            ready: coverage.scratch(count, 0),
        }
    }
    pub fn at(
        &mut self,
        t: &Topology,
        read: &dyn Fn(usize) -> io::Result<f64>,
        cell: usize,
    ) -> io::Result<[f64; 5]> {
        if self.ready.get(cell)? == 0 {
            let fit = fit(t, read, cell)?;
            for (i, value) in fit.into_iter().enumerate() {
                self.values.set(cell * 5 + i, value)?;
            }
            self.ready.set(cell, 1)?;
        }
        let mut result = [0.0; 5];
        for (i, value) in result.iter_mut().enumerate() {
            *value = self.values.get(cell * 5 + i)?;
        }
        Ok(result)
    }
}
fn neighbors(t: &Topology, cell: usize) -> io::Result<Vec<usize>> {
    let mut cells = vec![cell];
    for _ in 0..2 {
        let length = cells.len();
        for i in 0..length {
            for at in t.offsets.get(cells[i])?..t.offsets.get(cells[i] + 1)? {
                let other = t.neighbors.get(at as usize)? as usize;
                if !cells.contains(&other) {
                    cells.push(other);
                }
            }
        }
    }
    cells.remove(0);
    Ok(cells)
}
fn fit(t: &Topology, read: &dyn Fn(usize) -> io::Result<f64>, cell: usize) -> io::Result<[f64; 5]> {
    let b = t.cell(cell)?;
    let width = b[2] - b[0];
    let height = b[3] - b[1];
    let center = read(cell)?;
    let mut matrix = [[0.0; 5]; 5];
    let mut rhs = [0.0; 5];
    for other in neighbors(t, cell)? {
        let p = t.cell(other)?;
        let x = (p[0] + p[2] - b[0] - b[2]) / 2.0 / width;
        let y = (p[1] + p[3] - b[1] - b[3]) / 2.0 / height;
        let row = [x, y, x * x, x * y, y * y];
        let weight = 1.0 / (x * x + y * y);
        let delta = read(other)? - center;
        for a in 0..5 {
            rhs[a] += weight * row[a] * delta;
            for k in 0..5 {
                matrix[a][k] += weight * row[a] * row[k];
            }
        }
    }
    let result = solve(matrix, rhs, 5)
        .or_else(|| solve(matrix, rhs, 2))
        .unwrap_or([0.0; 5]);
    Ok([
        result[0] / width,
        result[1] / height,
        result[2] / width.powi(2),
        result[3] / (width * height),
        result[4] / height.powi(2),
    ])
}
fn factor(rows: &mut [[f64; 5]; 5], n: usize) -> Option<[usize; 5]> {
    let mut swaps = [0; 5];
    for column in 0..n {
        let mut pivot = column;
        for row in column + 1..n {
            if rows[row][column].abs() > rows[pivot][column].abs() {
                pivot = row;
            }
        }
        if rows[pivot][column].abs() < 1e-12 {
            return None;
        }
        swaps[column] = pivot;
        rows.swap(pivot, column);
        let diagonal = rows[column][column];
        for row in column + 1..n {
            rows[row][column] /= diagonal;
            for k in column + 1..n {
                rows[row][k] -= rows[row][column] * rows[column][k];
            }
        }
    }
    Some(swaps)
}
fn solve(mut rows: [[f64; 5]; 5], mut rhs: [f64; 5], n: usize) -> Option<[f64; 5]> {
    let swaps = factor(&mut rows, n)?;
    for (i, &swap) in swaps.iter().take(n).enumerate() {
        rhs.swap(i, swap);
    }
    for i in 0..n {
        for j in 0..i {
            rhs[i] -= rows[i][j] * rhs[j];
        }
    }
    for i in (0..n).rev() {
        for j in i + 1..n {
            rhs[i] -= rows[i][j] * rhs[j];
        }
        rhs[i] /= rows[i][i];
    }
    rhs[n..].fill(0.0);
    Some(rhs)
}
