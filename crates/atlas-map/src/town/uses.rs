//! What each building is for, its size, who lives in it and how many storeys it has.
use super::Size;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Trade {
    Baker,
    Weaver,
    Cooper,
    Tanner,
    Potter,
    Carpenter,
    Butcher,
    Chandler,
    Mason,
    Brewer,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Use {
    House,
    Barn,
    Workshop(Trade),
    Shop,
    Craftshop,
    Inn,
    Tavern,
    Smithy,
    Temple,
    Hall,
    MarketHall,
    Mill,
    Warehouse,
    Keep,
    Barracks,
}
impl Use {
    pub fn building_function(self) -> super::BuildingFunction {
        use super::BuildingFunction::*;
        match self {
            Self::House => Residential,
            Self::Temple | Self::Hall | Self::Keep | Self::Barracks => Civic,
            Self::Barn
            | Self::Workshop(_)
            | Self::Shop
            | Self::Craftshop
            | Self::Inn
            | Self::Tavern
            | Self::Smithy
            | Self::MarketHall
            | Self::Mill
            | Self::Warehouse => Economic,
        }
    }
    /// Every use, workshops once per trade.
    pub fn all() -> impl Iterator<Item = Self> {
        [
            Self::House,
            Self::Shop,
            Self::Craftshop,
            Self::Barn,
            Self::Inn,
            Self::Tavern,
            Self::Smithy,
            Self::Temple,
            Self::Hall,
            Self::MarketHall,
            Self::Mill,
            Self::Warehouse,
            Self::Keep,
            Self::Barracks,
        ]
        .into_iter()
        .chain(Trade::ALL.into_iter().map(Self::Workshop))
    }
    /// The published `use` value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::House => "house",
            Self::Barn => "barn",
            Self::Workshop(trade) => trade.as_str(),
            Self::Shop => "shop",
            Self::Craftshop => "workshop",
            Self::Inn => "inn",
            Self::Tavern => "tavern",
            Self::Smithy => "smithy",
            Self::Temple => "temple",
            Self::Hall => "hall",
            Self::MarketHall => "marketHall",
            Self::Mill => "mill",
            Self::Warehouse => "warehouse",
            Self::Keep => "keep",
            Self::Barracks => "barracks",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        Self::all().find(|use_| use_.as_str() == value)
    }
    /// The use in plain words, for history labels.
    pub fn label(self) -> &'static str {
        match self {
            Self::MarketHall => "market hall",
            other => other.as_str(),
        }
    }
    /// The naming work term that names its household or business.
    pub fn work(self) -> &'static str {
        match self {
            Self::House | Self::Barn => "household",
            Self::Workshop(_) | Self::Shop | Self::Craftshop => "workshop",
            other => other.as_str(),
        }
    }
    /// Whether a household keeps it, rather than a business.
    pub fn household(self) -> bool {
        matches!(self, Self::House | Self::Barn)
    }
    /// Frontage and depth of the building in metres, before it is fitted to its plot.
    pub fn footprint(self, size: Size) -> (f64, f64) {
        let house = if size >= Size::Town { 9.0 } else { 7.0 };
        match self {
            Self::House | Self::Workshop(_) | Self::Shop | Self::Craftshop => {
                (f64::INFINITY, house)
            }
            Self::Barn => (10.0, 14.0),
            Self::Inn => (14.0, 12.0),
            Self::Tavern | Self::Smithy => (10.0, 9.0),
            Self::Temple => (12.0, 24.0),
            Self::Hall => (16.0, 12.0),
            Self::MarketHall => (20.0, 10.0),
            Self::Mill => (10.0, 10.0),
            Self::Warehouse => (16.0, 14.0),
            Self::Keep => (22.0, 22.0),
            Self::Barracks => (30.0, 12.0),
        }
    }
    /// How many people live in it on average.
    pub fn occupants(self, size: Size) -> f64 {
        match self {
            Self::House | Self::Workshop(_) | Self::Shop | Self::Craftshop => household(size),
            Self::Inn | Self::Tavern | Self::Smithy | Self::Mill => 5.0,
            Self::Temple | Self::Hall => 2.0,
            Self::Keep => 20.0,
            Self::Barracks => 40.0,
            Self::Barn | Self::MarketHall | Self::Warehouse => 0.0,
        }
    }
    pub fn storeys(self, size: Size) -> u32 {
        match (self, size) {
            (Self::Keep, _) => 3,
            (Self::Barn | Self::Temple | Self::MarketHall | Self::Mill, _) => 1,
            (_, Size::City) => 3,
            (_, Size::Town) => 2,
            _ => 1,
        }
    }
}
impl Trade {
    pub const ALL: [Self; 10] = [
        Self::Baker,
        Self::Weaver,
        Self::Cooper,
        Self::Tanner,
        Self::Potter,
        Self::Carpenter,
        Self::Butcher,
        Self::Chandler,
        Self::Mason,
        Self::Brewer,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Baker => "bakery",
            Self::Weaver => "weaver",
            Self::Cooper => "cooper",
            Self::Tanner => "tannery",
            Self::Potter => "pottery",
            Self::Carpenter => "carpenter",
            Self::Butcher => "butcher",
            Self::Chandler => "chandler",
            Self::Mason => "mason",
            Self::Brewer => "brewery",
        }
    }
}
/// People to a household; city households crowd more into each house.
pub fn household(size: Size) -> f64 {
    if size == Size::City {
        6.0
    } else {
        5.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_round_trip_through_their_published_names() {
        for use_ in Use::all() {
            assert_eq!(Use::parse(use_.as_str()), Some(use_));
        }
        assert_eq!(Use::parse("bakery"), Some(Use::Workshop(Trade::Baker)));
        assert_eq!(Use::parse("castle"), None);
    }
    #[test]
    fn uses_name_their_keepers_and_house_their_people() {
        assert_eq!(Use::Inn.work(), "inn");
        assert_eq!(Use::Workshop(Trade::Potter).work(), "workshop");
        assert!(Use::House.household() && !Use::Inn.household());
        assert_eq!(Use::Inn.occupants(Size::Village), 5.0);
        assert_eq!(Use::Inn.storeys(Size::Town), 2);
    }
}
