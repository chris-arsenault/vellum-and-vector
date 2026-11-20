//! The settlement scale authority: the one place a town process asks how large its lengths
//! are, as map processes ask `MapScale` (`crate::scale`). A town runs at a fidelity. At street
//! fidelity a plot is a plot of ground, a street a street and a holding one premises; at city
//! fidelity a plot is a city block, a street a thoroughfare and a holding a block's use,
//! standing for the premises it holds.
//!
//! Lengths are declared once, in street metres, where the town system has always declared
//! them: the catalogue's frontages and depths, street widths, the settings. Each says what it
//! measures, and the town's scale resolves it by its fidelity's factor for that measure. A
//! fidelity is a row of factors, so another fidelity is another row, not another branch in
//! every process. A major work keeps its real size at every fidelity, and so do the distances
//! people walk.
use serde::{Deserialize, Serialize};

/// What a town length measures.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Measure {
    /// A plot's frontage and depth, setbacks, the sizes the catalogue gives each kind, and the
    /// buildings that fill a plot.
    Plot,
    /// The street network's geometry laid out between plots: vertex spacing, junction and
    /// shortcut distances, lane offsets, the reach a founding lays its first plots across.
    Layout,
    /// How far one holding's effect on its neighbours carries: eases, bars and falloffs.
    Adjacency,
    /// The width of a way, a wall or a gate.
    Width,
    /// The town ground's raster cell.
    Ground,
    /// How far people walk or travel: daily, service and catchment reaches.
    Travel,
}
impl Measure {
    const COUNT: usize = 6;
}

/// A fidelity's identity, kept with every town it develops.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Fidelity {
    /// Plots, streets and premises: town, district and real-scale maps.
    #[default]
    Street,
    /// Blocks, thoroughfares and block uses: a city map.
    City,
}

/// A fidelity's factors, one per measure, against street fidelity.
struct Profile {
    factors: [f64; Measure::COUNT],
}

/// Every fidelity's profile, by the fidelity's position.
const PROFILES: [Profile; 2] = [
    // Street fidelity is the unit every length is declared in.
    Profile {
        factors: [1.; Measure::COUNT],
    },
    // A city block is a few street plot depths on each side; thoroughfares are a few times a
    // street's width; holdings act on neighbouring blocks as premises do on neighbouring
    // plots. People walk as far as ever.
    Profile {
        factors: [
            CITY_BLOCK, // Plot
            CITY_BLOCK, // Layout
            CITY_BLOCK, // Adjacency
            3.,         // Width
            6.,         // Ground
            1.,         // Travel
        ],
    },
];
/// How many street lengths a city-fidelity length is, for plots and what is laid out between
/// them: a block of about seven plot depths.
const CITY_BLOCK: f64 = 7.;

/// A town's scale: resolves the lengths its processes declare in street metres.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TownScale {
    fidelity: Fidelity,
}
impl TownScale {
    pub fn new(fidelity: Fidelity) -> Self {
        Self { fidelity }
    }
    pub fn fidelity(self) -> Fidelity {
        self.fidelity
    }
    fn factor(self, measure: Measure) -> f64 {
        PROFILES[self.fidelity as usize].factors[measure as usize]
    }
    /// A length declared in street metres, at this scale.
    pub fn length(self, metres: f64, measure: Measure) -> f64 {
        metres * self.factor(measure)
    }
    /// An area declared in street square metres, at this scale.
    pub fn area(self, square_metres: f64, measure: Measure) -> f64 {
        square_metres * self.factor(measure).powi(2)
    }
    /// A frontage and depth range of the catalogue, at this scale.
    pub fn range(self, range: super::catalogue::MetresRange) -> super::catalogue::MetresRange {
        super::catalogue::MetresRange {
            low: self.length(range.low, Measure::Plot),
            high: self.length(range.high, Measure::Plot),
        }
    }
    /// An ordinary plot's frontage and depth in a place of `size`.
    pub fn plot(self, size: atlas_map::town::Size) -> (f64, f64) {
        let (frontage, depth) = atlas_map::town::plot_size(size);
        (
            self.length(frontage, Measure::Plot),
            self.length(depth, Measure::Plot),
        )
    }
    /// The full width of a way of `class` in a place of `size`.
    pub fn street_width(
        self,
        class: atlas_map::town::StreetClass,
        size: atlas_map::town::Size,
    ) -> f64 {
        self.length(class.width(size), Measure::Width)
    }
    /// How many street-fidelity premises one holding stands for: one at street fidelity, a
    /// block's worth at city fidelity.
    pub fn premises(self) -> f64 {
        self.factor(Measure::Plot).powi(2)
    }
}
impl Default for TownScale {
    fn default() -> Self {
        Self::new(Fidelity::Street)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_map::town::Size;

    #[test]
    fn street_fidelity_keeps_every_declared_length_and_city_fidelity_sizes_each_by_its_measure() {
        let street = TownScale::new(Fidelity::Street);
        let city = TownScale::new(Fidelity::City);
        assert_eq!(
            street.plot(Size::City),
            atlas_map::town::plot_size(Size::City)
        );
        // A city plot is a block: several street plots deep on each side.
        let (frontage, depth) = city.plot(Size::City);
        assert!(depth > 100. && frontage > 30., "{frontage} × {depth}");
        assert_eq!(street.premises(), 1.);
        assert!(city.premises() > 40.);
        // People walk as far at both fidelities; thoroughfares are wider than streets.
        assert_eq!(city.length(1_600., Measure::Travel), 1_600.);
        let main = atlas_map::town::StreetClass::Main;
        assert!(city.street_width(main, Size::City) > street.street_width(main, Size::City));
        assert_eq!(
            city.area(100., Measure::Plot),
            city.length(10., Measure::Plot).powi(2)
        );
    }
}
