use super::{Band, Coverage, Sample};
use crate::lattice::BLOCK_CELLS;
use std::io;

/// Append samples into paged blocks, then transfer into an exact-length band.
pub struct BandList<T: Sample> {
    chunks: Vec<Band<T>>,
    length: usize,
}
impl<T: Sample> Default for BandList<T> {
    fn default() -> Self {
        Self {
            chunks: Vec::new(),
            length: 0,
        }
    }
}
impl<T: Sample> BandList<T> {
    pub fn len(&self) -> usize {
        self.length
    }
    pub fn is_empty(&self) -> bool {
        self.length == 0
    }
    pub fn push(&mut self, value: T, coverage: &mut Coverage) -> io::Result<()> {
        let offset = self.length % BLOCK_CELLS;
        if self.chunks.is_empty() || offset == 0 {
            self.chunks.push(coverage.scratch(
                if self.length == 0 { 256 } else { BLOCK_CELLS },
                T::default(),
            ));
        } else if offset == self.chunks.last().expect("Append chunk").len() {
            let last = self.chunks.pop().expect("Append chunk");
            let mut next = coverage.scratch((last.len() * 2).min(BLOCK_CELLS), T::default());
            let values = last.read_only().block_copy(0)?;
            next.with_block_mut(0, |into| into[..values.len()].copy_from_slice(&values))?;
            self.chunks.push(next);
        }
        self.chunks
            .last_mut()
            .expect("Append chunk")
            .set(offset, value)?;
        self.length += 1;
        Ok(())
    }
    pub fn finish(self, coverage: &mut Coverage) -> io::Result<Band<T>> {
        let mut band = coverage.scratch(self.length, T::default());
        for (block, chunk) in self.chunks.iter().enumerate() {
            let values = chunk.read_only().block_copy(0)?;
            band.with_block_mut(block, |into| into.copy_from_slice(&values[..into.len()]))?;
        }
        Ok(band)
    }
}
