//! House numbers along a street: odd on the left, even on the right, counted from the end
//! nearest the settlement's centre, where every street begins. The rule is shared with the
//! town tools, which renumber the streets a creator's edit touches (`atlas_map::town`).
pub use atlas_map::town::{address, numbers};
