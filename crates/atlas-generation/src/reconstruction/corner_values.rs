//! Channel-local corner values retained by adaptivePoint.ts, backed by shared paged storage.
use crate::storage::{Band, Coverage};
use std::io;

pub(super) struct Values<const N: usize> {
    values: Band<f64>,
    epsilon: Band<f64>,
    ready: Band<u8>,
}
impl<const N: usize> Values<N> {
    pub fn new(cells: usize, coverage: &mut Coverage) -> Self {
        Self {
            values: coverage.scratch(cells * 4 * N, 0.0),
            epsilon: coverage.scratch(cells * 4, 0.0),
            ready: coverage.scratch(cells * 4, 0),
        }
    }
    pub fn get(&self, key: Option<usize>, epsilon: f64) -> io::Result<Option<[f64; N]>> {
        let Some(key) = key else { return Ok(None) };
        if self.ready.get(key)? == 0 || self.epsilon.get(key)? != epsilon {
            return Ok(None);
        }
        let mut result = [0.0; N];
        for (i, value) in result.iter_mut().enumerate() {
            *value = self.values.get(key * N + i)?;
        }
        Ok(Some(result))
    }
    pub fn put(&mut self, key: Option<usize>, epsilon: f64, values: [f64; N]) -> io::Result<()> {
        let Some(key) = key else { return Ok(()) };
        self.ready.set(key, 0)?;
        for (i, value) in values.into_iter().enumerate() {
            self.values.set(key * N + i, value)?;
        }
        self.epsilon.set(key, epsilon)?;
        self.ready.set(key, 1)
    }
}
