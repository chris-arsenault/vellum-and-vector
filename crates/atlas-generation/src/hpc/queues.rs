use std::collections::VecDeque;

pub type CellQueue = VecDeque<u32>;

/// Parallel growable FIFOs. A popped record is a stack value, never a heap object.
pub struct RecordQueue<const N: usize> {
    cells: CellQueue,
    columns: [VecDeque<f64>; N],
}

impl<const N: usize> Default for RecordQueue<N> {
    fn default() -> Self {
        Self {
            cells: CellQueue::new(),
            columns: std::array::from_fn(|_| VecDeque::new()),
        }
    }
}

impl<const N: usize> RecordQueue<N> {
    pub fn push(&mut self, cell: u32, values: [f64; N]) {
        self.cells.push_back(cell);
        for (column, value) in self.columns.iter_mut().zip(values) {
            column.push_back(value);
        }
    }

    pub fn pop(&mut self) -> Option<(u32, [f64; N])> {
        let cell = self.cells.pop_front()?;
        let values =
            std::array::from_fn(|i| self.columns[i].pop_front().expect("queue columns align"));
        Some((cell, values))
    }

    pub fn len(&self) -> usize {
        self.cells.len()
    }
    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }
    pub fn clear(&mut self) {
        self.cells.clear();
        for column in &mut self.columns {
            column.clear();
        }
    }
}
