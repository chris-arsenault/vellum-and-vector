//! Settlement place registration. Each entry owns its premises, siting policy and development offers.
use super::{
    fabric::{HoldingId, Purpose, Town},
    influence::Conditions,
    seat::Seat,
    siting::Location,
};
pub use atlas_map::town::places::Activity;
use atlas_map::town::places::{FineCraft, Kind as Identity, Residence, Retail};
use atlas_map::town::{BuildingFunction, Trade as CraftTrade, Use};
mod agriculture;
pub(crate) mod founding_places;
pub mod development;
mod hospitality;
mod household;
mod institution;
mod production;
mod purposes;
mod service;
mod trade;
pub(crate) mod works;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Form {
    Frontage,
    Yard,
    Court,
    Compound,
    Open,
    WaterEdge,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ServiceRole {
    #[default]
    None,
    Clearance,
    Protection,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum AccessUse {
    Foot,
    Freight,
    Waterborne,
}
/// Journeys have separate purposes even when their endpoints share a building.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Operation {
    Work,
    Supply,
    Service,
    Customers,
}
impl Operation {
    pub const ALL: [Self; 4] = [Self::Work, Self::Supply, Self::Service, Self::Customers];
    pub fn offered_by(self, activity: Activity) -> bool {
        match self {
            Self::Work => activity != Activity::Household,
            Self::Supply => matches!(
                activity,
                Activity::Trade | Activity::Production | Activity::Agriculture
            ),
            Self::Service => matches!(
                activity,
                Activity::Service | Activity::Institution | Activity::Hospitality
            ),
            Self::Customers => matches!(activity, Activity::Household | Activity::Trade),
        }
    }
    pub fn relation(self) -> &'static str {
        match self {
            Self::Work => "worksAt",
            Self::Supply => "suppliedBy",
            Self::Service => "servedBy",
            Self::Customers => "servesCustomersAt",
        }
    }
}
impl AccessUse {
    pub fn street_class(self) -> Option<super::network::Class> {
        match self {
            Self::Foot => Some(super::network::Class::Lane),
            Self::Freight => Some(super::network::Class::Street),
            Self::Waterborne => None,
        }
    }
    pub fn permits_street(self, street: &super::network::Street) -> bool {
        !street.widths.is_empty() && street.widths.iter().all(|w| self.permits_width(*w))
    }
    pub fn permits_width(self, width: f64) -> bool {
        match self {
            Self::Foot => true,
            Self::Freight => width >= 2.4,
            Self::Waterborne => false,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Site {
    PreferStreet,
    RequireStreet,
    OpenGround,
    WorkingLand,
    RootedGround,
    Waterfront,
    FlowingWater,
    PractisedGround,
}
#[derive(Clone, Copy, Debug)]
pub struct Premises {
    pub site: Site,
    pub access: AccessUse,
    pub shares_with: &'static [Activity],
}
#[derive(Clone, Copy, Debug)]
pub struct MetresRange {
    pub low: f64,
    pub high: f64,
}

impl MetresRange {
    pub fn sample(self, share: f64) -> f64 {
        self.low + (self.high - self.low) * share
    }
    fn frontage(width: f64) -> Self {
        Self {
            low: width * 0.7,
            high: width * 1.35,
        }
    }
    fn depth(depth: f64) -> Self {
        Self {
            low: depth * 0.75,
            high: depth * 1.3,
        }
    }
    fn residential(metres: f64) -> Self {
        Self {
            low: metres * 0.8,
            high: metres * 1.2,
        }
    }
}

// owner-direction(2026-11-18): special rules for a POI belong in the POI.
/// Settlement processes receive a catalogue key whose concrete identity stays private.
///
/// ```compile_fail,E0277
/// use atlas_generation::town::catalogue::Kind;
/// use atlas_map::town::places::Kind::Market as Special;
/// let key: Kind = Special.into();
/// ```
///
/// ```compile_fail,E0616
/// use atlas_generation::town::catalogue::Kind;
/// fn inspect(key: Kind) { let _ = key.0; }
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct Kind(Identity);
impl Kind {
    pub fn same_family(self, other: Self) -> bool {
        std::mem::discriminant(&self.0) == std::mem::discriminant(&other.0)
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Definition {
    pub premises: Premises,
    pub label: &'static str,
    pub naming_work: &'static str,
    pub activity: Activity,
    pub form: Form,
    pub frontage: MetresRange,
    pub depth: MetresRange,
    pub prominence: f64,
    pub typical_means: f64,
    pub nuisance: f64,
    pub demand: f64,
    pub legacy_use: Use,
    pub attraction: fn(&Location) -> f64,
    pub function: BuildingFunction,
    pub roles: Roles,
}
type Intention = fn(Kind, &Seat) -> Option<Purpose>;
type Furnishing = fn(&Seat) -> Option<&'static str>;
type Establishment = fn(&mut Town, HoldingId, Conditions);
#[derive(Clone, Copy, Debug, Default)]
pub struct Roles {
    landside_access: Option<AccessUse>,
    pub frontage_activities: &'static [Activity],
    pub(crate) founding: Option<fn(Conditions) -> f64>,
    pub ground_cover: Option<&'static str>,
    pub furnishing: Option<Furnishing>,
    pub attached_range: bool,
    pub service: ServiceRole,
    pub dwelling: bool,
    pub household: bool,
    pub works_fields: bool,
    pub on_established: Option<Establishment>,
    pub gathering_space: bool,
    pub indoor_sharing: bool,
    pub secondary_business: Option<fn(Conditions) -> Kind>,
    pub housing_offer: Option<fn(&development::HousingSite) -> bool>,
    pub subdivision_use: Option<Kind>,
    pub civic_need: Option<fn(&development::CivicConditions) -> bool>,
    pub outbuilding: Option<Kind>,
    variants: &'static [Kind],
    intention: Option<Intention>,
}
pub(crate) fn founding_work(site: Conditions) -> Kind {
    PLACES
        .iter()
        .copied()
        .filter_map(|kind| {
            let score = kind.definition().roles.founding?(site);
            (score > 0. && super::siting::suitable_ground(kind, site)).then_some((score, kind))
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .expect("provisioning supports any founding site")
        .1
}
impl Definition {
    pub(crate) fn investment_cost(&self) -> f64 {
        0.12 + self.prominence * 0.18
    }
    pub fn operating_mode(&self, purpose: Operation) -> Option<AccessUse> {
        match purpose {
            Operation::Work if self.roles.household => Some(AccessUse::Foot),
            Operation::Service => Some(AccessUse::Foot),
            Operation::Supply => Some(self.operating_access()),
            Operation::Customers if self.activity != Activity::Household => Some(AccessUse::Foot),
            _ => None,
        }
    }
    pub fn operating_access(&self) -> AccessUse {
        self.roles.landside_access.unwrap_or(self.premises.access)
    }
    pub fn indoor_sharing(&self) -> bool {
        self.form != Form::Open || self.roles.indoor_sharing
    }
    pub fn building(self, component: usize) -> Self {
        self.roles
            .outbuilding
            .filter(|_| component > 0)
            .map_or(self, Kind::definition)
    }
}
pub trait PlaceRules: Copy {
    fn definition(self) -> Definition;
    fn open(self) -> bool {
        self.definition().form == Form::Open
    }
}

/// The same registration supplies proposal families and resolves every published identity.
/// Families with variants nominate one representative for the proposal pass.
macro_rules! register_places {
    (
        household_forms: $family:ident($form:ident) => $household:path;
        $( $name:ident $(($variant:ident = $representative:path))? => $entry:path ),+ $(,)?
    ) => {
        pub const PLACES: [Kind; [$(stringify!($name)),+].len()] = [
            $(Kind(Identity::$name $(($representative))?)),+
        ];
        impl PlaceRules for Kind {
            fn definition(self) -> Definition {
                match self.0 {
                    $(Identity::$name $(($variant))? => $entry($($variant)?),)+
                    Identity::$family($form) => $household($form),
                }
            }
        }
    };
}
register_places! {
    household_forms: Residence(form) => household::residence;
    Market => trade::market,
    ExchangeHall => trade::exchange_hall,
    Provision => trade::provision,
    Retail(variant = Retail::Bookseller) => trade::retail,
    FineCraft(variant = FineCraft::Jeweller) => production::fine_craft,
    DomesticCraft => production::domestic_craft,
    HeavyCraft => production::heavy_craft,
    Smithy => production::smithy,
    NoxiousWorks => production::noxious_works,
    Mill => production::mill,
    Brewhouse => production::brewhouse,
    Inn => hospitality::inn,
    Tavern => hospitality::tavern,
    Cookshop => hospitality::cookshop,
    CarrierYard => service::carrier_yard,
    Storehouse => trade::storehouse,
    Landing => trade::landing,
    AssemblyHall => institution::assembly_hall,
    GuildHall => institution::guild_hall,
    CourtHouse => institution::court_house,
    Watch => institution::watch,
    Toll => institution::toll,
    Manor => institution::manor,
    Worship => institution::worship,
    Shrine => institution::shrine,
    ReligiousHouse => institution::religious_house,
    Burial => institution::burial,
    Healer => service::healer,
    Almshouse => institution::almshouse,
    Learning => service::learning,
    WaterPoint => service::water_point,
    WashHouse => service::wash_house,
    Sanitation => service::sanitation,
    Common => agriculture::common,
    Garden => household::garden,
    Grove => agriculture::grove,
    Park => household::park,
    Fairground => trade::fairground,
    Entertainment => hospitality::entertainment,
    Farmstead => agriculture::farmstead,
    Outbuilding => agriculture::outbuilding,
    ResourceYard => production::resource_yard,
    CraftPractice => service::craft_practice,
}
/// Select a member of the variant family registered by this POI.
pub fn palette(kind: Kind, sample: f64) -> Kind {
    let variants = kind.definition().roles.variants;
    if variants.is_empty() {
        return kind;
    }
    let index = (sample.clamp(0., 1.) * variants.len() as f64) as usize;
    variants[index.min(variants.len() - 1)]
}

#[cfg(test)]
mod site_tests {
    use super::*;
    use crate::town::{
        network::{Class, Street},
        siting::{feasible, Location},
        story::Size,
    };

    #[test]
    fn traders_can_settle_before_a_road_while_a_tollhouse_requires_one() {
        let road = Street::new(vec![[0., 0.], [80., 0.]], Class::Main, Size::Town);
        let land = Conditions {
            exchange: 1.,
            ..Conditions::default()
        };
        let merchant = Kind(Identity::Retail(Retail::Clothier));
        let frontage = Location::at(land, Some(&road), 40., 0.);
        let independent = Location::at(land, None, 0., 0.);
        assert_eq!(independent.freight, 0.);
        assert!(feasible(merchant, land, None));
        assert!(
            frontage.attraction(merchant.definition())
                > independent.attraction(merchant.definition())
        );
        assert!(!feasible(Kind(Identity::Toll), land, None));
        assert!(feasible(Kind(Identity::Toll), land, Some(0)));
        let croft = Kind(Identity::Residence(Residence::Croft));
        assert!(
            independent.attraction(croft.definition()) > frontage.attraction(croft.definition())
        );
    }
}
