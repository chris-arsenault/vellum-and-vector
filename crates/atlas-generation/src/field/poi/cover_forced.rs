//! Classified living landscapes read the existing systems' forcings; they do not replace them.
use super::{
    catalogue::CatalogueState,
    contract::*,
    cover_landscape::{self, LandscapeState},
    cover_shared as shared,
    kinds::{Group, Kind},
    places, reads,
    state::State,
    values::*,
    visibility::Weights,
};
use crate::{field::shared::Scalar, rock::ground::queries::SurfaceResponse};
use std::{io, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Landscape {
    EmberGrove,
    ThawMeadow,
    RimeForest,
    GlowBarrens,
    FogHeath,
    Deepwood,
    WendingFen,
    WellMeadow,
    BarrowHeath,
}
impl Landscape {
    pub const ALL: [Self; 9] = [
        Self::EmberGrove,
        Self::ThawMeadow,
        Self::RimeForest,
        Self::GlowBarrens,
        Self::FogHeath,
        Self::Deepwood,
        Self::WendingFen,
        Self::WellMeadow,
        Self::BarrowHeath,
    ];
    fn identity(self) -> (Kind, &'static str, &'static str) {
        match self {
            Self::EmberGrove => (Kind::EmberGrove, "ember", "Ember grove"),
            Self::ThawMeadow => (Kind::ThawMeadow, "thaw", "Thaw meadow"),
            Self::RimeForest => (Kind::RimeForest, "rime", "Rime forest"),
            Self::GlowBarrens => (Kind::GlowBarrens, "glow", "Glow-lichen barrens"),
            Self::FogHeath => (Kind::FogHeath, "fog", "Fog heath"),
            Self::Deepwood => (Kind::Deepwood, "deepwood", "Deepwood"),
            Self::WendingFen => (Kind::WendingFen, "wending", "Wending fen"),
            Self::WellMeadow => (Kind::WellMeadow, "well", "Well meadow"),
            Self::BarrowHeath => (Kind::BarrowHeath, "barrow", "Barrow heath"),
        }
    }
    fn band(self) -> Scalar {
        match self {
            Self::EmberGrove | Self::ThawMeadow => Scalar::Quickening,
            Self::RimeForest | Self::GlowBarrens => Scalar::Stillness,
            Self::FogHeath => Scalar::FogForcing,
            Self::Deepwood | Self::WendingFen | Self::WellMeadow => Scalar::Verdure,
            Self::BarrowHeath => Scalar::Salting,
        }
    }
    fn typical_area(self) -> f64 {
        match self {
            Self::WellMeadow => 0.0000125,
            Self::WendingFen | Self::BarrowHeath => 0.00003125,
            _ => 0.000125,
        }
    }
    fn weights(self) -> Weights {
        let (magnitude, local_conditions) = match self {
            Self::EmberGrove | Self::RimeForest => (0.35, 0.45),
            Self::ThawMeadow | Self::GlowBarrens | Self::WellMeadow => (0.3, 0.5),
            Self::FogHeath => (0.45, 0.35),
            _ => (0.4, 0.4),
        };
        Weights {
            magnitude,
            local_conditions,
            isolation: 0.2,
        }
    }
    fn borders(self) -> &'static [Kind] {
        match self {
            Self::EmberGrove => &[Kind::ThawedHalo, Kind::ThawMeadow],
            Self::ThawMeadow => &[Kind::ThawedHalo, Kind::EmberGrove],
            Self::RimeForest => &[Kind::AuroraField, Kind::GlowBarrens],
            Self::GlowBarrens => &[Kind::AuroraField, Kind::RimeForest],
            Self::FogHeath => &[Kind::UpwellingFront, Kind::Grassland, Kind::Forest],
            Self::Deepwood => &[Kind::GreenwoodStand, Kind::WellMeadow],
            Self::WendingFen => &[Kind::Wetland, Kind::Deepwood],
            Self::WellMeadow => &[Kind::Spring, Kind::Deepwood],
            Self::BarrowHeath => &[Kind::KillingGround, Kind::SaltPan],
        }
    }
    fn found(self, state: &impl LandscapeState) -> io::Result<Vec<Place>> {
        let (kind, family, _) = self.identity();
        cover_landscape::places(state, kind, family, |cell| {
            shared::scalar(state, self.band(), cell)
        })
    }
    fn strength(self, state: &impl State, place: &Place) -> io::Result<f64> {
        shared::mean_scalar(state, place, self.band())
    }
    fn offers(self, state: &impl State, place: &Place) -> io::Result<Benefits> {
        let strong = self.strength(state, place)?;
        Ok(match self {
            Self::EmberGrove | Self::Deepwood => [
                (
                    Benefit::Materials,
                    shared::mean(state, place, |cell| shared::canopy(state, cell))?,
                ),
                (Benefit::Food, strong / 2.0),
                (Benefit::Sanctity, strong / 2.0),
            ]
            .into_iter()
            .collect(),
            Self::ThawMeadow => [
                (
                    Benefit::Food,
                    (shared::mean_scalar(state, place, Scalar::GrassCover)? + strong / 2.0)
                        .min(1.0),
                ),
                (Benefit::Sanctity, strong / 2.0),
            ]
            .into_iter()
            .collect(),
            Self::RimeForest => [
                (
                    Benefit::Materials,
                    shared::mean(state, place, |cell| shared::canopy(state, cell))?,
                ),
                (Benefit::Sanctity, strong),
            ]
            .into_iter()
            .collect(),
            Self::GlowBarrens => [
                (
                    Benefit::Materials,
                    shared::mean(state, place, |cell| {
                        reads::rock(state.field()?, cell, SurfaceResponse::HardestShare)
                    })?,
                ),
                (Benefit::Sanctity, strong),
            ]
            .into_iter()
            .collect(),
            Self::FogHeath => [
                (
                    Benefit::Food,
                    0.4 * shared::mean_scalar(state, place, Scalar::GrassCover)?,
                ),
                (Benefit::Water, strong),
                (
                    Benefit::Materials,
                    0.3 * shared::mean_scalar(state, place, Scalar::TreeCover)?,
                ),
            ]
            .into_iter()
            .collect(),
            Self::WendingFen => [(Benefit::Food, strong), (Benefit::Water, strong)]
                .into_iter()
                .collect(),
            Self::WellMeadow => [
                (Benefit::Food, strong),
                (Benefit::Water, strong),
                (Benefit::Sanctity, strong / 2.0),
            ]
            .into_iter()
            .collect(),
            Self::BarrowHeath => [(Benefit::Sanctity, strong)].into_iter().collect(),
        })
    }
    fn threatens(self, state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
        let strong = self.strength(state, place)?;
        let (hazard, severity) = match self {
            Self::EmberGrove => (
                "fast fire",
                (shared::mean_scalar(state, place, Scalar::FireActivity)? + strong / 2.0).min(1.0),
            ),
            Self::ThawMeadow => ("grass fire", strong / 2.0),
            Self::RimeForest => ("stilling cold", strong / 2.0),
            Self::GlowBarrens => ("thirst and stilling cold", strong / 2.0),
            Self::FogHeath => ("lost in fog", strong / 2.0),
            Self::Deepwood => ("growth taking back the road", strong / 3.0),
            Self::WendingFen => ("channels that shift", strong / 3.0),
            Self::BarrowHeath => ("salted water and ground", strong / 2.0),
            Self::WellMeadow => return Ok(Vec::new()),
        };
        Ok(vec![Hazard {
            hazard: hazard.into(),
            reach: shared::hazard_reach(state, place)?,
            severity,
        }])
    }
    fn fate(self, state: &impl State, place: &Place) -> io::Result<Fate> {
        let threshold = match self {
            Self::EmberGrove | Self::ThawMeadow => 0.25,
            Self::RimeForest | Self::GlowBarrens => 0.45,
            _ => 0.3,
        };
        if self.strength(state, place)? >= threshold {
            return Ok(Fate::Persists);
        }
        Ok(Fate::Becomes(match self {
            Self::EmberGrove | Self::RimeForest | Self::Deepwood => Kind::Forest,
            Self::ThawMeadow | Self::WellMeadow | Self::BarrowHeath => Kind::Grassland,
            Self::GlowBarrens => Kind::Barren,
            Self::WendingFen => Kind::Wetland,
            Self::FogHeath => {
                if shared::mean_scalar(state, place, Scalar::TreeCover)? >= 0.15 {
                    Kind::Forest
                } else {
                    Kind::Grassland
                }
            }
        }))
    }
    fn lends_name(self) -> bool {
        matches!(self, Self::EmberGrove | Self::ThawMeadow | Self::FogHeath)
    }
}
pub fn entry<S: CatalogueState<Schedule> + LandscapeState + 'static, Schedule: 'static>(
    landscape: Landscape,
) -> Entry<S, Schedule> {
    let (kind, family, name) = landscape.identity();
    let mut movement = shared::movement(
        "Existing routers and carriers read the cover; the landscape adds no duplicate cost.",
    );
    if landscape == Landscape::GlowBarrens {
        movement.roads = Slot::Value(Rc::new(shared::waterless_roads));
    }
    Entry {
        id: kind, group: Group::Cover, name: name.into(),
        recognition: Recognition { distinct: Must::Value(format!("Land in the {family} biome family, as classified from its forcing and living cover.")), is_a: Must::Value(Rc::new(move |state, cell| cover_landscape::is_family(state, family, cell))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("The system's own forcing and the ecology's cover establish this family wherever they meet.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("Classification reads forcing and cover."), suitability: Slot::NotApplicable("The forcing reaches the ground without a siting process."), places: Must::Value(Rc::new(move |state| landscape.found(state))) },
        publication: Publication { statement: Must::Value("Publish biome-class outlines and the strongest contributing system on the ecology layer.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(move |state: &S, place: &Place| cover_landscape::record(state, kind, family, place, || landscape.found(state)))) },
        across_maps: shared::developed_country("Captured forcing and cover develop on the independent child; its name follows the nearest of its family within two parent cells or goes.", Rc::new(move |state, cell| cover_landscape::is_family(state, family, cell))), event: None,
        roles: Roles {
            true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten,
            fields: shared::fields("The system's forcing acts through existing ecology, soil and climate processes over the whole field."), movement,
            others: Others { statement: Must::Value("Distinct landscape families partition the ground and meet their related country at the edges.".into()), needs: Slot::NotApplicable("A forcing may originate from more than one place."), excludes: Slot::Value(shared::other_landscapes(kind)), contains: Slot::NotApplicable("No site is required to stand only in this landscape."), pairs_with: Slot::Value(shared::borders(landscape.borders())) },
            people: People { statement: Must::Value("Its current forcing and cover determine its food, materials, water, sanctity and particular hazard.".into()), offers: Slot::Value(Rc::new(move |state, place| landscape.offers(state, place))), threatens: if landscape == Landscape::WellMeadow { Slot::NotApplicable("It endangers no one.") } else { Slot::Value(Rc::new(move |state, place| landscape.threatens(state, place))) } },
            time: ThroughTime { statement: Must::Value("When its forcing falls away, the remaining cover becomes the corresponding ordinary landscape.".into()), fate: Slot::Value(Rc::new(move |state, place| landscape.fate(state, place))) },
            visibility: shared::country_factors("Forcing contrast, extent, isolation and people determine its mark.", Rc::new(move |state| landscape.found(state)), landscape.typical_area(), Rc::new(move |state, cell| shared::scalar(state, landscape.band(), cell)), landscape.weights()),
            naming: Naming { statement: Must::Value("Nearby people name the landscape; particular families lend names to neighbouring towns.".into()), named_by: Slot::Value(Rc::new(places::naming_culture_near)), takes_name_from: Slot::NotApplicable("The landscape has its own name."), lends_name_to: if landscape.lends_name() { Slot::Value(vec![shared::within_own(Kind::Settlement, Rc::new(shared::span))]) } else { Slot::NotApplicable("Settlements name themselves or keep away under this family's rule.") }, term: Slot::Unwritten },
        },
    }
}
