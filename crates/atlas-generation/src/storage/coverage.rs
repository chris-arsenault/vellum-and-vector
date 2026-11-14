use super::{band::Allocation, Band, ReadBand, Sample, SharedCache};
use crate::lattice::{Membership, TriangularLattice, BLOCK_CELLS};
use std::{
    io,
    rc::{Rc, Weak},
};

enum Layout {
    Lattice(Rc<TriangularLattice>),
    Samples(usize),
}
/// One ownership/lifetime boundary for typed numerical state and process scratch.
pub struct Coverage {
    layout: Layout,
    cache: SharedCache,
    allocated: Vec<(u64, Weak<dyn Allocation>)>,
    sequence: u64,
}
impl Coverage {
    pub fn new(lattice: Rc<TriangularLattice>, cache: SharedCache) -> Self {
        Self {
            layout: Layout::Lattice(lattice),
            cache,
            allocated: Vec::new(),
            sequence: 0,
        }
    }
    /// Non-geographic arrays (CSR offsets, published samples); not a second map lattice.
    pub fn samples(length: usize, cache: SharedCache) -> Self {
        Self {
            layout: Layout::Samples(length),
            cache,
            allocated: Vec::new(),
            sequence: 0,
        }
    }
    pub fn len(&self) -> usize {
        match &self.layout {
            Layout::Lattice(lattice) => lattice.len(),
            Layout::Samples(length) => *length,
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn allocate<T: Sample>(&mut self, initial: T) -> Band<T> {
        let mut band = self.scratch(self.len(), initial);
        band.retain();
        band
    }
    pub fn scratch<T: Sample>(&mut self, length: usize, initial: T) -> Band<T> {
        let band = Band::new(length, initial, self.cache.clone());
        self.adopt(&band);
        band
    }
    pub fn adopt<T: Sample>(&mut self, band: &Band<T>) {
        self.sequence = self
            .sequence
            .checked_add(1)
            .expect("Coverage allocation identity overflow");
        self.allocated.push((self.sequence, band.registration()));
    }
    pub fn copy_band<T: Sample>(&mut self, band: &Band<T>) -> io::Result<Band<T>> {
        let copy = band.snapshot()?;
        self.adopt(&copy);
        Ok(copy)
    }
    pub fn begin_process(&self) -> u64 {
        self.sequence + 1
    }
    pub fn release_process(&mut self, from: u64) {
        self.allocated.retain(|(sequence, weak)| {
            let Some(band) = weak.upgrade() else {
                return false;
            };
            if *sequence >= from && !band.retained() {
                band.release();
            }
            !band.released()
        });
    }
    pub(crate) fn live(&self, cell: usize, length: usize) -> bool {
        match &self.layout {
            Layout::Lattice(lattice) if length == lattice.len() => {
                lattice.membership(cell) != Membership::NoData
            }
            _ => true,
        }
    }
    pub fn for_each_cell(&self, mut visit: impl FnMut(usize)) {
        for cell in 0..self.len() {
            if self.live(cell, self.len()) {
                visit(cell);
            }
        }
    }
    pub fn reduce<T: Sample, R>(
        &self,
        band: &ReadBand<T>,
        mut seed: R,
        mut fold: impl FnMut(R, T, usize) -> R,
    ) -> io::Result<R> {
        for block in 0..band.len().div_ceil(BLOCK_CELLS) {
            let values = band.block_copy(block)?;
            for (offset, value) in values.into_iter().enumerate() {
                let cell = block * BLOCK_CELLS + offset;
                if self.live(cell, band.len()) {
                    seed = fold(seed, value, cell);
                }
            }
        }
        Ok(seed)
    }
}
impl Drop for Coverage {
    fn drop(&mut self) {
        for (_, weak) in &self.allocated {
            if let Some(band) = weak.upgrade() {
                band.release();
            }
        }
    }
}
