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
    Resident => "trait.notable-resident", Rookery => "trait.creature-rookery"
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
}
pub(crate) static CATALOG: LazyLock<Vec<Entry>> = LazyLock::new(|| {
    serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/district-types.json"
    )))
    .expect("district catalogue IDs")
});

#[derive(Default, Clone, Copy, Debug, Serialize, Deserialize)]
pub(crate) struct Demands {
    pub housing: f64,
    pub workshops: f64,
    pub trade: f64,
    pub gardens: f64,
    pub commons: f64,
    pub access: f64,
    pub civic: f64,
}
impl Demands {
    pub fn add_site(&mut self, kind: Trope, influence: f64) {
        let mut local = Self::default();
        kind.contribute(&mut local);
        self.commons += influence * local.commons;
        self.gardens += influence * local.gardens;
        self.access += influence * local.access;
        self.civic += influence * local.civic;
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
    pub sources: Vec<(Trope, String)>,
}
impl Evidence {
    pub fn weight(&self, id: Trope) -> f64 {
        use Trope::*;
        let source = self.sources.iter().any(|(t, _)| *t == id);
        match id {
            Bazaar => self.trade.sqrt() * (0.3 + self.route),
            Artificer => self.craft * (0.5 + self.capital),
            Freight => self.route * self.trade.sqrt(),
            Granary => self.food * (1. + self.route),
            Inn => self.built.sqrt() * (1. + self.crowd + self.route),
            Scribe => f64::from(source) * (1. + self.capital),
            Warrens => self.crowd / (0.25 + self.capital) / (0.5 + self.wealth),
            // Household tenure describes the occupants. Dependants can live on an estate
            // whose owners have the surplus to withhold valuable land from development.
            Estates if self.tenure != Tenure::Common && self.wealth > 1. && self.capital > 0. => {
                self.wealth * self.capital / (0.25 + self.crowd)
            }
            Estates => 0.,
            Guild | Outlanders => f64::from(source) * 2.,
            Commons => f64::from(self.free || self.tenure == Tenure::Common) * (1. + self.built),
            _ => f64::from(source),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            wealth: 2.,
            sources: vec![],
        };
        assert!(site.weight(Trope::Estates) > site.weight(Trope::Warrens));
        site.wealth = 0.25;
        assert_eq!(site.weight(Trope::Estates), 0.);
        assert!(site.weight(Trope::Warrens) > 0.);
        assert_eq!(site.weight(Trope::Guild), 0.);
        assert_eq!(site.weight(Trope::Veil), 0.);
    }
}
impl Trope {
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
            Greenwood | Rookery => {
                d.commons += 1.;
                d.gardens += 1.4;
                d.access -= 0.7;
            }
            Veil | Flood => {
                d.commons += 0.7;
                d.access -= 1.1;
            }
            Wall | Ruins => {
                d.civic += 0.5;
                d.commons += 0.6;
                d.access -= 0.6;
            }
            Spring => {
                d.commons += 1.2;
                d.gardens += 0.8;
                d.access += 0.8;
            }
            Ossuary => {
                d.commons += 0.9;
                d.civic += 1.;
            }
            Resident => {
                d.civic += 0.5;
                d.access += 0.6;
            }
        }
    }
}
