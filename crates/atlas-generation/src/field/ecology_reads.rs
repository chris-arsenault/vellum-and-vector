use super::{shared::Scalar, Field};
use crate::{
    ecology::ReadHabitat, lattice::TriangularLattice, rock::ground::GroundField, scale::MapScale,
    water::WaterView,
};
use std::io;
impl ReadHabitat for Field {
    fn mesh(&self) -> &TriangularLattice {
        &self.mesh
    }
    fn scale(&self) -> &MapScale {
        &self.scale
    }
    fn with_water<T>(&self, read: impl FnOnce(&WaterView) -> T) -> T {
        read(&self.water())
    }
    fn get(&self, name: Scalar, cell: usize) -> io::Result<f64> {
        self.shared.scalar(name).get(cell)
    }
    fn substrate(&self, name: GroundField, cell: usize) -> io::Result<f64> {
        self.ground().view(name).get(cell)
    }
    fn on_river(&self, cell: usize) -> io::Result<bool> {
        let water = self.water.borrow();
        Ok(water.river_reader().order_at(cell, water.kind_at(cell)?) > 0)
    }
}
