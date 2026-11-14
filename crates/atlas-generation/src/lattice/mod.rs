//! Shared triangular topology for world and region; no regional representation fork.
pub mod fans;
pub mod sampling;
mod triangular;
mod window;
mod world;
pub use triangular::{
    LatticeInput, Membership, PeriodicFrame, TriangularFrame, TriangularLattice, TRIANGLE_AREA,
};
pub use world::{world_shape, WorldLatticeOptions};

pub const BLOCK_SHIFT: usize = 14;
pub const BLOCK_CELLS: usize = 1 << BLOCK_SHIFT;
