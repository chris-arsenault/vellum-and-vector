//! Explicit store transfers from water/stores.ts, with column contents in shared bands.
use crate::storage::{Band, ReadBand};
use std::{io, rc::Rc};

pub struct WaterStore {
    pub held: f64,
    pub capacity: f64,
    pub retention: f64,
}
impl WaterStore {
    pub fn room(&self) -> f64 {
        (self.capacity - self.held).max(0.0)
    }
    pub fn drain_excess(&mut self) -> f64 {
        let released = (self.held - self.capacity).max(0.0);
        self.held -= released;
        released
    }
    pub fn receive(&mut self, amount: f64) -> f64 {
        let supplied = amount.max(0.0);
        let kept = supplied.min(self.room());
        self.held += kept;
        supplied - kept
    }
    pub fn give(&mut self, request: f64) -> f64 {
        let demand = request.max(0.0);
        let amount = if self.retention > 0.0 {
            self.held * -(-demand / self.retention).exp_m1()
        } else {
            self.held.min(demand)
        };
        self.held -= amount;
        amount
    }
}
pub type Capacity = Rc<dyn Fn(usize) -> io::Result<f64>>;
pub struct StoreColumn {
    pub(super) contents: Band<f64>,
    capacity: Capacity,
    retained: bool,
    metres_per_unit: f64,
}
/// A consumer cannot turn the public read capability into a water writer.
/// ```compile_fail
/// use atlas_generation::water::stores::StoreView;
/// fn write(view: StoreView) { view.replace(0, 3.0); }
/// ```
#[derive(Clone)]
pub struct StoreView {
    contents: ReadBand<f64>,
    capacity: Capacity,
    metres_per_unit: f64,
}
impl crate::execution::QueryValue for StoreView {}
impl StoreColumn {
    pub fn new(
        contents: Band<f64>,
        capacity: Capacity,
        retained: bool,
        metres_per_unit: f64,
    ) -> Self {
        Self {
            contents,
            capacity,
            retained,
            metres_per_unit,
        }
    }
    pub fn read_only(&self) -> StoreView {
        StoreView {
            contents: self.contents.read_only(),
            capacity: self.capacity.clone(),
            metres_per_unit: self.metres_per_unit,
        }
    }
    pub fn replace(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        self.contents
            .set(cell, depth.max(0.0) / self.metres_per_unit)
    }
    pub fn at(&self, cell: usize) -> io::Result<WaterStore> {
        let capacity = (self.capacity)(cell)?;
        Ok(WaterStore {
            held: self.contents.get(cell)? * self.metres_per_unit,
            capacity,
            retention: if self.retained { capacity } else { 0.0 },
        })
    }
    pub fn receive(&mut self, cell: usize, depth: f64) -> io::Result<f64> {
        let mut store = self.at(cell)?;
        let overflow = store.receive(depth);
        self.replace(cell, store.held)?;
        Ok(overflow)
    }
    pub fn give(&mut self, cell: usize, depth: f64) -> io::Result<f64> {
        let mut store = self.at(cell)?;
        let released = store.give(depth);
        self.replace(cell, store.held)?;
        Ok(released)
    }
}
impl StoreView {
    /// Stored representation, before conversion to metres at the store boundary.
    pub fn contents(&self) -> ReadBand<f64> {
        self.contents.clone()
    }
    pub fn held(&self, cell: usize) -> io::Result<f64> {
        Ok(self.contents.get(cell)? * self.metres_per_unit)
    }
    pub fn capacity(&self, cell: usize) -> io::Result<f64> {
        (self.capacity)(cell)
    }
    pub fn room(&self, cell: usize) -> io::Result<f64> {
        Ok((self.capacity(cell)? - self.held(cell)?).max(0.0))
    }
}
pub struct Transfer {
    pub given: f64,
    pub received: f64,
    pub overflow: f64,
}
pub fn transfer_column(
    from: &mut StoreColumn,
    to: &mut StoreColumn,
    cell: usize,
    request: f64,
) -> io::Result<Transfer> {
    let given = from.give(cell, request)?;
    let overflow = to.receive(cell, given)?;
    Ok(Transfer {
        given,
        received: given - overflow,
        overflow,
    })
}
