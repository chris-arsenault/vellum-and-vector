use crate::{
    field::material::MaterialWork,
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::{collections::VecDeque, io};
pub struct Frame {
    pub strength: Band<f64>,
    pub coverage: Band<f64>,
    pub source: Band<i32>,
}
pub struct FrameInput<'a> {
    pub mesh: &'a TriangularLattice,
    pub kind: &'a ReadBand<u8>,
    pub coverage: &'a mut Coverage,
}
struct Shores {
    columns: [Vec<f64>; 6],
    seeds: Vec<usize>,
}
impl Shores {
    fn new(
        work: &FrameInput<'_>,
        waves: &ReadBand<f64>,
        forcing: Option<&ReadBand<f64>>,
    ) -> io::Result<Self> {
        let mut result = Self {
            columns: Default::default(),
            seeds: Vec::new(),
        };
        for cell in 0..work.mesh.len() {
            if work.kind.get(cell)? != 0 {
                continue;
            }
            for edge in 0..3 {
                let Some(next) = work.mesh.neighbor(cell, edge) else {
                    continue;
                };
                if work.kind.get(next)? != 1 {
                    continue;
                }
                let strength = forcing.map_or_else(|| waves.get(next), |f| f.get(cell))?;
                if strength <= 0.0 {
                    continue;
                }
                let ([x, y], [nx, ny], length) = work
                    .mesh
                    .physical_face(cell, edge)
                    .expect("Existing shore face");
                for (column, value) in result
                    .columns
                    .iter_mut()
                    .zip([x, y, nx, ny, length, strength])
                {
                    column.push(value);
                }
                result.seeds.push(cell);
            }
        }
        Ok(result)
    }
    fn normal(&self, source: usize) -> [f64; 2] {
        [self.columns[2][source], self.columns[3][source]]
    }
    fn strength(&self, source: usize) -> f64 {
        self.columns[5][source]
    }
    fn distance(&self, source: usize, [x, y]: [f64; 2]) -> f64 {
        let dx = x - self.columns[0][source];
        let dy = y - self.columns[1][source];
        let [nx, ny] = self.normal(source);
        let length = self.columns[4][source];
        let along = (dx * -ny + dy * nx).clamp(-length / 2.0, length / 2.0);
        (dx + ny * along).hypot(dy - nx * along)
    }
}
struct Reach {
    nearest: Band<i32>,
    distance: Band<f64>,
    queue: VecDeque<usize>,
}
impl Reach {
    fn offer(
        &mut self,
        work: &FrameInput<'_>,
        shores: &Shores,
        width: f64,
        cell: usize,
        source: usize,
    ) -> io::Result<()> {
        let distance = shores.distance(source, work.mesh.position(cell));
        let span = work.mesh.cell_travel(cell, shores.normal(source));
        let held = self.distance.get(cell)?;
        if distance > width + span / 2.0 || distance > held {
            return Ok(());
        }
        let at = self.nearest.get(cell)?;
        if distance == held && at >= 0 && shores.strength(source) <= shores.strength(at as usize) {
            return Ok(());
        }
        self.distance.set(cell, distance)?;
        self.nearest.set(cell, source as i32)?;
        self.queue.push_back(cell);
        Ok(())
    }
}
pub(super) fn frame(
    work: &mut MaterialWork<'_>,
    width: f64,
    waves: &ReadBand<f64>,
    forcing: Option<&ReadBand<f64>>,
) -> io::Result<Frame> {
    build(
        &mut FrameInput {
            mesh: work.mesh,
            kind: &work.water.column.kind,
            coverage: work.coverage,
        },
        width,
        waves,
        forcing,
    )
}
pub fn build(
    work: &mut FrameInput<'_>,
    width: f64,
    waves: &ReadBand<f64>,
    forcing: Option<&ReadBand<f64>>,
) -> io::Result<Frame> {
    let shores = Shores::new(work, waves, forcing)?;
    let n = work.mesh.len();
    let mut reach = Reach {
        nearest: work.coverage.scratch(n, -1),
        distance: work.coverage.scratch(n, f64::INFINITY),
        queue: VecDeque::new(),
    };
    for (source, &cell) in shores.seeds.iter().enumerate() {
        reach.offer(work, &shores, width, cell, source)?;
    }
    while let Some(cell) = reach.queue.pop_front() {
        let source = reach.nearest.get(cell)? as usize;
        for edge in 0..3 {
            let Some(next) = work.mesh.neighbor(cell, edge) else {
                continue;
            };
            if work.kind.get(next)? == 0 {
                reach.offer(work, &shores, width, next, source)?;
            }
        }
    }
    let mut result = Frame {
        strength: work.coverage.scratch(n, 0.0),
        coverage: work.coverage.scratch(n, 0.0),
        source: work.coverage.scratch(n, -1),
    };
    for cell in 0..n {
        let at = reach.nearest.get(cell)?;
        if at < 0 {
            continue;
        }
        let at = at as usize;
        let span = work.mesh.cell_travel(cell, shores.normal(at));
        result.coverage.set(
            cell,
            ((width - reach.distance.get(cell)?) / span + 0.5).clamp(0.0, 1.0),
        )?;
        result.strength.set(cell, shores.strength(at).trunc())?;
        result.source.set(cell, shores.seeds[at] as i32)?;
    }
    Ok(result)
}
