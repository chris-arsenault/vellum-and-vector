//! Typed paged numerical state with host-owned disposable scratch.
// Arconis: docs/architecture/subsystems.arconis#item=numerical — working numerical representation read and written by generation.
mod band;
mod band_list;
mod cache;
mod coverage;
mod memory;
mod order;
mod sample;
mod scratch;
pub use band::{Band, BlockSource, ReadBand, ReadBlock, ReadValues, WriteBlock, WriteValues};
pub use band_list::BandList;
pub use cache::{BlockCache, CacheStats, SharedCache};
pub use coverage::Coverage;
pub use memory::MemoryBudget;
pub use order::OrderedCells;
pub use sample::Sample;
pub use scratch::{BlockScratch, RandomAccessFile};
