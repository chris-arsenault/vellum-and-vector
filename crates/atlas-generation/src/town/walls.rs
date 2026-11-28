//! A city's walls: the sections builders laid as they walked, what has fallen and what
//! was laid again, and the ground each wall shelters.
use super::geometry::{add, scale, sub, Point};
use serde::{Deserialize, Serialize};

/// One step of a builder's walk: the wall laid between two points.
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
    /// A section a builder has just laid whole.
    pub fn laid(ends: [Point; 2], cell: usize, cost: f64) -> Self {
        Self {
            ends,
            cell,
            cost,
            built: cost,
            disused: 0.,
            repaired: 0.,
        }
    }
    /// The work of this section that stands: what was built, less disuse not yet repaired.
    fn standing_work(&self) -> f64 {
        (self.built - (self.disused - self.repaired).max(0.)).max(0.)
    }
    pub fn standing(&self) -> Option<[Point; 2]> {
        let [a, b] = self.ends;
        let standing = self.standing_work();
        (standing > 0.).then(|| [a, add(a, scale(sub(b, a), standing / self.cost))])
    }
    pub fn stands(&self) -> bool {
        self.standing_work() > 0.
    }
    /// The section falls: what was built, and any repair, is lost.
    pub fn fall(&mut self) {
        self.disused = self.built;
        self.repaired = 0.;
    }
    /// A builder lays the fallen section again.
    pub fn relay(&mut self) {
        self.repaired = self.disused;
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
    /// What the circuit was worth to the town that planned it: the people it newly
    /// protected for each unit of work, by how much of that town it took in.
    #[serde(default)]
    pub worth: f64,
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
    /// Whether an earlier era raised this wall: it stood before the city's rounds began.
    pub fn inherited(&self) -> bool {
        self.round == 0
    }
    /// Whether the wall shelters no ground: an arc, a stump, a circuit never closed.
    pub fn open(&self) -> bool {
        self.inside.is_empty()
    }
    /// How the wall stands, in a word for its record. The word is read off the wall
    /// after the fact and decides nothing.
    pub fn condition(&self) -> &'static str {
        let standing = self.standing_share();
        match (self.outgrown, self.open()) {
            (true, _) if standing < 0.5 => "interior remnants",
            (true, _) => "reused interior defenses",
            (false, _) if standing < 0.5 => "ruinous",
            (false, true) => "partial",
            (false, false) if standing < 0.85 => "decayed",
            (false, false) => "maintained",
        }
    }
    pub fn funded(&self) -> f64 {
        self.sections.iter().map(|s| s.built + s.repaired).sum()
    }
    /// The share of the circuit's sections that stands.
    pub fn standing_share(&self) -> f64 {
        let whole: f64 = self.sections.iter().map(|s| s.cost).sum();
        if whole <= 0. {
            return 0.;
        }
        let standing: f64 = self.sections.iter().map(Section::standing_work).sum();
        (standing / whole).clamp(0., 1.)
    }
}
pub fn enclosure(walls: &[Wall], cell: usize) -> u32 {
    walls
        .iter()
        .filter(|w| w.encloses(cell) && !w.lines.is_empty())
        .count() as u32
}
/// The protection walls give `cell`: every circuit round it, by the share of that circuit
/// that stands. A circuit begun protects little; one left to ruin protects less each time
/// more of it falls out of use.
pub fn protection(walls: &[Wall], cell: usize) -> f64 {
    walls
        .iter()
        .filter(|w| w.encloses(cell))
        .map(Wall::standing_share)
        .sum()
}

/// How readily towns wall themselves, as a multiple of the weight their causes carry: at
/// nought no town ever does, and the higher it is the less a wall must be worth.
pub const READINESS: crate::parameters::NumericParameter = crate::parameters::NumericParameter {
    name: "wallReadiness",
    unit: "multiplier",
    default: 1.,
    minimum: Some(0.),
    maximum: None,
    strategy: Some("defensive-enclosures"),
    map_types: &[crate::processes::strategies::MapType::City],
};
/// The odds each cause gives that a town walls itself in one era: a guarded site, a
/// realm's seat, a founding plan with an enclosed seat, and another realm that nearly
/// holds the town. A civic order adds its own.
pub const GUARDED: f64 = 0.5;
pub const SEAT: f64 = 0.4;
pub const ENCLOSED_SEAT: f64 = 0.5;
pub const CONTESTED: f64 = 0.6;
/// The odds that a town moved by these causes walls itself in an era. Any one cause may
/// be enough, so the odds that none is are multiplied together.
pub fn resolve(causes: impl IntoIterator<Item = f64>) -> f64 {
    1. - causes
        .into_iter()
        .map(|odds| 1. - odds.clamp(0., 1.))
        .product::<f64>()
}
/// How threatened an era left a town: the weight of its causes, scaled by a wait drawn
/// for the era, which is one on average. Most eras pass quietly and a few bring far more
/// than the causes alone would; a town no cause moves is never threatened.
pub fn threat(causes: f64, wait: f64) -> f64 {
    causes.max(0.) * wait.max(0.)
}
/// The share of the work it could give that a town gives its walls in an era: more the
/// more it is threatened and the more walling its edge is worth, which is the people
/// protected for each unit of work, by how much of the town is taken in. A crowded town
/// on cheap ground gives nearly all it can under a threat that draws little from a thin,
/// sprawling one, and an era that passes quietly lays a stump or nothing.
pub fn keenness(threat: f64, worth: f64) -> f64 {
    1. - (-threat.max(0.) * worth.max(0.)).exp()
}
/// A settlement's roll for its walls on one map, drawn apart from its template, civic
/// order and craft.
pub fn fortune(settlement: &[u8], seed: i32) -> f64 {
    crate::field::poi::true_sizes::roll_bytes(settlement, (seed as u64).wrapping_add(0x5a11_ed01))
}
/// The share of standing wall lost in an era on open ground.
const WEATHER: f64 = 0.12;
/// The further share lost in an era where built ground stands all about the wall:
/// builders take its stone and build across its line.
const ROBBING: f64 = 0.55;
/// The share of the wall about a place lost in one era: weather everywhere, stone taken
/// where built ground presses on it, and its fall where the quarter about it lies in
/// ruin. Wall that later builders walk again is laid again.
pub fn era_loss(built: f64, ruin: f64) -> f64 {
    let neglect = (ruin - built).max(0.) / (0.01 + ruin + built);
    (WEATHER + ROBBING * built.clamp(0., 1.) + (1. - WEATHER) * neglect).clamp(0., 1.)
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
    #[test]
    fn any_one_cause_may_move_a_town_and_a_graver_era_draws_more_of_its_work() {
        // No cause, no threat, however grave the era.
        assert_eq!(resolve([]), 0.);
        assert_eq!(threat(resolve([0., 0.]), 5.), 0.);
        // Two causes weigh more than either and less than their sum.
        let both = resolve([GUARDED, SEAT]);
        assert!(both > GUARDED.max(SEAT) && both < GUARDED + SEAT);
        assert!(threat(both, 3.) > 2. * threat(both, 1.));
        // An unthreatened town gives its walls nothing; a town gives more the graver the
        // era and the more a wall is worth, and never more than all it can.
        assert_eq!(keenness(0., 9.), 0.);
        assert_eq!(keenness(2., 0.), 0.);
        assert!(keenness(0.2, 1.) < keenness(1., 1.) && keenness(1., 1.) < keenness(1., 5.));
        assert!(keenness(1., 1.) > 0.5 && keenness(50., 50.) <= 1.);
    }
    #[test]
    fn wall_is_lost_soonest_where_ground_is_built_or_in_ruin() {
        let (open, built, ruined) = (era_loss(0., 0.), era_loss(0.8, 0.), era_loss(0.1, 0.6));
        assert!(open > 0. && open < 0.2);
        assert!(built > 3. * open && ruined > 3. * open);
        assert!(era_loss(1., 1.) <= 1.);
    }
    #[test]
    fn a_section_falls_whole_and_is_laid_again_whole() {
        let mut section = Section::laid([[0., 0.], [100., 0.]], 0, 80.);
        assert!(section.stands());
        section.fall();
        assert!(!section.stands() && section.standing().is_none());
        section.relay();
        assert_eq!(section.standing(), Some([[0., 0.], [100., 0.]]));
        // Laid again, it can fall again.
        section.fall();
        assert!(!section.stands());
    }
    #[test]
    fn a_wall_is_told_by_how_it_stands() {
        let section = |fallen: bool| {
            let mut section = Section::laid([[0., 0.], [100., 0.]], 0, 100.);
            if fallen {
                section.fall();
            }
            section
        };
        let wall = |outgrown: bool, inside: Vec<u32>, sections: Vec<Section>| Wall {
            outgrown,
            inside,
            sections,
            ..Default::default()
        };
        let whole = vec![section(false); 4];
        let worn = vec![
            section(true),
            section(false),
            section(false),
            section(false),
        ];
        let fallen = vec![section(true), section(true), section(false)];
        assert_eq!(
            wall(false, vec![1], whole.clone()).condition(),
            "maintained"
        );
        assert_eq!(wall(false, vec![1], worn).condition(), "decayed");
        assert_eq!(wall(false, vec![], whole.clone()).condition(), "partial");
        assert_eq!(wall(false, vec![], fallen.clone()).condition(), "ruinous");
        assert_eq!(
            wall(true, vec![1], whole).condition(),
            "reused interior defenses"
        );
        assert_eq!(wall(true, vec![1], fallen).condition(), "interior remnants");
    }
    #[test]
    fn a_circuit_protects_by_the_share_of_it_that_stands() {
        let section = |built: f64, disused: f64| Section {
            ends: [[0., 0.], [100., 0.]],
            cell: 0,
            cost: 100.,
            built,
            disused,
            repaired: 0.,
        };
        let circuit = |sections: Vec<Section>| Wall {
            inside: vec![3, 7],
            sections,
            ..Default::default()
        };
        let begun = circuit(vec![section(100., 0.), section(0., 0.), section(0., 0.)]);
        let complete = circuit(vec![section(100., 0.); 3]);
        let ruined = circuit(vec![
            section(100., 100.),
            section(100., 0.),
            section(100., 0.),
        ]);
        let third = protection(std::slice::from_ref(&begun), 7);
        assert!((third - 1. / 3.).abs() < 1e-12);
        assert_eq!(protection(std::slice::from_ref(&complete), 7), 1.);
        assert!((protection(std::slice::from_ref(&ruined), 7) - 2. / 3.).abs() < 1e-12);
        // Ground outside every circuit has none; ground inside two has both.
        assert_eq!(protection(std::slice::from_ref(&complete), 5), 0.);
        assert!((protection(&[begun, complete], 3) - 4. / 3.).abs() < 1e-12);
    }
}
