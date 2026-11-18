//! Retained settlement geography and development contracts, independent of atlas adapters.
pub mod access;
pub mod addresses;
pub mod byway;
#[allow(
    clippy::disallowed_types,
    reason = "the POI catalogue owns the concrete settlement identities"
)]
pub mod catalogue;
pub mod edits;
pub mod fabric;
pub mod founding;
pub mod geometry;
pub mod ground;
pub mod growth;
pub mod influence;
pub mod land;
pub mod land_sites;
pub mod lanes;
pub mod neighbourhood;
pub mod network;
pub mod plots;
pub mod roofs;
pub mod seat;
pub mod settings;
pub mod signals;
pub mod siting;
pub mod story;
pub mod wards;
