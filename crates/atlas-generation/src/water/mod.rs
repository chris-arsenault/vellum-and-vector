//! Water owns its stores and retained network. Cell projections never establish rivers.
pub mod balance;
pub mod captured;
pub mod channel_geometry;
#[cfg(test)]
mod channel_tests;
pub mod column;
#[cfg(test)]
mod column_tests;
pub mod drainage;
#[cfg(test)]
mod drainage_tests;
pub mod evolution;
#[cfg(test)]
mod exchange_tests;
pub mod groundwater;
pub mod guidance;
mod import_geometry;
pub(crate) use import_geometry::Stations;
pub mod inherit;
pub mod lake_stage;
#[cfg(test)]
mod lake_tests;
pub mod lakes;
pub mod ledger;
pub mod losses;
pub mod meltwater;
pub mod network;
#[cfg(test)]
mod network_tests;
pub mod ocean;
mod ocean_components;
mod owner;
mod owner_algorithms;
pub mod owner_network;
#[cfg(test)]
mod owner_tests;
pub use owner::{Water, WaterView};
mod history;
#[cfg(test)]
mod ocean_tests;
pub mod passage;
pub mod reaches;
mod resource_input;
mod resources;
pub mod routed_network;
pub mod routing;
pub mod runoff;
#[cfg(test)]
mod runoff_tests;
pub mod sediment;
pub mod significance;
pub mod soil;
pub mod stores;
pub mod streams;
pub mod substrate;
#[cfg(test)]
mod tests;
pub mod visibility;
pub mod warmth;
pub mod year_routing;
#[cfg(test)]
mod year_routing_tests;
