//! A retained practice offers what its particular medium and practitioners can provide.
use super::{practised, Field, CRAFTS};
use crate::town::{
    catalogue::{AccessUse, Activity, PlaceRules, Site},
    effects::{Clientele, Contribution, Ease, Effects, Nuisance, Placement, Requirement, Service},
    production::{Offer, Opportunity, Production},
};
use std::io;

#[derive(Clone, Copy, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct PracticeReads([f64; CRAFTS.len()]);
impl From<[f64; CRAFTS.len()]> for PracticeReads {
    fn from(shares: [f64; CRAFTS.len()]) -> Self {
        Self(shares)
    }
}
impl PracticeReads {
    pub fn at(field: &Field, cell: usize) -> io::Result<Self> {
        let mut reads = Self::default();
        for (read, craft) in reads.0.iter_mut().zip(CRAFTS) {
            *read = practised(field, craft, cell)?;
        }
        Ok(reads)
    }

    pub fn preferred(self) -> Option<i32> {
        CRAFTS
            .iter()
            .zip(self.0)
            .filter(|(_, read)| *read > 0.)
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(craft, _)| craft.code)
    }

    pub fn available(self, code: i32) -> f64 {
        CRAFTS
            .iter()
            .position(|craft| craft.code == code)
            .map_or(0., |i| self.0[i])
    }

    pub(crate) fn with_local_consecration(mut self, strength: f64) -> Self {
        let index = (CRAFTS[5].code - 1) as usize;
        self.0[index] = self.0[index].max(strength);
        self
    }

    /// The readings of a site in a city that practises `crafts` everywhere: each of those
    /// crafts is present at least at `presence`, wherever its medium lies. Tending still
    /// needs its roots: on rooted ground whose roots are `severed` it stays absent.
    pub(crate) fn with_city_crafts(mut self, crafts: &[i32], presence: f64, severed: bool) -> Self {
        let tending = CRAFTS[3].code;
        for (read, craft) in self.0.iter_mut().zip(CRAFTS) {
            if crafts.contains(&craft.code) && !(severed && craft.code == tending) {
                *read = read.max(presence);
            }
        }
        self
    }

    pub(crate) fn with_cut_roots(mut self) -> Self {
        let index = (CRAFTS[3].code - 1) as usize;
        self.0[index] = 0.;
        self
    }
}

#[derive(Clone, Copy)]
pub struct TownPractice {
    pub effects: Effects,
    pub production: Production,
    /// Limits working capacity after repeated practice. The arguments are
    /// tenure, reachable care and how well the practice remains grounded.
    pub strain: fn(f64, f64, f64) -> f64,
    pub maintains_door: bool,
    pub material: Option<TownMaterial>,
}

#[derive(Clone, Copy)]
pub struct TownMaterial {
    pub reservoir: &'static str,
    pub worked_reservoir: Option<&'static str>,
    pub offered_as: Opportunity,
    pub release: f64,
    pub after_use: Option<crate::magic::stocks::aging::WithdrawalResponse>,
}
const ORDINARY: Production = Production {
    needs: &[],
    offers: &[],
};

pub const FIRE: TownPractice = TownPractice {
    effects: Effects {
        attracts: &[Contribution::new(Clientele::Countryfolk, 0.34)],
        ..Effects::EMPTY
    },
    production: Production {
        offers: &[Offer::new(Opportunity::WorkedHeat, 1.2)],
        needs: &[],
    },
    strain: |tenure, care, _| tenure / (14. * (1. + care)),
    maintains_door: false,
    material: Some(TownMaterial {
        reservoir: "held",
        worked_reservoir: Some("forge"),
        offered_as: Opportunity::WorkedHeat,
        release: 0.08,
        after_use: None,
    }),
};

pub const AURORA: TownPractice = TownPractice {
    effects: Effects {
        teaches: 1.32,
        attracts: &[Contribution::new(Clientele::Wealthy, 0.68)],
        ..Effects::EMPTY
    },
    production: ORDINARY,
    strain: |tenure, _, _| tenure.powi(2) / 180.,
    maintains_door: false,
    material: None,
};

pub const PRESSURE: TownPractice = TownPractice {
    effects: Effects {
        teaches: 0.78,
        attracts: &[Contribution::new(Clientele::Travellers, 0.72)],
        ..Effects::EMPTY
    },
    production: Production {
        offers: &[Offer::new(Opportunity::Soundings, 0.88)],
        needs: &[],
    },
    strain: |_, _, available| available * 0.7,
    maintains_door: false,
    material: None,
};

pub const GREENWOOD: TownPractice = TownPractice {
    effects: Effects {
        holds: 1.3,
        ..Effects::EMPTY
    },
    production: Production {
        offers: &[Offer::new(Opportunity::SpringWater, 0.89)],
        needs: &[],
    },
    strain: |_, _, available| 1. / (1. + available) - 0.5,
    maintains_door: false,
    material: Some(TownMaterial {
        reservoir: "aquifer",
        worked_reservoir: None,
        offered_as: Opportunity::SpringWater,
        release: 0.06,
        after_use: Some(crate::magic::stocks::aging::collapse_used_spring),
    }),
};

pub const SALT: TownPractice = TownPractice {
    effects: Effects {
        holds: 1.15,
        teaches: 0.97,
        attracts: &[Contribution::new(Clientele::Townsfolk, 0.57)],
        ..Effects::EMPTY
    },
    production: Production {
        offers: &[Offer::new(Opportunity::WitnessRecord, 0.94)],
        needs: &[],
    },
    strain: |tenure, _, _| tenure / (tenure + 9.),
    maintains_door: false,
    material: None,
};

pub const HALLOWED: TownPractice = TownPractice {
    effects: Effects {
        serves: &[Contribution::new(Service::Protection, 0.83)],
        attracts: &[Contribution::new(Clientele::Travellers, 0.52)],
        placement_policy: Some(vow),
        holds: 1.02,
        consecrates: 1.,
        ..Effects::EMPTY
    },
    production: ORDINARY,
    strain: |_, _, _| 0.5,
    maintains_door: false,
    material: None,
};

pub(crate) fn vow(target: Placement) -> bool {
    match target {
        Placement::Access(mode) => mode == AccessUse::Foot,
        Placement::Premises(kind) => {
            let definition = kind.definition();
            !matches!(
                definition.premises.site,
                Site::WorkingLand | Site::FlowingWater
            ) && definition
                .roles
                .effects
                .burdens
                .iter()
                .all(|b| !matches!(b.kind, Nuisance::Smoke | Nuisance::Foulness))
        }
        Placement::Activity(_) => true,
    }
}

pub const VEIL: TownPractice = TownPractice {
    effects: Effects {
        attracts: &[Contribution::new(Clientele::Travellers, 1.24)],
        eases: &[Ease {
            target: Placement::Activity(Activity::Hospitality),
            requirement: Requirement::Support,
            relief: 0.12,
            reach: 48.,
        }],
        ..Effects::EMPTY
    },
    production: ORDINARY,
    strain: |tenure, _, _| tenure / (tenure + 6.),
    maintains_door: true,
    material: None,
};
