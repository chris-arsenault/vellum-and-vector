//! Local contributions declared by a place and composed by the receiving question.
use super::catalogue::{AccessUse, Activity, Kind, PlaceRules};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub enum Clientele {
    Townsfolk,
    Countryfolk,
    Travellers,
    Wealthy,
}
impl Clientele {
    pub const ALL: [Self; 4] = [
        Self::Townsfolk,
        Self::Countryfolk,
        Self::Travellers,
        Self::Wealthy,
    ];
    pub fn reach(self) -> f64 {
        match self {
            Self::Townsfolk => super::settings::TOWNSFOLK_REACH,
            Self::Countryfolk => super::settings::COUNTRYFOLK_REACH,
            Self::Travellers | Self::Wealthy => super::settings::DAILY_REACH,
        }
    }
    pub fn draw(self, strength: f64, cost: f64) -> f64 {
        if cost < self.reach() {
            strength * response(cost, self.reach() / 3.)
        } else {
            0.
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Nuisance {
    Smoke,
    Noise,
    Foulness,
    Disorder,
    Stigma,
}
impl Nuisance {
    pub const ALL: [Self; 5] = [
        Self::Smoke,
        Self::Noise,
        Self::Foulness,
        Self::Disorder,
        Self::Stigma,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Service {
    Clearance,
    Protection,
    Care,
}
impl Service {
    pub const ALL: [Self; 3] = [Self::Clearance, Self::Protection, Self::Care];
}

#[derive(Clone, Copy, Debug)]
pub struct Contribution<K> {
    pub kind: K,
    pub strength: f64,
}
impl<K> Contribution<K> {
    pub const fn new(kind: K, strength: f64) -> Self {
        Self { kind, strength }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    Premises(Kind),
    Access(AccessUse),
    Activity(Activity),
}
impl Placement {
    pub fn matches(self, other: Self) -> bool {
        match (self, other) {
            (Self::Premises(a), Self::Premises(b)) => a.same_family(b),
            (Self::Activity(activity), Self::Premises(kind)) => {
                kind.definition().activity == activity
            }
            _ => self == other,
        }
    }
}

/// Site conditions which a neighbouring use can supply in part.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Requirement {
    Support,
    ConnectionCost,
}

#[derive(Clone, Copy, Debug)]
pub struct Ease {
    pub target: Placement,
    pub requirement: Requirement,
    pub relief: f64,
    pub reach: f64,
}
impl Ease {
    pub const fn premises(kind: Kind, relief: f64, reach: f64) -> Self {
        Self {
            target: Placement::Premises(kind),
            requirement: Requirement::Support,
            relief,
            reach,
        }
    }

    pub const fn access(mode: AccessUse, relief: f64, reach: f64) -> Self {
        Self {
            target: Placement::Access(mode),
            requirement: Requirement::ConnectionCost,
            relief,
            reach,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Bar {
    pub target: Placement,
    pub reach: f64,
}
impl Bar {
    pub const fn premises(kind: Kind, reach: f64) -> Self {
        Self {
            target: Placement::Premises(kind),
            reach,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Raise {
    pub target: Kind,
    pub reach: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Effects {
    pub attracts: &'static [Contribution<Clientele>],
    pub burdens: &'static [Contribution<Nuisance>],
    pub serves: &'static [Contribution<Service>],
    pub dignifies: f64,
    pub teaches: f64,
    pub connects: &'static [Contribution<AccessUse>],
    pub eases: &'static [Ease],
    pub bars: &'static [Bar],
    pub raises: &'static [Raise],
    pub holds: f64,
    pub consecrates: f64,
    pub placement_policy: Option<fn(Placement) -> bool>,
    pub minimum_support: f64,
    pub improvement: Option<Improvement>,
}
impl Effects {
    pub const EMPTY: Self = Self {
        attracts: &[],
        burdens: &[],
        serves: &[],
        dignifies: 0.,
        teaches: 0.,
        connects: &[],
        eases: &[],
        bars: &[],
        raises: &[],
        holds: 0.,
        consecrates: 0.,
        placement_policy: None,
        minimum_support: 0.,
        improvement: None,
    };
}

#[derive(Clone, Copy, Debug)]
pub enum Improvement {
    UpperStorey,
    ExpandedOperation,
}

/// Authored effects received at a site. Physical and demographic observations
/// continue to come from their respective owners.
#[derive(Clone, Copy, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct Received {
    pub nuisance: [f64; Nuisance::ALL.len()],
    pub care: f64,
    pub prestige: f64,
    pub learning: f64,
    pub consecration: f64,
}

/// Travel cost and exposure cost can be directional. An untraversable route
/// has infinite cost and contributes nothing.
pub(crate) fn response(cost: f64, reach: f64) -> f64 {
    (-cost / reach).exp()
}
