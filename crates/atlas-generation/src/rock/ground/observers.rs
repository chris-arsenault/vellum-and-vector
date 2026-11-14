//! Optional run observers, matching the source column watchers. These are not world history.
use super::GroundEvents;
use crate::rock::{coarsening::Fold, columns::Column, material::MaterialLayer};
use std::io;

#[derive(Default)]
pub struct GroundObservers {
    observers: Vec<Box<dyn GroundEvents>>,
}
impl GroundObservers {
    pub fn watch(&mut self, observer: Box<dyn GroundEvents>) {
        self.observers.push(observer);
    }
}
impl GroundEvents for GroundObservers {
    fn remapped_package(&mut self, column: Column, before: usize, after: usize) -> io::Result<()> {
        for observer in &mut self.observers {
            observer.remapped_package(column, before, after)?;
        }
        Ok(())
    }
    fn constructed(
        &mut self,
        cell: usize,
        material: &MaterialLayer,
        cause: &str,
        amount: f64,
    ) -> io::Result<()> {
        for observer in &mut self.observers {
            observer.constructed(cell, material, cause, amount)?;
        }
        Ok(())
    }
    fn folded(&mut self, cell: usize, column: Column, fold: &Fold<'_>) -> io::Result<()> {
        for observer in &mut self.observers {
            observer.folded(cell, column, fold)?;
        }
        Ok(())
    }
    fn changed(&mut self, cell: usize) -> io::Result<()> {
        for observer in &mut self.observers {
            observer.changed(cell)?;
        }
        Ok(())
    }
}
