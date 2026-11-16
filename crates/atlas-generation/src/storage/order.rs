use super::{Band, Coverage, ReadBand};
use crate::{
    hpc::{radix_order, Direction, KeyedHeap, NumericKey},
    lattice::BLOCK_CELLS,
};
use std::io;

/// Sorted block runs page with the same cache; resident merge state is one cursor per block.
pub struct OrderedCells {
    cells: Band<u32>,
    keys: Band<f64>,
    lengths: Vec<usize>,
    at: Vec<usize>,
    heap: KeyedHeap,
    failed: bool,
}
impl Coverage {
    pub fn order(&mut self, key: &ReadBand<f64>, direction: Direction) -> io::Result<OrderedCells> {
        let blocks = key.len().div_ceil(BLOCK_CELLS);
        let mut cells = self.scratch(key.len(), 0u32);
        let mut keys = self.scratch(key.len(), 0.0f64);
        let mut lengths = vec![0; blocks];
        let mut heap = KeyedHeap::new([direction], Direction::Ascending);
        for (block, length) in lengths.iter_mut().enumerate() {
            let values = key.block_copy(block)?;
            let start = block * BLOCK_CELLS;
            let order =
                radix_order(&[NumericKey::Float(&values)], direction).map_err(io::Error::other)?;
            cells.with_block_mut(block, |into| {
                for (n, &index) in order.iter().enumerate() {
                    into[n] = index as u32;
                }
            })?;
            keys.with_block_mut(block, |into| {
                for (n, &index) in order.iter().enumerate() {
                    into[n] = values[index];
                }
            })?;
            *length = values.len();
            if *length > 0 {
                heap.push(block as u32, [keys.get(start)?]);
            }
        }
        Ok(OrderedCells {
            cells,
            keys,
            lengths,
            at: vec![0; blocks],
            heap,
            failed: false,
        })
    }
}
impl OrderedCells {
    fn advance(&mut self, block: usize) -> io::Result<usize> {
        let start = block * BLOCK_CELLS;
        let cell = start + self.cells.get(start + self.at[block])? as usize;
        self.at[block] += 1;
        if self.at[block] < self.lengths[block] {
            self.heap
                .push(block as u32, [self.keys.get(start + self.at[block])?]);
        }
        Ok(cell)
    }
}
impl Iterator for OrderedCells {
    type Item = io::Result<usize>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.failed {
            return None;
        }
        let (block, _) = self.heap.pop()?;
        let result = self.advance(block as usize);
        self.failed = result.is_err();
        Some(result)
    }
}
