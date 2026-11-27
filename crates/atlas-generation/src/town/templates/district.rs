//! Executable district tropes keyed by the design catalogue's durable identifiers.
use super::Tenure;
use crate::town::catalogue::Activity;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

macro_rules! tropes {
    ($($name:ident => $id:literal),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
        pub(crate) enum Trope { $(#[serde(rename=$id)] $name),+ }
    };
}
tropes! {
    Bazaar => "economic.market-exchange", Artificer => "economic.craft-workshops",
    Freight => "economic.freight-hub", Granary => "economic.food-provision",
    Inn => "economic.household-services", Scribe => "economic.learned-services",
    Warrens => "social.crowded-tenements", Estates => "social.patrician-estates",
    Guild => "social.guild-commons", Outlanders => "social.newcomer-quarter",
    Commons => "social.free-commons", Veil => "trait.veil-discontinuity",
    Greenwood => "trait.greenwood-encroachment", Ossuary => "trait.salt-ossuary",
    Flood => "trait.flood-exposure", Spring => "trait.reliable-spring",
    Ruins => "trait.ancient-ruins", Wall => "trait.outgrown-wall",
    Resident => "trait.notable-resident", Rookery => "trait.creature-rookery",
    Ordinary => "trait.ordinary"
}
#[derive(Deserialize, PartialEq, Eq)]
pub(crate) enum Category {
    Economic,
    Social,
    Trait,
}
#[derive(Deserialize)]
pub(crate) struct Entry {
    #[serde(rename = "Type ID")]
    pub id: Trope,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Category")]
    pub category: Category,
    #[serde(default, rename = "Localized origin")]
    pub localized_origin: bool,
}
pub(crate) static CATALOG: LazyLock<Vec<Entry>> = LazyLock::new(|| {
    serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/district-types.json"
    )))
    .expect("district catalogue IDs")
});

#[derive(Default, Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Demands {
    pub housing: f64,
    pub workshops: f64,
    pub trade: f64,
    pub gardens: f64,
    pub commons: f64,
    pub access: f64,
    pub civic: f64,
}
#[derive(Clone, Copy, Default)]
pub(crate) struct DistrictLand {
    pub wet: f64,
    pub trees: f64,
    pub slope: f64,
    pub ruined: f64,
    pub built: f64,
    pub access: f64,
    pub verdure: f64,
    pub tearing: f64,
    pub old_wall: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct InheritedProgram {
    economic: Trope,
    social: Trope,
    traits: Vec<Trope>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub(crate) struct UseMix {
    housing: f64,
    trade: f64,
    workshops: f64,
}
impl UseMix {
    pub(crate) fn at_residential_demand(mut self, relative_density: f64) -> Self {
        self.housing *= relative_density;
        self
    }
}

impl InheritedProgram {
    // owner-direction(2026-11-26): the district catalog is the design authority and Street responses reflect City behavior
    pub(crate) fn street_demand(&self, land: DistrictLand, mix: UseMix) -> Demands {
        let mut demand = Demands::default();
        self.economic.respond_to_frontage(land, mix, &mut demand);
        self.social.respond_to_frontage(land, mix, &mut demand);
        for trait_ in &self.traits {
            trait_.shape_district(land, &mut demand);
        }
        demand.housing += mix.housing;
        demand.trade += mix.trade;
        demand.workshops += mix.workshops;
        demand
    }
}
pub(crate) struct Evidence {
    pub crowd: f64,
    pub capital: f64,
    pub wealth: f64,
    pub built: f64,
    pub trade: f64,
    pub food: f64,
    pub route: f64,
    pub tenure: Tenure,
    pub free: bool,
    pub craft: f64,
    pub wet: f64,
    pub trees: f64,
    pub ruins: f64,
    pub greenwood: bool,
    pub veil: bool,
    pub sources: Vec<(Trope, String)>,
}
impl Evidence {
    pub fn weight(&self, id: Trope) -> f64 {
        use Trope::*;
        let support = (self.sources.iter().filter(|(t, _)| *t == id).count() as f64).ln_1p();
        let arrivals = self.route.ln_1p();
        let crowd = self.crowd.ln_1p();
        let wealth = self.wealth.ln_1p();
        let local = match id {
            Bazaar => 0.7 + self.trade.sqrt() * (0.45 + arrivals),
            Artificer => 0.85 + self.craft.ln_1p() * (1. + self.capital),
            Freight => 0.45 + arrivals * (1. + self.trade),
            Granary => 0.75 + self.food.sqrt() * (0.8 + arrivals),
            Inn => 0.9 + self.built.sqrt() * (0.5 + 0.35 * crowd) + arrivals,
            Scribe => 0.65 + 0.6 * self.capital + 0.4 * wealth,
            Warrens => 0.65 + crowd / (0.65 + self.capital + wealth),
            Estates => 0.55 + wealth * (0.7 + self.capital) / (1. + crowd),
            Guild => 0.65 + self.craft.ln_1p(),
            Outlanders => 0.55 + arrivals * self.trade.sqrt(),
            Commons => {
                0.7 + f64::from(self.free || self.tenure == Tenure::Common) + self.food.sqrt() * 0.4
            }
            Veil if !self.veil && support == 0. => return 0.,
            Greenwood if !self.greenwood && support == 0. => return 0.,
            Veil => 0.8 + arrivals,
            Greenwood => 0.7 + self.trees,
            Flood => 0.15 + 2.6 * self.wet,
            Spring => 0.55 + self.wet,
            Ossuary => 0.5 + 0.35 * self.capital,
            Ruins => 0.55 + 2. * self.ruins,
            Wall => 0.45 + self.built.sqrt(),
            Resident => 0.65 + 0.45 * wealth,
            Rookery => 0.5 + self.trees + 0.3 * self.built,
            Ordinary => 1.,
        };
        local + 2.5 * support
    }
}

impl Trope {
    fn respond_to_frontage(self, land: DistrictLand, mix: UseMix, demand: &mut Demands) {
        use Trope::*;
        let accessible = land.access / (1. + land.access);
        let dry = 1. / (1. + land.wet);
        let settled = land.built / (1. + land.built);
        match self {
            Bazaar => demand.trade += accessible * (1. + mix.trade),
            Artificer => demand.workshops += dry * accessible * (1. + mix.workshops),
            Freight => {
                demand.trade += accessible.powi(2);
                demand.workshops += accessible * dry;
                demand.access += accessible;
            }
            Granary => {
                demand.workshops += accessible * dry;
                demand.gardens += dry * (1. - settled) / (1. + land.slope);
            }
            Inn => {
                demand.housing += settled;
                demand.trade += accessible * settled;
            }
            Scribe => {
                demand.civic += settled * dry;
                demand.gardens += (1. - settled) * dry;
                demand.housing += dry * mix.housing;
            }
            Warrens => {
                demand.housing += dry * (settled + mix.housing);
                demand.commons += settled * accessible;
            }
            Estates => {
                demand.gardens += dry * (1. - settled) / (1. + land.slope);
                demand.housing += dry * (1. - settled);
                demand.access -= (1. - settled) * (1. - accessible);
            }
            Guild => {
                demand.workshops += accessible * mix.workshops;
                demand.commons += accessible * (mix.workshops + settled);
            }
            Outlanders => {
                demand.housing += accessible * dry;
                demand.trade += accessible * mix.housing;
                demand.commons += settled;
            }
            Commons => {
                demand.commons += dry * (1. - settled) + accessible;
                demand.access += dry * mix.housing;
            }
            _ => {}
        }
    }

    pub fn activity(self) -> Activity {
        use Trope::*;
        match self {
            Bazaar | Freight => Activity::Trade,
            Artificer | Guild => Activity::Production,
            Granary => Activity::Agriculture,
            Inn => Activity::Hospitality,
            Scribe => Activity::Service,
            _ => Activity::Household,
        }
    }
    pub fn contribute(self, d: &mut Demands) {
        use Trope::*;
        match self {
            Bazaar => {
                d.trade += 2.;
                d.access += 1.;
            }
            Freight => {
                d.trade += 1.3;
                d.workshops += 1.;
                d.access += 1.5;
            }
            Granary => {
                d.workshops += 1.3;
                d.gardens += 0.5;
                d.access += 0.6;
            }
            Artificer => {
                d.workshops += 2.;
                d.access += 0.6;
            }
            Inn => {
                d.housing += 1.1;
                d.trade += 0.5;
                d.access += 0.5;
            }
            Scribe => {
                d.civic += 1.2;
                d.gardens += 0.6;
                d.housing += 0.7;
            }
            Warrens => {
                d.housing += 2.6;
                d.access -= 0.4;
            }
            Estates => {
                d.gardens += 2.8;
                d.access -= 0.8;
            }
            Guild => {
                d.workshops += 0.8;
                d.commons += 0.8;
                d.civic += 0.4;
            }
            Outlanders => {
                d.housing += 1.4;
                d.trade += 0.5;
                d.commons += 0.7;
            }
            Commons => {
                d.commons += 1.5;
                d.housing += 0.7;
                d.access += 0.4;
            }
            _ => {}
        }
    }

    // owner-direction(2026-11-25): traits affect the whole district, even when they have a single point of origin.
    pub fn shape_district(self, land: DistrictLand, d: &mut Demands) {
        use Trope::*;
        let frontage = land.access / (1. + land.access);
        match self {
            Greenwood => {
                let growth = 0.35 + land.trees + land.verdure + land.wet * 0.5;
                d.commons += 1.1 * growth;
                d.gardens += 0.9 * growth;
                d.access -= 0.55 * growth;
            }
            Rookery => {
                let nesting = 0.3 + land.trees + land.slope + 0.5 * land.built;
                d.commons += nesting;
                d.gardens += 0.45 * nesting;
                d.access -= 0.35 * nesting;
            }
            Flood => {
                d.commons += 0.35 + 2.2 * land.wet;
                d.gardens += 0.35 + land.wet;
                d.access += 0.35 - 1.8 * land.wet;
            }
            Veil => {
                d.access -= 0.3 + 1.5 * land.tearing;
                d.commons += 0.4 + land.tearing;
                d.trade += 0.5 * frontage / (1. + land.tearing);
            }
            Wall => {
                let masonry = 0.35 + land.ruined + f64::from(land.old_wall);
                d.commons += masonry;
                d.workshops += 0.45 * masonry;
                d.access += 0.65 * frontage - 0.45 * masonry;
            }
            Ruins => {
                let remains = 0.45 + land.ruined + land.built * 0.3;
                d.civic += remains;
                d.commons += 0.8 * remains;
                d.access -= 0.45 * remains;
            }
            Spring => {
                d.commons += 0.45 + land.wet;
                d.gardens += 0.55 + land.wet;
                d.access += 0.4 + 0.4 * frontage;
            }
            Ossuary => {
                d.commons += 0.65 + land.ruined;
                d.civic += 0.6 + land.built;
                d.access += 0.3 * frontage;
            }
            Resident => {
                d.civic += 0.65 + 0.45 * land.built;
                d.trade += 0.45 + 1.15 * frontage;
                d.access += 0.35 + 0.65 * frontage;
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn street_responses_use_city_character_and_current_frontage() {
        let program = InheritedProgram {
            economic: Trope::Bazaar,
            social: Trope::Warrens,
            traits: vec![Trope::Flood],
        };
        let mix = UseMix {
            housing: 0.7,
            trade: 0.2,
            workshops: 0.1,
        };
        let quiet = DistrictLand {
            built: 0.5,
            ..Default::default()
        };
        let frontage = DistrictLand {
            access: 2.,
            ..quiet
        };
        let wet = DistrictLand {
            wet: 0.9,
            ..frontage
        };
        let demand = program.street_demand(frontage, mix);
        assert!(demand.trade > program.street_demand(quiet, mix).trade);
        assert!(demand.housing > mix.housing);
        let flooded = program.street_demand(wet, mix);
        assert!(flooded.access < demand.access);
        assert!(flooded.commons > demand.commons);
        let estates = InheritedProgram {
            social: Trope::Estates,
            ..program
        };
        assert!(estates.street_demand(frontage, mix).gardens > demand.gardens);
    }

    #[test]
    fn district_traits_act_across_different_ground_without_a_landmark() {
        let dry = DistrictLand::default();
        let wet = DistrictLand {
            wet: 0.9,
            trees: 0.6,
            access: 1.2,
            ..dry
        };
        let effects = |kind: Trope, land| {
            let mut d = Demands::default();
            kind.shape_district(land, &mut d);
            d
        };
        for e in CATALOG.iter().filter(|e| e.category == Category::Trait) {
            for ground in [dry, wet] {
                assert_eq!(
                    effects(e.id, ground) == Demands::default(),
                    e.id == Trope::Ordinary
                );
            }
        }
        let flood = effects(Trope::Flood, wet);
        assert!(flood.commons > effects(Trope::Flood, dry).commons);
        assert!(flood.access < effects(Trope::Flood, dry).access);
        assert!(effects(Trope::Resident, wet).trade > effects(Trope::Resident, dry).trade);
        let origin = |id| {
            CATALOG
                .iter()
                .find(|e| e.id == id)
                .unwrap()
                .localized_origin
        };
        assert!(origin(Trope::Spring));
        assert!(!origin(Trope::Flood));
    }

    #[test]
    fn dependent_households_can_work_a_wealthy_estate() {
        let mut site = Evidence {
            crowd: 0.3,
            capital: 1.1,
            built: 0.2,
            trade: 0.,
            food: 0.,
            route: 0.,
            tenure: Tenure::Dependent,
            free: false,
            craft: 0.,
            wet: 0.,
            trees: 0.,
            ruins: 0.,
            greenwood: false,
            veil: false,
            wealth: 2.,
            sources: vec![],
        };
        assert!(site.weight(Trope::Estates) > site.weight(Trope::Warrens));
        let estate_weight = site.weight(Trope::Estates);
        let tenement_weight = site.weight(Trope::Warrens);
        site.wealth = 0.25;
        assert!(site.weight(Trope::Estates) < estate_weight);
        assert!(site.weight(Trope::Warrens) > tenement_weight);
        assert!(site.weight(Trope::Guild) > 0.);
        assert_eq!(site.weight(Trope::Veil), 0.);
    }
}
