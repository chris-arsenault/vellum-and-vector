//! A proposed circuit keeps its extent; the City builds and repairs its sections with finite effort.
use super::geometry::{add, scale, sub, Point};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Section {
    pub ends: [Point; 2],
    pub cell: usize,
    pub cost: f64,
    pub built: f64,
    #[serde(default)]
    pub disused: f64,
    #[serde(default)]
    pub repaired: f64,
}
impl Section {
    pub fn standing(&self) -> Option<[Point; 2]> {
        let [a, b] = self.ends;
        let standing = (self.built - (self.disused - self.repaired).max(0.)).max(0.);
        (standing > 0.).then(|| [a, add(a, scale(sub(b, a), standing / self.cost))])
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Wall {
    pub round: usize,
    pub era: Option<String>,
    pub outgrown: bool,
    pub inside: Vec<u32>,
    #[serde(default)]
    pub area: f64,
    #[serde(default)]
    pub sections: Vec<Section>,
    #[serde(default)]
    pub lines: Vec<[Point; 2]>,
    #[serde(default)]
    pub gates: Vec<Point>,
}
impl Wall {
    pub fn encloses(&self, cell: usize) -> bool {
        self.inside.binary_search(&(cell as u32)).is_ok()
    }
    pub fn funded(&self) -> f64 {
        self.sections.iter().map(|s| s.built + s.repaired).sum()
    }
}
pub fn enclosure(walls: &[Wall], cell: usize) -> u32 {
    walls
        .iter()
        .filter(|w| w.encloses(cell) && !w.lines.is_empty())
        .count() as u32
}

// owner-direction(2026-11-24): defenses are planned against the whole city so a wall enclosing less than one percent is exceptional.
pub(crate) fn enclosure_value(share: f64, new_population: f64, effort: f64) -> f64 {
    let significance = share / (share + 0.10);
    new_population * significance * significance / effort.max(1.)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tiny_enclosures_need_exceptional_benefit_even_with_cheaper_works() {
        assert!(enclosure_value(0.008, 1000., 100.) < enclosure_value(0.15, 1000., 800.));
        let s = Section {
            ends: [[0., 0.], [100., 0.]],
            cell: 0,
            cost: 80.,
            built: 20.,
            disused: 0.,
            repaired: 0.,
        };
        assert_eq!(s.standing(), Some([[0., 0.], [25., 0.]]));
    }
}
