//! Packed numerical work structures. No host, database or per-cell object dependencies.
mod groups;
mod heap;
mod membership;
mod pair_index;
mod queues;
mod radix;

pub use groups::{group_by_label, LabelGroups, UnionFind};
pub use heap::{Direction, KeyedHeap, MultiKeyHeap, TopK};
pub use membership::{BitSet, EpochStamps, SmallIntSet, Worklist};
pub use pair_index::IntPairIndex;
pub use queues::{CellQueue, RecordQueue};
pub use radix::{radix_order, NumericKey};

/// Standard packed append buffers; consuming the Vec transfers ownership of its allocation.
pub type CellList = Vec<u32>;
pub type FloatList = Vec<f64>;
