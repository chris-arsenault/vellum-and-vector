//! Shared triangular topology for every map; no regional representation fork.
mod boundary;
pub mod fans;
pub mod hexes;
pub mod sampling;
mod triangular;
mod window;
mod world;
pub use boundary::{BoundarySupport, Crossing, Ghost, GhostChannel};
pub use triangular::{
    LatticeInput, PeriodicFrame, TriangularFrame, TriangularLattice, TRIANGLE_AREA,
};
pub use world::{world_shape, WorldLatticeOptions};

pub const BLOCK_SHIFT: usize = 14;
pub const BLOCK_CELLS: usize = 1 << BLOCK_SHIFT;
