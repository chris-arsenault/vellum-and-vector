//! Settlement plan vocabulary shared by generation and authoring (ADR 0016): how big a place
//! is, street classes and their widths, building uses with their footprints, occupants and
//! storeys, plot sizes, and house numbering along a street. Generation lays towns with these
//! rules and the town tools apply the same rules to what a creator adds.
mod addresses;
mod uses;

pub use addresses::{
    address, numbers, numbers_around, same_street, AddressMatch, AddressQuery, Side,
};
pub use uses::{household, Trade, Use};

/// How big a place is, read from its people. Village, town and city are one kind at
/// different density (ADR 0016).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Size {
    Farmstead,
    Hamlet,
    Village,
    Town,
    City,
}
// People at or above which a place counts as each size.
const HAMLET_PEOPLE: f64 = 30.0;
const VILLAGE_PEOPLE: f64 = 150.0;
const TOWN_PEOPLE: f64 = 1_000.0;
const CITY_PEOPLE: f64 = 8_000.0;
impl Size {
    pub fn of(people: f64) -> Self {
        if people >= CITY_PEOPLE {
            Self::City
        } else if people >= TOWN_PEOPLE {
            Self::Town
        } else if people >= VILLAGE_PEOPLE {
            Self::Village
        } else if people >= HAMLET_PEOPLE {
            Self::Hamlet
        } else {
            Self::Farmstead
        }
    }
}

/// A street's class, published as its `roadClass`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreetClass {
    /// A way as it runs through the built place.
    Main,
    /// The same way beyond the built edge, out through the fields.
    Road,
    Street,
    Lane,
    Alley,
}
impl StreetClass {
    pub const ALL: [Self; 5] = [
        Self::Main,
        Self::Road,
        Self::Street,
        Self::Lane,
        Self::Alley,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Main => "mainStreet",
            Self::Road => "road",
            Self::Street => "street",
            Self::Lane => "lane",
            Self::Alley => "alley",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|class| class.as_str() == value)
    }
    /// The class in plain words, for history labels.
    pub fn label(self) -> &'static str {
        match self {
            Self::Main => "main street",
            other => other.as_str(),
        }
    }
    /// The naming work term a street of this class is named with.
    pub fn work(self) -> &'static str {
        match self {
            Self::Main | Self::Street => "street",
            Self::Road => "road",
            Self::Lane | Self::Alley => "lane",
        }
    }
    /// The full width in metres of a street of this class in a place of `size`.
    pub fn width(self, size: Size) -> f64 {
        match (self, size) {
            (Self::Main, Size::Farmstead | Size::Hamlet) => 4.0,
            (Self::Main, Size::Village) => 6.0,
            (Self::Main, Size::Town) => 8.0,
            (Self::Main, Size::City) => 10.0,
            (Self::Road, Size::Town | Size::City) => 5.0,
            (Self::Road, _) => 4.0,
            (Self::Street, Size::Town | Size::City) => 6.0,
            (Self::Street, _) => 5.0,
            (Self::Lane, _) => 3.5,
            (Self::Alley, _) => 2.5,
        }
    }
}

/// The longest water a place of this size bridges; a street meets wider water and ends.
pub fn bridge_span(size: Size) -> f64 {
    match size {
        Size::Farmstead | Size::Hamlet => 12.0,
        Size::Village => 30.0,
        Size::Town => 80.0,
        Size::City => 160.0,
    }
}
/// A bridge's deck is this much wider than the street it carries, and reaches this far onto
/// each bank, in metres.
pub const BRIDGE_MARGIN: f64 = 1.0;
pub const BRIDGE_LANDING: f64 = 2.0;
/// Frontage and depth of an ordinary plot in metres, by the size of the place.
pub fn plot_size(size: Size) -> (f64, f64) {
    match size {
        Size::Farmstead => (30.0, 40.0),
        Size::Hamlet => (20.0, 35.0),
        Size::Village => (14.0, 30.0),
        Size::Town => (8.0, 24.0),
        Size::City => (6.0, 20.0),
    }
}
/// Ground left between a building's front and its plot's street edge.
pub fn setback(size: Size) -> f64 {
    match size {
        Size::City | Size::Town => 0.3,
        Size::Village => 2.0,
        Size::Hamlet | Size::Farmstead => 4.0,
    }
}
/// The share of a plot's frontage a building fills at most.
pub fn fill(size: Size) -> f64 {
    match size {
        Size::City | Size::Town => 0.96,
        Size::Village => 0.7,
        Size::Hamlet => 0.55,
        Size::Farmstead => 0.5,
    }
}
/// Ground left between a street's edge and a plot.
pub const VERGE: f64 = 0.5;
/// A building's width along its street and depth back from it, fitted to a plot of this
/// frontage and depth.
pub fn fitted(use_: Use, size: Size, frontage: f64, depth: f64) -> (f64, f64) {
    let (wide, deep) = use_.footprint(size);
    (wide.min(frontage * fill(size)), deep.min(depth * 0.8))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn street_classes_round_trip_and_widen_with_the_place() {
        for class in StreetClass::ALL {
            assert_eq!(StreetClass::parse(class.as_str()), Some(class));
        }
        assert_eq!(StreetClass::parse("trail"), None);
        assert_eq!(StreetClass::Main.width(Size::Village), 6.0);
        assert_eq!(StreetClass::Main.width(Size::City), 10.0);
        assert_eq!(StreetClass::Lane.width(Size::City), 3.5);
        assert_eq!(StreetClass::Alley.work(), "lane");
        assert_eq!(StreetClass::Main.label(), "main street");
    }
    #[test]
    fn buildings_fit_their_plot() {
        let (wide, deep) = fitted(Use::House, Size::Village, 14.0, 30.0);
        assert!((wide - 9.8).abs() < 1e-9 && deep == 7.0);
        assert_eq!(fitted(Use::Inn, Size::Village, 30.0, 30.0), (14.0, 12.0));
        assert_eq!(fitted(Use::Temple, Size::Town, 30.0, 20.0), (12.0, 16.0));
    }
}
