//! Published settlement identities; generation morphology and rules live in atlas-generation.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BuildingFunction {
    Residential,
    Civic,
    Economic,
}
impl BuildingFunction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Residential => "residential",
            Self::Civic => "civic",
            Self::Economic => "economic",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FineCraft {
    Jeweller,
    Goldsmith,
    Engraver,
    InstrumentMaker,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Retail {
    Bookseller,
    Clothier,
    Outfitter,
    SpiceMerchant,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Residence {
    Croft,
    Burgage,
    ShopHouse,
    Court,
    Incremental,
    Courtyard,
    Compound,
    Communal,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Kind {
    Market,
    ExchangeHall,
    Provision,
    Retail(Retail),
    FineCraft(FineCraft),
    DomesticCraft,
    HeavyCraft,
    Smithy,
    NoxiousWorks,
    Mill,
    Brewhouse,
    Inn,
    Tavern,
    Cookshop,
    CarrierYard,
    Storehouse,
    Landing,
    AssemblyHall,
    GuildHall,
    CourtHouse,
    Watch,
    Toll,
    Manor,
    Worship,
    Shrine,
    ReligiousHouse,
    Burial,
    Healer,
    Almshouse,
    Learning,
    WaterPoint,
    WashHouse,
    Sanitation,
    Common,
    Garden,
    Park,
    Fairground,
    Entertainment,
    Farmstead,
    Outbuilding,
    ResourceYard,
    CraftPractice,
    Residence(Residence),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Activity {
    Household,
    Trade,
    Hospitality,
    Production,
    Institution,
    Service,
    Agriculture,
}
impl Activity {
    pub const ALL: [Self; 7] = [
        Self::Household,
        Self::Trade,
        Self::Hospitality,
        Self::Production,
        Self::Institution,
        Self::Service,
        Self::Agriculture,
    ];
}
impl FineCraft {
    pub fn label(self) -> &'static str {
        match self {
            Self::Jeweller => "jeweller",
            Self::Goldsmith => "goldsmith",
            Self::Engraver => "engraver",
            Self::InstrumentMaker => "instrument maker",
        }
    }
}
impl Retail {
    pub fn label(self) -> &'static str {
        match self {
            Self::Bookseller => "bookseller",
            Self::Clothier => "clothier",
            Self::Outfitter => "outfitter",
            Self::SpiceMerchant => "spice merchant",
        }
    }
}
