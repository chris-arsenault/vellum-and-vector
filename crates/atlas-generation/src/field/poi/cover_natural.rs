//! The three ordinary biome families retain their distinct food, hazard and succession rules.
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
use crate::{
    ecology::environment,
    field::{shared::Scalar, significance::measure},
    rock::ground::{queries::SurfaceResponse, GroundField},
};
use std::{io, rc::Rc};

const FOREST_AREA: f64 = 0.003125;
const OPEN_AREA: f64 = 0.00625;
const LOST_CANOPY: f64 = 0.5;
const STARTING_SOIL: f64 = 0.000000075;
#[derive(Clone, Copy, PartialEq, Eq)]
enum Cover {
    Forest,
    Grassland,
    Barren,
}
impl Cover {
    fn kind(self) -> Kind {
        match self {
            Self::Forest => Kind::Forest,
            Self::Grassland => Kind::Grassland,
            Self::Barren => Kind::Barren,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Forest => "Forest",
            Self::Grassland => "Grassland",
            Self::Barren => "Barren",
        }
    }
    fn family(self) -> &'static str {
        self.kind().as_str()
    }
    fn rank(self, state: &impl State, cell: usize) -> io::Result<f64> {
        match self {
            Self::Forest => shared::scalar(state, Scalar::TreeCover, cell),
            Self::Grassland => shared::scalar(state, Scalar::GrassCover, cell),
            Self::Barren => Ok(1.0 - shared::living_cover(state, cell)?),
        }
    }
    fn found(self, state: &impl LandscapeState) -> io::Result<Vec<Place>> {
        cover_landscape::places(state, self.kind(), self.family(), |cell| {
            self.rank(state, cell)
        })
    }
}
fn forest_food(state: &impl State, place: &Place) -> io::Result<f64> {
    let still = shared::mean_scalar(state, place, Scalar::Stillness)?;
    let gathered = shared::mean(state, place, |cell| {
        Ok(shared::scalar(state, Scalar::TreeCover, cell)?
            * (shared::scalar(state, Scalar::Productivity, cell)? * 3.0).min(1.0)
            + shared::scalar(state, Scalar::Herbivores, cell)?)
    })?;
    Ok(gathered.min(1.0) * (1.0 - 0.8 * still))
}
fn offers(cover: Cover, state: &impl State, place: &Place) -> io::Result<Benefits> {
    Ok(match cover {
        Cover::Forest => [
            (
                Benefit::Materials,
                shared::mean(state, place, |cell| shared::canopy(state, cell))?,
            ),
            (Benefit::Food, forest_food(state, place)?),
            (
                Benefit::Defence,
                0.3 * shared::mean_scalar(state, place, Scalar::TreeCover)?,
            ),
            (
                Benefit::Sanctity,
                shared::mean(state, place, |cell| {
                    Ok(f64::from(shared::old_stand(state, cell)?))
                })?
                .max(shared::mean_scalar(state, place, Scalar::Verdure)?),
            ),
        ]
        .into_iter()
        .collect(),
        Cover::Grassland => {
            let grass = shared::mean_scalar(state, place, Scalar::GrassCover)?;
            let food = shared::mean(state, place, |cell| {
                Ok(shared::scalar(state, Scalar::GrassCover, cell)?
                    * (-((reads::celsius(state.field()?, cell)? - 18.0) / 20.0).powi(2)).exp())
            })?;
            [
                (Benefit::Food, food),
                (Benefit::Trade, 0.3 * grass),
                (Benefit::Materials, 0.2 * grass),
            ]
            .into_iter()
            .collect()
        }
        Cover::Barren => [(
            Benefit::Materials,
            shared::mean(state, place, |cell| {
                reads::rock(state.field()?, cell, SurfaceResponse::HardestShare)
            })?,
        )]
        .into_iter()
        .collect(),
    })
}
fn threatens(cover: Cover, state: &impl State, place: &Place) -> io::Result<Vec<Hazard>> {
    let reach = shared::hazard_reach(state, place)?;
    if cover == Cover::Barren {
        let dry = shared::mean(state, place, |cell| {
            Ok(1.0 - shared::plant_water(state, cell)?)
        })?;
        let wind = shared::mean(state, place, |cell| {
            environment::wind_strength(state.field()?, cell)
        })?;
        return Ok(vec![
            Hazard {
                hazard: "thirst".into(),
                reach,
                severity: dry,
            },
            Hazard {
                hazard: "dust and moving sand".into(),
                reach,
                severity: (dry * wind / 2.0).min(1.0),
            },
        ]);
    }
    let fire = shared::mean_scalar(state, place, Scalar::FireActivity)?;
    Ok(if fire > 0.0 {
        vec![Hazard {
            hazard: if cover == Cover::Forest {
                "wildfire"
            } else {
                "grass fire"
            }
            .into(),
            reach,
            severity: fire.min(1.0),
        }]
    } else {
        Vec::new()
    })
}
fn fate(cover: Cover, state: &impl State, place: &Place) -> io::Result<Fate> {
    Ok(match cover {
        Cover::Forest => {
            if shared::mean_scalar(state, place, Scalar::EcologicalDamage)? > LOST_CANOPY {
                Fate::Becomes(Kind::Grassland)
            } else {
                Fate::Persists
            }
        }
        Cover::Grassland => {
            if shared::mean(state, place, |cell| shared::living_cover(state, cell))? < 0.12 {
                Fate::Becomes(Kind::Barren)
            } else if shared::mean(state, place, |cell| {
                Ok(shared::scalar(state, Scalar::BroadleafSaplings, cell)?
                    + shared::scalar(state, Scalar::ConiferSaplings, cell)?)
            })? >= 0.15
            {
                Fate::Becomes(Kind::Forest)
            } else {
                Fate::Persists
            }
        }
        Cover::Barren => {
            let field = state.field()?;
            let water = shared::mean(state, place, |cell| shared::plant_water(state, cell))?;
            let soil = shared::mean(state, place, |cell| {
                field.ground().view(GroundField::SoilDepth).get(cell)
            })?;
            if water >= 0.25 && soil >= measure(&field.scale, STARTING_SOIL, 1, 0.5)? {
                Fate::Becomes(Kind::Grassland)
            } else {
                Fate::Persists
            }
        }
    })
}
fn others<S: State + 'static>(cover: Cover) -> Others<S> {
    let mut excludes = shared::other_landscapes(cover.kind());
    let (contains, borders, nearby): (&[Kind], &[Kind], f64) = match cover {
        Cover::Forest => (
            &[Kind::Shrine, Kind::Ruin, Kind::Spring, Kind::GreenwoodStand],
            &[Kind::Grassland, Kind::Wetland, Kind::Clearance],
            3.0,
        ),
        Cover::Grassland => (
            &[Kind::Battlefield, Kind::Irrigation],
            &[Kind::Forest, Kind::Barren],
            3.0,
        ),
        Cover::Barren => (
            &[Kind::Oasis, Kind::Mine, Kind::Ruin, Kind::EjectaFan],
            &[
                Kind::Grassland,
                Kind::SaltPan,
                Kind::SaltDust,
                Kind::GlassFlat,
            ],
            4.0,
        ),
    };
    if cover == Cover::Barren {
        excludes.extend(shared::holds(&[Kind::SaltPan, Kind::GlassFlat]));
    }
    let mut pairs = shared::borders(borders);
    pairs.push(shared::near(Kind::Settlement, nearby));
    Others { statement: Must::Value("Biome families partition ground; sites occupy them and other country meets their edges.".into()), needs: Slot::NotApplicable("Ground, cover and climate suffice."), excludes: Slot::Value(excludes), contains: Slot::Value(shared::holds(contains)), pairs_with: Slot::Value(pairs) }
}
fn naming<S: State + 'static>(cover: Cover) -> Naming<S> {
    Naming {
        statement: Must::Value(
            "Nearby people name the country, and towns may take a living landscape's name.".into(),
        ),
        named_by: Slot::Value(Rc::new(places::naming_culture_near)),
        takes_name_from: Slot::NotApplicable("Country is named for itself before its settlements."),
        lends_name_to: if cover == Cover::Barren {
            Slot::NotApplicable("Few take the name of an empty place.")
        } else {
            Slot::Value(vec![shared::within_own(
                Kind::Settlement,
                Rc::new(shared::span),
            )])
        },
        term: Slot::Unwritten,
    }
}
fn entry<S: CatalogueState<Schedule> + LandscapeState + 'static, Schedule: 'static>(
    cover: Cover,
) -> Entry<S, Schedule> {
    let mut across_maps = shared::developed_country("Captured cover develops independently on the child; the name follows its own family within two parent cells.", Rc::new(move |state, cell| cover_landscape::is_family(state, cover.family(), cell)));
    if cover == Cover::Barren {
        across_maps.statement = Must::Value("Fine green valleys can form within captured barren country; its name stays at the landing when no counterpart remains.".into());
        across_maps.unrealized = Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep)));
        across_maps.settle = Slot::Value(Rc::new(|_, _| Ok(Unrealized::Keep)));
    }
    let mut movement =
        shared::movement("Road, channel and root-carrier costs read each cell's cover directly.");
    if cover == Cover::Barren {
        movement.roads = Slot::Value(Rc::new(shared::waterless_roads));
    }
    let weights = match cover {
        Cover::Forest => Weights {
            magnitude: 0.6,
            local_conditions: 0.25,
            isolation: 0.15,
        },
        Cover::Grassland => Weights {
            magnitude: 0.7,
            local_conditions: 0.2,
            isolation: 0.1,
        },
        Cover::Barren => Weights {
            magnitude: 0.55,
            local_conditions: 0.3,
            isolation: 0.15,
        },
    };
    Entry {
        id: cover.kind(), group: Group::Cover, name: cover.name().into(),
        recognition: Recognition { distinct: Must::Value(format!("Land in the {} biome family; magic-forced families and water retain their own kinds.", cover.family())), is_a: Must::Value(Rc::new(move |state, cell| cover_landscape::is_family(state, cover.family(), cell))), landform: Slot::Unwritten },
        existence: Existence { origins: Slot::Unwritten, statement: Must::Value("Climate, soil, cohorts, grazers and fire establish the biome; its properties determine the published name.".into()), way: Must::Value(ExistenceWay::Emerges), requires: Slot::NotApplicable("The biome class reads its cover."), suitability: Slot::NotApplicable("No process sites a biome family."), places: Must::Value(Rc::new(move |state| cover.found(state))) },
        publication: Publication { statement: Must::Value("Publish coherent biome provinces on ecology, outlined by class margins and named from their means.".into()), moment: Must::Value(Moment::Geography), record: Must::Value(Rc::new(move |state: &S, place: &Place| cover_landscape::record(state, cover.kind(), cover.family(), place, || cover.found(state)))) },
        across_maps, event: None,
        roles: Roles {
            true_size: Slot::Unwritten, variety: Slot::Unwritten, appearance: Slot::Unwritten, account: Slot::Unwritten,
            fields: shared::fields("Cover controls soil retention, infiltration, runoff and evaporation through their existing owners."), movement, others: others(cover),
            people: People { statement: Must::Value("Forest supplies timber, gathering and game; grass supplies grazing and open trade; barren ground exposes stone and threatens dry crossings.".into()), offers: Slot::Value(Rc::new(move |state, place| offers(cover, state, place))), threatens: Slot::Value(Rc::new(move |state, place| threatens(cover, state, place))) },
            time: ThroughTime { statement: Must::Value("Damage opens canopy, saplings close grassland, and water on soil greens barren ground.".into()), fate: Slot::Value(Rc::new(move |state, place| fate(cover, state, place))) },
            visibility: shared::country_factors("Breadth, contrast, isolation and dependent towns determine the landscape's mark.", Rc::new(move |state| cover.found(state)), if cover == Cover::Forest { FOREST_AREA } else { OPEN_AREA }, Rc::new(move |state, cell| cover.rank(state, cell)), weights), naming: naming(cover),
        },
    }
}
pub fn forest<S: CatalogueState<Schedule> + LandscapeState + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    entry(Cover::Forest)
}
pub fn grassland<S: CatalogueState<Schedule> + LandscapeState + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    entry(Cover::Grassland)
}
pub fn barren<S: CatalogueState<Schedule> + LandscapeState + 'static, Schedule: 'static>(
) -> Entry<S, Schedule> {
    entry(Cover::Barren)
}
