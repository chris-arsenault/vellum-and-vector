//! Place registrations that a founding institution can commission by identity.
use super::{Identity, Kind};

pub(crate) const LANDING: Kind = Kind(Identity::Landing);
pub(crate) const WATCH: Kind = Kind(Identity::Watch);
pub(crate) const STOREHOUSE: Kind = Kind(Identity::Storehouse);
pub(crate) const CARRIER_YARD: Kind = Kind(Identity::CarrierYard);
pub(crate) const EXCHANGE_HALL: Kind = Kind(Identity::ExchangeHall);
pub(crate) const GROVE: Kind = Kind(Identity::Grove);
pub(crate) const COMMON: Kind = Kind(Identity::Common);
pub(crate) const SHRINE: Kind = Kind(Identity::Shrine);
pub(crate) const MANOR: Kind = Kind(Identity::Manor);
pub(crate) const ASSEMBLY_HALL: Kind = Kind(Identity::AssemblyHall);
pub(crate) const LEARNING: Kind = Kind(Identity::Learning);
pub(crate) const GUILD_HALL: Kind = Kind(Identity::GuildHall);
pub(crate) const DOMESTIC_CRAFT: Kind = Kind(Identity::DomesticCraft);
