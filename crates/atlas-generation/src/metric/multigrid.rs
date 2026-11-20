use super::{coarse, operator::Operator};
use crate::storage::{Band, Coverage, ReadBand};
use std::io;

enum Solver {
    Diagonal,
    Factor(Vec<f64>),
    Coarse {
        groups: Band<i32>,
        level: Box<Level>,
    },
}
pub(super) struct Level {
    pub matrix: Operator,
    x: Band<f64>,
    rhs: Band<f64>,
    scratch: Band<f64>,
    solver: Solver,
}
fn factor(matrix: &Operator) -> io::Result<Vec<f64>> {
    let n = matrix.count;
    let mut lower = vec![0.0; n * n];
    for i in 0..n {
        lower[i * n + i] = matrix.diagonal.get(i)?;
        for at in matrix.offsets.get(i)?..matrix.offsets.get(i + 1)? {
            let at = at as usize;
            lower[i * n + matrix.neighbors.get(at)? as usize] = -matrix.weights.get(at)?;
        }
        for j in 0..=i {
            let mut value = lower[i * n + j];
            for k in 0..j {
                value -= lower[i * n + k] * lower[j * n + k];
            }
            lower[i * n + j] = if i == j {
                value.sqrt()
            } else {
                value / lower[j * n + j]
            };
        }
    }
    Ok(lower)
}
fn triangular_solve(lower: &[f64], rhs: &Band<f64>, x: &mut Band<f64>) -> io::Result<()> {
    let n = rhs.len();
    let rhs = rhs.read_only();
    let rhs = rhs.read_values()?;
    let mut x = x.write_values()?;
    for i in 0..n {
        let mut value = rhs.get(i)?;
        for j in 0..i {
            value -= lower[i * n + j] * x.get(j)?;
        }
        x.set(i, value / lower[i * n + i])?;
    }
    for i in (0..n).rev() {
        let mut value = x.get(i)?;
        for j in i + 1..n {
            value -= lower[j * n + i] * x.get(j)?;
        }
        x.set(i, value / lower[i * n + i])?;
    }
    Ok(())
}
impl Level {
    pub fn new(matrix: Operator, coverage: &mut Coverage) -> io::Result<Self> {
        let n = matrix.count;
        let solver = if matrix.weights.is_empty() {
            Solver::Diagonal
        } else if n <= 32 {
            Solver::Factor(factor(&matrix)?)
        } else {
            let (groups, count) = coarse::aggregate(&matrix, coverage)?;
            let operator = coarse::operator(&matrix, &groups, count, coverage)?;
            Solver::Coarse {
                groups,
                level: Box::new(Self::new(operator, coverage)?),
            }
        };
        Ok(Self {
            matrix,
            x: coverage.scratch(n, 0.0),
            rhs: coverage.scratch(n, 0.0),
            scratch: coverage.scratch(n, 0.0),
            solver,
        })
    }
    pub fn apply(&mut self, residual: &ReadBand<f64>) -> io::Result<ReadBand<f64>> {
        {
            let n = self.rhs.len();
            let residual = residual.read_values()?;
            let mut rhs = self.rhs.write_values()?;
            for i in 0..n {
                rhs.set(i, residual.get(i)?)?;
            }
        }
        self.cycle()?;
        Ok(self.x.read_only())
    }
    fn smooth(&mut self) -> io::Result<()> {
        let rhs = self.rhs.read_only();
        let diagonal = self.matrix.diagonal.read_only();
        let rhs = rhs.read_values()?;
        let diagonal = diagonal.read_values()?;
        let n = self.x.len();
        for _ in 0..2 {
            self.matrix
                .product(&self.x.read_only(), &mut self.scratch)?;
            let scratch = self.scratch.read_only();
            let scratch = scratch.read_values()?;
            let mut x = self.x.write_values()?;
            // Damped Jacobi: resident bands update as slices, paged bands value by value.
            if let (Some(r), Some(s), Some(d)) =
                (rhs.as_slice(), scratch.as_slice(), diagonal.as_slice())
            {
                if let Some(x) = x.as_mut_slice() {
                    for (i, x) in x.iter_mut().enumerate().take(n) {
                        *x += (2.0 / 3.0) * (r[i] - s[i]) / d[i];
                    }
                    continue;
                }
            }
            for i in 0..n {
                x.set(
                    i,
                    x.get(i)? + (2.0 / 3.0) * (rhs.get(i)? - scratch.get(i)?) / diagonal.get(i)?,
                )?;
            }
        }
        Ok(())
    }
    fn clear_solution(&mut self) -> io::Result<()> {
        let mut x = self.x.write_values()?;
        match x.as_mut_slice() {
            Some(x) => x[..self.matrix.count].fill(0.0),
            None => {
                for i in 0..self.matrix.count {
                    x.set(i, 0.0)?;
                }
            }
        }
        Ok(())
    }
    fn diagonal_solve(&mut self) -> io::Result<()> {
        let rhs = self.rhs.read_values()?;
        let diagonal = self.matrix.diagonal.read_values()?;
        let mut x = self.x.write_values()?;
        if let (Some(r), Some(d), Some(x)) = (rhs.as_slice(), diagonal.as_slice(), x.as_mut_slice())
        {
            for (i, x) in x.iter_mut().enumerate().take(self.matrix.count) {
                *x = r[i] / d[i];
            }
            return Ok(());
        }
        for i in 0..self.matrix.count {
            x.set(i, rhs.get(i)? / diagonal.get(i)?)?;
        }
        Ok(())
    }
    fn cycle(&mut self) -> io::Result<()> {
        self.clear_solution()?;
        match &self.solver {
            Solver::Diagonal => return self.diagonal_solve(),
            Solver::Factor(lower) => return triangular_solve(lower, &self.rhs, &mut self.x),
            Solver::Coarse { .. } => (),
        }
        self.smooth()?;
        self.matrix
            .product(&self.x.read_only(), &mut self.scratch)?;
        let Solver::Coarse { groups, level } = &mut self.solver else {
            unreachable!()
        };
        let count = groups.len();
        let groups = groups.read_values()?;
        {
            let mut coarse_rhs = level.rhs.write_values()?;
            let rhs = self.rhs.read_values()?;
            let scratch = self.scratch.read_values()?;
            // Restriction: each fine residual adds to its coarse group.
            let resident = match (groups.as_slice(), rhs.as_slice(), scratch.as_slice()) {
                (Some(g), Some(r), Some(s)) => coarse_rhs.as_mut_slice().map(|c| {
                    c[..level.matrix.count].fill(0.0);
                    for i in 0..count {
                        c[g[i] as usize] += r[i] - s[i];
                    }
                }),
                _ => None,
            };
            if resident.is_none() {
                for i in 0..level.matrix.count {
                    coarse_rhs.set(i, 0.0)?;
                }
                for i in 0..count {
                    let group = groups.get(i)? as usize;
                    coarse_rhs.set(
                        group,
                        coarse_rhs.get(group)? + rhs.get(i)? - scratch.get(i)?,
                    )?;
                }
            }
        }
        level.cycle()?;
        {
            let coarse_x = level.x.read_values()?;
            let mut x = self.x.write_values()?;
            // Prolongation: each fine value takes its coarse group's correction.
            let resident = match (groups.as_slice(), coarse_x.as_slice()) {
                (Some(g), Some(c)) => x.as_mut_slice().map(|x| {
                    for i in 0..count {
                        x[i] += c[g[i] as usize];
                    }
                }),
                _ => None,
            };
            if resident.is_none() {
                for i in 0..count {
                    x.set(i, x.get(i)? + coarse_x.get(groups.get(i)? as usize)?)?;
                }
            }
        }
        drop(groups);
        self.smooth()
    }
}
