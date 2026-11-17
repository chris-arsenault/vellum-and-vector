use super::{multigrid::Level, operator::Operator};
use crate::{
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

fn dot(a: &ReadBand<f64>, b: &ReadBand<f64>) -> io::Result<f64> {
    let mut sum = 0.0;
    let n = a.len();
    let a = a.read_values()?;
    let b = b.read_values()?;
    for i in 0..n {
        sum += a.get(i)? * b.get(i)?;
    }
    Ok(sum)
}
fn norm(matrix: &Operator, values: &Band<f64>) -> io::Result<f64> {
    let mut sum = 0.0;
    let n = values.len();
    let values = values.read_only();
    let diagonal = matrix.diagonal.read_only();
    let values = values.read_values()?;
    let diagonal = diagonal.read_values()?;
    for i in 0..n {
        sum += values.get(i)?.powi(2) / diagonal.get(i)?;
    }
    Ok(sum)
}
fn conserve_components(
    matrix: &Operator,
    input: &ReadBand<f64>,
    result: &mut Band<f64>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let n = input.len();
    let mut visited = coverage.scratch(n, 0u8);
    let mut queue = coverage.scratch(n, 0u32);
    let input = input.read_values()?;
    let areas = matrix.areas.read_values()?;
    let offsets = matrix.offsets.read_values()?;
    let neighbors = matrix.neighbors.read_values()?;
    let mut result = result.write_values()?;
    let mut visited = visited.write_values()?;
    let mut queue = queue.write_values()?;
    for start in 0..n {
        if visited.get(start)? != 0 {
            continue;
        }
        queue.set(0, start as u32)?;
        let mut tail = 1;
        visited.set(start, 1)?;
        let mut imbalance = 0.0;
        let mut area = 0.0;
        let mut head = 0;
        while head < tail {
            let i = queue.get(head)? as usize;
            let cell_area = areas.get(i)?;
            imbalance += (input.get(i)? - result.get(i)?) * cell_area;
            area += cell_area;
            for at in offsets.get(i)?..offsets.get(i + 1)? {
                let j = neighbors.get(at as usize)? as usize;
                if visited.get(j)? != 0 {
                    continue;
                }
                visited.set(j, 1)?;
                queue.set(tail, j as u32)?;
                tail += 1;
            }
            head += 1;
        }
        for at in 0..tail {
            let i = queue.get(at)? as usize;
            result.set(i, result.get(i)? + imbalance / area)?;
        }
    }
    Ok(())
}
fn solve(
    level: &mut Level,
    input: &ReadBand<f64>,
    coverage: &mut Coverage,
) -> io::Result<Band<f64>> {
    let n = input.len();
    let mut result = coverage.scratch(n, 0.0);
    let mut projected = coverage.scratch(n, 0.0);
    {
        let input = input.read_values()?;
        let mut result = result.write_values()?;
        for i in 0..n {
            result.set(i, input.get(i)?)?;
        }
    }
    level.matrix.product(&result.read_only(), &mut projected)?;
    let mut rhs = coverage.scratch(n, 0.0);
    let mut residual = coverage.scratch(n, 0.0);
    let mut direction = coverage.scratch(n, 0.0);
    {
        let input = input.read_values()?;
        let areas = level.matrix.areas.read_values()?;
        let projected = projected.read_values()?;
        let mut rhs = rhs.write_values()?;
        let mut residual = residual.write_values()?;
        for i in 0..n {
            let value = input.get(i)? * areas.get(i)?;
            rhs.set(i, value)?;
            residual.set(i, value - projected.get(i)?)?;
        }
    }
    let preconditioned = level.apply(&residual.read_only())?;
    {
        let preconditioned = preconditioned.read_values()?;
        let mut direction = direction.write_values()?;
        for i in 0..n {
            direction.set(i, preconditioned.get(i)?)?;
        }
    }
    let mut error = dot(&residual.read_only(), &direction.read_only())?;
    let tolerance = (norm(&level.matrix, &rhs)? * 1e-12).max(1e-12);
    for _ in 0..n {
        if norm(&level.matrix, &residual)? <= tolerance {
            break;
        }
        level
            .matrix
            .product(&direction.read_only(), &mut projected)?;
        let alpha = error / dot(&direction.read_only(), &projected.read_only())?;
        {
            let mut result = result.write_values()?;
            let mut residual = residual.write_values()?;
            let direction = direction.read_values()?;
            let projected = projected.read_values()?;
            for i in 0..n {
                result.set(i, result.get(i)? + alpha * direction.get(i)?)?;
                residual.set(i, residual.get(i)? - alpha * projected.get(i)?)?;
            }
        }
        let preconditioned = level.apply(&residual.read_only())?;
        let next = dot(&residual.read_only(), &preconditioned)?;
        let beta = next / error;
        {
            let mut direction = direction.write_values()?;
            let preconditioned = preconditioned.read_values()?;
            for i in 0..n {
                direction.set(i, preconditioned.get(i)? + beta * direction.get(i)?)?;
            }
        }
        error = next;
    }
    conserve_components(&level.matrix, input, &mut result, coverage)?;
    Ok(result)
}
pub struct Smoother {
    level: Level,
}
impl Smoother {
    pub fn new(
        mesh: &TriangularLattice,
        coverage: &mut Coverage,
        length: f64,
        active: Option<&ReadBand<u8>>,
    ) -> io::Result<Self> {
        Ok(Self {
            level: Level::new(Operator::new(mesh, coverage, length, active)?, coverage)?,
        })
    }
    pub fn apply(
        &mut self,
        input: &ReadBand<f64>,
        coverage: &mut Coverage,
    ) -> io::Result<Band<f64>> {
        let n = self.level.matrix.count;
        let mut local = coverage.scratch(n, 0.0);
        let mut result = coverage.scratch(input.len(), 0.0);
        {
            let count = input.len();
            let input = input.read_values()?;
            let cells = self
                .level
                .matrix
                .cells
                .as_ref()
                .expect("Fine matrix owns its cells")
                .read_values()?;
            let mut result = result.write_values()?;
            let mut local = local.write_values()?;
            for i in 0..count {
                result.set(i, input.get(i)?)?;
            }
            for i in 0..n {
                local.set(i, input.get(cells.get(i)? as usize)?)?;
            }
        }
        let solved = solve(&mut self.level, &local.read_only(), coverage)?;
        let cells = self
            .level
            .matrix
            .cells
            .as_ref()
            .expect("Fine matrix owns its cells");
        {
            let cells = cells.read_values()?;
            let solved = solved.read_values()?;
            let mut result = result.write_values()?;
            for i in 0..n {
                result.set(cells.get(i)? as usize, solved.get(i)?)?;
            }
        }
        Ok(result)
    }
}
pub fn smooth(
    mesh: &TriangularLattice,
    coverage: &mut Coverage,
    input: &ReadBand<f64>,
    length: f64,
    active: Option<&ReadBand<u8>>,
) -> io::Result<Band<f64>> {
    Smoother::new(mesh, coverage, length, active)?.apply(input, coverage)
}
