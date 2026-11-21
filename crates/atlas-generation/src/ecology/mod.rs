//! Ecology grows retained communities on the shared physical field.
pub mod animals;
pub mod biomes;
pub mod carbon;
pub mod crossing;
pub mod disturbance;
pub mod environment;
pub mod establishment;
pub mod forcing;
pub mod groups;
pub mod growth;
pub mod history;
pub mod ignition;
pub mod lifecycle;
pub mod movement;
pub mod regions;
pub mod soils;
pub mod vegetation;
use crate::{
    field::shared::{Scalar, SharedFields},
    lattice::TriangularLattice,
    rock::ground::{Ground, GroundField},
    scale::{MapScale, RelativeMeasure},
    water::{network::RiverReader, WaterView},
};
use std::io;
pub struct Habitat<'a> {
    pub mesh: &'a TriangularLattice,
    pub scale: &'a MapScale,
    pub fields: &'a mut SharedFields,
    pub ground: &'a mut Ground,
    pub water: &'a WaterView,
    pub rivers: &'a RiverReader<'a>,
}
/// Ecology queries require only read capabilities; process mutation stays on Habitat.
pub trait ReadHabitat {
    fn mesh(&self) -> &TriangularLattice;
    fn scale(&self) -> &MapScale;
    fn with_water<T>(&self, read: impl FnOnce(&WaterView) -> T) -> T;
    fn get(&self, name: Scalar, cell: usize) -> io::Result<f64>;
    fn substrate(&self, name: GroundField, cell: usize) -> io::Result<f64>;
    fn on_river(&self, cell: usize) -> io::Result<bool>;
    fn length(&self, fraction: f64) -> io::Result<f64> {
        Ok(self
            .scale()
            .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value())
    }
}
impl ReadHabitat for Habitat<'_> {
    fn mesh(&self) -> &TriangularLattice {
        self.mesh
    }
    fn scale(&self) -> &MapScale {
        self.scale
    }
    fn with_water<T>(&self, read: impl FnOnce(&WaterView) -> T) -> T {
        read(self.water)
    }
    fn get(&self, name: Scalar, cell: usize) -> io::Result<f64> {
        self.get(name, cell)
    }
    fn substrate(&self, name: GroundField, cell: usize) -> io::Result<f64> {
        self.substrate(name, cell)
    }
    fn on_river(&self, cell: usize) -> io::Result<bool> {
        self.on_river(cell)
    }
}
impl Habitat<'_> {
    pub fn on_river(&self, cell: usize) -> io::Result<bool> {
        Ok(self
            .rivers
            .order_at(cell, self.water.column.kind.get(cell)?)
            > 0)
    }
    pub fn length(&self, fraction: f64) -> io::Result<f64> {
        Ok(self
            .scale
            .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value())
    }
    pub fn get(&self, name: Scalar, cell: usize) -> io::Result<f64> {
        self.fields.scalar(name).get(cell)
    }
    pub fn set(&mut self, name: Scalar, cell: usize, value: f64) -> io::Result<()> {
        self.fields.scalar_mut(name).set(cell, value)
    }
    pub fn add(&mut self, name: Scalar, cell: usize, value: f64) -> io::Result<()> {
        self.set(name, cell, self.get(name, cell)? + value)
    }
    pub fn substrate(&self, name: GroundField, cell: usize) -> io::Result<f64> {
        self.ground.view(name).get(cell)
    }
}
pub fn unit(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}
pub fn approach(value: f64, target: f64, years: f64, time: f64) -> f64 {
    target + (value - target) * (-years / time).exp()
}
#[derive(Clone, Copy)]
pub struct Forcing {
    pub growth: f64,
    pub fire: f64,
    pub preservation: f64,
    pub productivity: f64,
    pub grazing: f64,
    pub seasonality: f64,
    pub migration: f64,
    pub recovery: f64,
    pub fire_regime: f64,
    pub toxicity: f64,
    pub dispersal: f64,
    pub quickening: f64,
    pub stillness: f64,
    pub verdure: f64,
    pub salting: f64,
    /// The share of a cell people keep under fields and buildings, where nothing wild grows.
    pub farmed: f64,
    /// The share people keep under pasture, where their herds keep grass and stop woods.
    pub grazed: f64,
    /// How heavily the people here hunt, from 0 to 1.
    pub hunting: f64,
    /// How heavily the people here fish the water beside them, from 0 to 1.
    pub fishing: f64,
}
impl Default for Forcing {
    fn default() -> Self {
        Self {
            growth: 0.0,
            fire: 0.0,
            preservation: 0.0,
            productivity: 1.0,
            grazing: 1.0,
            seasonality: 0.3,
            migration: 1.0,
            recovery: 1.0,
            fire_regime: 1.0,
            toxicity: 0.0,
            dispersal: 0.0,
            quickening: 0.0,
            stillness: 0.0,
            verdure: 0.0,
            salting: 0.0,
            farmed: 0.0,
            grazed: 0.0,
            hunting: 0.0,
            fishing: 0.0,
        }
    }
}
impl Forcing {
    /// The share of a cell a plant group cannot take from people: fields and buildings for
    /// every group, and pasture too for all but grass, which the herds keep.
    pub fn cleared_for(&self, grass: bool) -> f64 {
        let taken = if grass {
            self.farmed
        } else {
            self.farmed + self.grazed
        };
        taken.clamp(0.0, 1.0)
    }
}
