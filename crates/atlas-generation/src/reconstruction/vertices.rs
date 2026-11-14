//! Geometry shared by channel interpolators on one immutable captured topology.
use super::topology::Vertex;
use crate::storage::{Band, Coverage};
use std::{cell::RefCell, io};

pub struct Vertices(RefCell<Cache>);
struct Cache {
    epsilon: Band<f64>,
    ready: Band<u8>,
    count: Band<u8>,
    cells: Band<u32>,
    hanging: Band<u32>,
    coarse: Band<u32>,
}
impl Vertices {
    pub fn new(cells: usize, coverage: &mut Coverage) -> io::Result<Self> {
        let corners = cells
            .checked_mul(4)
            .ok_or_else(|| io::Error::other("Captured corners exceed address space"))?;
        let neighbors = corners
            .checked_mul(4)
            .ok_or_else(|| io::Error::other("Captured corner neighbors exceed address space"))?;
        Ok(Self(RefCell::new(Cache {
            epsilon: coverage.scratch(corners, 0.0),
            ready: coverage.scratch(corners, 0),
            count: coverage.scratch(corners, 0),
            cells: coverage.scratch(neighbors, 0),
            hanging: coverage.scratch(corners, 0),
            coarse: coverage.scratch(corners, 0),
        })))
    }
    pub(super) fn get(
        &self,
        at: usize,
        point: [f64; 2],
        epsilon: f64,
    ) -> io::Result<Option<Vertex>> {
        let cache = self.0.borrow();
        if cache.ready.get(at)? == 0 || cache.epsilon.get(at)? != epsilon {
            return Ok(None);
        }
        let mut cells = Vec::with_capacity(4);
        for offset in 0..usize::from(cache.count.get(at)?) {
            cells.push(cache.cells.get(at * 4 + offset)? as usize);
        }
        Ok(Some(Vertex {
            point,
            epsilon,
            cells,
            hanging: decode(cache.hanging.get(at)?),
            coarse: decode(cache.coarse.get(at)?),
        }))
    }
    pub(super) fn put(&self, at: usize, vertex: &Vertex) -> io::Result<()> {
        let mut cache = self.0.borrow_mut();
        cache.ready.set(at, 0)?;
        for (offset, &cell) in vertex.cells.iter().enumerate() {
            cache.cells.set(
                at * 4 + offset,
                u32::try_from(cell).map_err(io::Error::other)?,
            )?;
        }
        cache.count.set(at, vertex.cells.len() as u8)?;
        cache.hanging.set(at, encode(vertex.hanging)?)?;
        cache.coarse.set(at, encode(vertex.coarse)?)?;
        cache.epsilon.set(at, vertex.epsilon)?;
        cache.ready.set(at, 1)
    }
}
fn encode(cell: Option<usize>) -> io::Result<u32> {
    cell.map_or(Ok(0), |cell| {
        u32::try_from(cell)
            .ok()
            .and_then(|cell| cell.checked_add(1))
            .ok_or_else(|| io::Error::other("Captured corner cell exceeds index representation"))
    })
}
fn decode(cell: u32) -> Option<usize> {
    cell.checked_sub(1).map(|cell| cell as usize)
}
