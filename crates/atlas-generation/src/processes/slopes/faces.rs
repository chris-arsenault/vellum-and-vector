use crate::{
    lattice::TriangularLattice,
    rock::{
        ground::{Ground, GroundField},
        CompiledMix,
    },
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage},
};
use std::{collections::VecDeque, io};
pub(super) struct Faces {
    pub count: usize,
    pub from: Band<i32>,
    pub to: Band<i32>,
    pub distance: Band<f64>,
    pub diffusion: Band<f64>,
    pub volume: Band<f64>,
    pub slots: Band<i32>,
}
impl Faces {
    pub fn new(mesh: &TriangularLattice, coverage: &mut Coverage) -> io::Result<Self> {
        let mut count = 0;
        for cell in 0..mesh.len() {
            for edge in 0..3 {
                if mesh.neighbor(cell, edge).is_some_and(|j| j > cell) {
                    count += 1;
                }
            }
        }
        let mut result = Self {
            count,
            from: coverage.scratch(count, 0),
            to: coverage.scratch(count, 0),
            distance: coverage.scratch(count, 0.0),
            diffusion: coverage.scratch(count, f64::NAN),
            volume: coverage.scratch(count, 0.0),
            slots: coverage.scratch(mesh.len() * 3, -1),
        };
        let mut index = 0;
        for cell in 0..mesh.len() {
            for edge in 0..3 {
                let Some(next) = mesh.neighbor(cell, edge).filter(|&j| j > cell) else {
                    continue;
                };
                let back = (0..3)
                    .find(|&e| mesh.neighbor(next, e) == Some(cell))
                    .ok_or_else(|| io::Error::other("Nonreciprocal slope face"))?;
                result.slots.set(cell * 3 + edge, index as i32)?;
                result.slots.set(next * 3 + back, index as i32)?;
                result.from.set(index, cell as i32)?;
                result.to.set(index, next as i32)?;
                result.distance.set(index, mesh.edge_length(cell, edge))?;
                index += 1;
            }
        }
        Ok(result)
    }
    fn responses(
        &mut self,
        ground: &Ground,
        mesh: &TriangularLattice,
        mix: &CompiledMix,
        cell: usize,
    ) -> io::Result<()> {
        let elevation = ground.view(GroundField::Elevation);
        let height = elevation.get(cell)?;
        let mut gives = None;
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge).filter(|&j| j != cell) else {
                continue;
            };
            let beside = elevation.get(next)?;
            if height < beside || (height == beside && next < cell) {
                continue;
            }
            if gives.is_none() {
                gives = Some(ground.face_gives_from(cell, mix)?);
            }
            self.diffusion.set(
                self.slots.get(cell * 3 + edge)? as usize,
                gives.as_ref().unwrap().at(next)?,
            )?;
        }
        Ok(())
    }
    fn response(
        &mut self,
        ground: &Ground,
        mesh: &TriangularLattice,
        mix: &CompiledMix,
        index: usize,
    ) -> io::Result<f64> {
        let held = self.diffusion.get(index)?;
        if !held.is_nan() {
            return Ok(held);
        }
        let (i, j) = (self.from.get(index)? as usize, self.to.get(index)? as usize);
        let heights = ground.view(GroundField::Elevation);
        let source = if heights.get(i)? >= heights.get(j)? {
            i
        } else {
            j
        };
        self.responses(ground, mesh, mix, source)?;
        self.diffusion.get(index)
    }
    fn exchange(
        &mut self,
        input: &Relaxation<'_>,
        heights: &mut Band<f64>,
        index: usize,
    ) -> io::Result<f64> {
        let (i, j) = (self.from.get(index)? as usize, self.to.get(index)? as usize);
        let (area_i, area_j) = (input.mesh.area(i), input.mesh.area(j));
        let old = self.volume.get(index)?;
        let inverse = 1.0 / area_i + 1.0 / area_j;
        let head = heights.get(i)? - heights.get(j)? + old * inverse;
        let distance = self.distance.get(index)?;
        let driving = if head > 0.0 {
            (head - input.stable.get(i)? * distance).max(0.0)
        } else {
            (head + input.stable.get(j)? * distance).min(0.0)
        };
        let diffusion = if driving == 0.0 {
            0.0
        } else {
            self.response(input.ground, input.mesh, input.mix, index)?
        };
        let volume = if diffusion > 0.0 {
            driving / (inverse * (1.0 + 1.0 / diffusion))
        } else {
            0.0
        };
        let change = volume - old;
        heights.set(i, heights.get(i)? - change / area_i)?;
        heights.set(j, heights.get(j)? + change / area_j)?;
        self.volume.set(index, volume)?;
        Ok(change.abs() * (1.0 / area_i).max(1.0 / area_j))
    }
    pub fn relax(
        &mut self,
        input: Relaxation<'_>,
        heights: &mut Band<f64>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let mut queue: VecDeque<usize> = (0..self.count).collect();
        let mut queued = coverage.scratch(self.count, 1u8);
        while let Some(index) = queue.pop_front() {
            queued.set(index, 0)?;
            let movement = self.exchange(&input, heights, index)?;
            if movement <= MapScale::metres(1.0, LengthUnit::Native) {
                continue;
            }
            for cell in [self.from.get(index)? as usize, self.to.get(index)? as usize] {
                for edge in 0..3 {
                    let next = self.slots.get(cell * 3 + edge)?;
                    if next < 0 || queued.get(next as usize)? != 0 {
                        continue;
                    }
                    queue.push_back(next as usize);
                    queued.set(next as usize, 1)?;
                }
            }
        }
        Ok(())
    }
}
pub(super) struct Relaxation<'a> {
    pub ground: &'a Ground,
    pub mesh: &'a TriangularLattice,
    pub mix: &'a CompiledMix,
    pub stable: &'a Band<f64>,
}
