//! People live in owned layers on the same physical lattice as their ground.
mod carry;
pub mod catalogue;
pub mod history;
pub mod identity;
mod loss;
pub mod operations;
mod owner;
mod storage;
pub use storage::{HumanField, HumanLayers, HumanSeed};
