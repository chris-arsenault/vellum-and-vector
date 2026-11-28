//! A town bench: the real street rounds run on a small district built on constructed
//! ground, inside a unit test. A rule change is judged here in seconds by what goes in and
//! what comes out, where a generated map takes ten to twenty minutes.
//!
//! The bench founds a district as the map does (a way in from its avenue and a kernel),
//! then runs every street step in order, round after round. Each step's sources, site
//! conditions and offered plots come from the same functions the map's driver calls
//! (`occupation_sources`, `town_exposure`, `site_conditions`, `offered_slots`,
//! `town_step`), so the bench is the driver without the map, not a second definition.
//!
//! What a test says and the map would read from its fields: the land every site stands on
//! (`land`), what a district's program reads of it (`read`), and that no practice is kept.
//! What the bench leaves out: the trade and waste signals a map spreads over its lattice
//! between steps, neighbouring towns, kept links, worked fields and outlying settlement.
use super::{
    development::{offered_slots, site_conditions, town_step, StepInputs, TownSites},
    providers::{occupation_sources, town_exposure, Carrier, Surroundings},
};
use crate::{
    processes::town::{self as processes, urban::street_context::LandRead, Mechanism},
    spatial::SpatialKernel,
    town::{
        catalogue::{Kind, PlaceRules},
        fabric::{DistrictSite, DistrictTract, Town},
        geometry::Point,
        ground::{Ground, PLOT, SQUARE},
        influence::Conditions,
        network::{Class, Street},
        order::Order,
        seat::Seat,
        story::Story,
        templates::{civic::Civic, district::InheritedProgram, Habitat, Selection, SiteEvidence},
    },
};
use atlas_map::{Bounds, Geometry, Id};
use std::io;

/// What a test says of the district it wants.
#[derive(Clone)]
pub(crate) struct Site {
    /// The people the City gives the district.
    pub people: f64,
    /// The side of its square outline, in metres.
    pub side: f64,
    /// The share of its ground the City found built on, and its people per square
    /// kilometre of that ground.
    pub built_share: f64,
    pub civic: Option<Civic>,
    pub program: Option<InheritedProgram>,
    /// The order the map's settings give before the civic order writes over it.
    pub order: Order,
    pub seed: i32,
}
impl Default for Site {
    fn default() -> Self {
        Self {
            people: 1_500.,
            side: 300.,
            built_share: 0.8,
            civic: None,
            program: None,
            order: Order::default(),
            seed: 1,
        }
    }
}

/// One occupied home: the street it stands on, its household's means, its plot and kind.
#[derive(Clone, Debug)]
pub(crate) struct Home {
    pub street: Option<usize>,
    pub means: f64,
    pub plot: f64,
    pub kind: Kind,
}

pub(crate) struct Bench {
    pub town: Town,
    /// The land every site stands on, before the town's premises add to it.
    pub land: Conditions,
    /// What the land holds for a district's program.
    pub read: LandRead,
    spatial: atlas_gis::geometry::NativeGeos,
    bounds: [f64; 4],
    /// The streets the district had when founded: its avenue and the way in.
    founded_streets: usize,
}

/// The finest ground cell, as a street map's ground has it.
const CELL: f64 = crate::town::settings::FINEST_CELL;

fn rectangle([west, south, east, north]: [f64; 4]) -> Geometry {
    atlas_map::regions::rectangle(Bounds(west, south, east, north))
}

impl Bench {
    /// Founds a district on level, dry, open ground: a square outline with one avenue up
    /// its west side and one inhabited tract, a way in and a kernel of premises.
    pub fn district(site: Site) -> io::Result<Self> {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).map_err(io::Error::other)?;
        let side = site.side;
        let bounds = [0., 0., side, side];
        let mut town = Town::new(
            Seat {
                key: Id::from_name("bench district"),
                name: "Bench".into(),
                centre: [side / 2., side / 2.],
                story: Story {
                    people: site.people,
                    ..Default::default()
                },
                arms: vec![],
                culture: None,
            },
            None,
        );
        // The civic order and crafts are what the test says, not a draw from the site.
        town.template = Selection::choose(SiteEvidence::default(), 0.);
        town.template.civic = site.civic;
        town.template.crafts.clear();
        town.set_approaches(vec![Street::new(
            vec![[20., 0.], [20., side]],
            Class::Main,
            town.seat.story.size(),
        )]);
        let tract = [40., 20., side - 20., side - 20.];
        let tract_m2 = (tract[2] - tract[0]) * (tract[3] - tract[1]);
        let density = site.people / (tract_m2 * site.built_share / 1e6);
        town.district = Some(DistrictSite {
            outline: rectangle(bounds),
            reserves: vec![],
            streets: vec![(Id::from_name("bench avenue"), "Avenue".into())],
            program: site.program,
            tracts: vec![DistrictTract {
                civic: false,
                area: rectangle(tract),
                mix: Default::default(),
                built_share: Some(site.built_share),
                developed_m2: tract_m2 * site.built_share,
                density_per_km2: Some(density),
            }],
            density_per_km2: Some(density),
            old_walls: None,
        });
        town.ordered(site.order, site.seed);
        let land = Conditions {
            protection: 1.,
            building: 1.,
            travel: 1.,
            population: density,
            standing: Some(0.5),
            ..Default::default()
        };
        let ground = Ground::new(bounds, CELL);
        let origins = processes::urban::neighbourhood::streets(&mut town, &ground, &spatial)?;
        crate::town::founding::occupy_district(&mut town, origins, &ground, &spatial, |_| {
            Ok(Some(land))
        })?;
        let founded_streets = town.streets().len();
        Ok(Self {
            town,
            land,
            read: LandRead::default(),
            spatial,
            bounds,
            founded_streets,
        })
    }

    fn on_ground(&self, [x, y]: Point) -> bool {
        let [west, south, east, north] = self.bounds;
        (west..=east).contains(&x) && (south..=north).contains(&y)
    }
    fn ground_holdings(&self) -> impl Iterator<Item = &crate::town::fabric::Holding> {
        self.town
            .holdings()
            .iter()
            .filter(|h| h.slot.habitat.shares_surface(Habitat::Ground))
    }
    /// The ground people walk: open land with the town's buildings standing on it.
    fn walking_ground(&self) -> io::Result<Ground> {
        let mut ground = Ground::new(self.bounds, CELL);
        let buildings: Vec<_> = self
            .ground_holdings()
            .flat_map(|h| h.buildings.iter().cloned())
            .collect();
        ground.mark_shapes(&buildings, PLOT, &self.spatial)?;
        Ok(ground)
    }
    /// The walking ground with every plot and works ground taken.
    fn occupied_ground(&self) -> io::Result<Ground> {
        let mut ground = self.walking_ground()?;
        let plots: Vec<_> = self.ground_holdings().map(|h| h.outline.clone()).collect();
        ground.mark_shapes(&plots, PLOT, &self.spatial)?;
        let works: Vec<_> = self
            .town
            .works
            .commissions
            .iter()
            .filter_map(|w| w.grounds.clone())
            .collect();
        ground.mark_shapes(&works, SQUARE, &self.spatial)?;
        Ok(ground)
    }

    /// One step of the round, prepared and run as the map's driver prepares and runs it.
    fn step(&mut self, step: &processes::Step) -> io::Result<()> {
        let frontage = matches!(step.run, Mechanism::Movement(_) | Mechanism::Frontage(_));
        let reads_sources = frontage || matches!(step.run, Mechanism::Livelihood(_));
        let walking = self.walking_ground()?;
        let sources = if reads_sources {
            occupation_sources(&self.town, &|_| Ok(None))?
        } else {
            vec![]
        };
        let candidates = if frontage {
            offered_slots(&self.town, &walking, &sources, &self.spatial, &|point| {
                self.on_ground(point)
            })?
        } else {
            vec![]
        };
        let request = TownSites::new(
            step.run,
            self.town.holdings(),
            &candidates,
            std::iter::empty(),
        );
        let made = town_exposure(
            &self.town,
            &request,
            &Surroundings {
                fields: &[],
                ground: &walking,
                spatial: &self.spatial,
                carrier: &|_| Ok(Carrier::default()),
            },
        )?;
        let crafts = self.town.template.crafts.clone();
        let observations: Vec<_> = made
            .iter()
            .map(|town| site_conditions(&self.land, town, &crafts))
            .collect();
        let mut occupied = frontage.then(|| self.occupied_ground()).transpose()?;
        let read = self.read;
        town_step(
            &mut self.town,
            step,
            StepInputs {
                walking_ground: &walking,
                ground: occupied.as_mut(),
                links: &[],
                sources: &sources,
                spatial: &self.spatial,
                channel_depth: &|_| Ok(None),
                land: &|_| Ok(Some(read)),
                candidates: &candidates,
                observations: &observations,
                outlying: &[],
            },
        )?;
        Ok(())
    }
    /// Runs every street step once, in the order the map runs them.
    pub fn round(&mut self) -> io::Result<()> {
        for step in processes::STEPS {
            self.step(step)?;
        }
        Ok(())
    }
    pub fn rounds(&mut self, count: usize) -> io::Result<()> {
        for _ in 0..count {
            self.round()?;
        }
        Ok(())
    }

    /// The length of the streets the rounds laid, beyond the avenue and the way in.
    pub fn laid(&self) -> f64 {
        self.town.streets()[self.founded_streets..]
            .iter()
            .map(Street::length)
            .sum()
    }
    /// Every occupied home.
    pub fn homes(&self) -> io::Result<Vec<Home>> {
        self.town
            .holdings()
            .iter()
            .filter(|h| h.occupation > 0. && h.kind.definition().roles.household)
            .map(|h| {
                Ok(Home {
                    street: h.slot.street,
                    means: h.means,
                    plot: self.spatial.area(&h.outline).map_err(io::Error::other)?,
                    kind: h.kind,
                })
            })
            .collect()
    }
    /// The middle plot size among `homes`.
    pub fn median_plot(homes: &[Home]) -> f64 {
        let mut plots: Vec<_> = homes.iter().map(|h| h.plot).collect();
        plots.sort_by(f64::total_cmp);
        plots.get(plots.len() / 2).copied().unwrap_or(0.)
    }
}

/// The share of the difference in `homes`' means that lies between streets and not within
/// them, beside the share chance alone leaves between streets of these sizes. Nothing
/// where the homes do not differ.
pub(crate) fn apart(homes: &[Home]) -> Option<[f64; 2]> {
    let on_streets: Vec<_> = homes
        .iter()
        .filter_map(|h| h.street.map(|s| (s, h.means)))
        .collect();
    let count = on_streets.len() as f64;
    if count < 2. {
        return None;
    }
    let mean = on_streets.iter().map(|(_, m)| m).sum::<f64>() / count;
    let whole: f64 = on_streets.iter().map(|(_, m)| (m - mean).powi(2)).sum();
    // hpc-exempt: a few dozen streets of one bench town.
    let mut streets = std::collections::BTreeMap::<usize, [f64; 2]>::new();
    for (street, means) in &on_streets {
        let entry = streets.entry(*street).or_default();
        entry[0] += 1.;
        entry[1] += means;
    }
    let between: f64 = streets
        .values()
        .map(|[homes, means]| homes * (means / homes - mean).powi(2))
        .sum();
    (whole > 1e-9).then(|| [between / whole, (streets.len() as f64 - 1.) / (count - 1.)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_founded_district_grows_round_by_round() {
        let started = std::time::Instant::now();
        let mut bench = Bench::district(Site::default()).unwrap();
        let founded = bench.town.holdings().len();
        assert!(founded > 0, "founding leaves a kernel");
        bench.rounds(6).unwrap();
        let homes = bench.homes().unwrap();
        eprintln!(
            "bench: {} holdings founded, {} after six rounds, {} homes, {:.0} m of street laid, {:.1} s",
            founded,
            bench.town.holdings().len(),
            homes.len(),
            bench.laid(),
            started.elapsed().as_secs_f64()
        );
        assert!(bench.town.holdings().len() > founded, "the rounds build");
        assert!(bench.laid() > 0., "the rounds lay streets");
    }

    /// A district of the usual order but for the terms `change` sets, after `rounds`.
    fn grown(rounds: usize, change: impl FnOnce(&mut Order)) -> Bench {
        let mut order = Order::default();
        change(&mut order);
        let mut bench = Bench::district(Site {
            order,
            ..Site::default()
        })
        .unwrap();
        bench.rounds(rounds).unwrap();
        bench
    }
    /// The share of `a`'s holdings that `b` has a holding of the same kind within five
    /// metres of.
    fn in_place(a: &Bench, b: &Bench) -> f64 {
        let near = |h: &crate::town::fabric::Holding| {
            b.town.holdings().iter().any(|other| {
                other.kind == h.kind
                    && crate::town::geometry::distance(other.slot.front, h.slot.front) < 5.
            })
        };
        let holdings = a.town.holdings();
        holdings.iter().filter(|h| near(h)).count() as f64 / holdings.len().max(1) as f64
    }

    /// The mean plot of the homes of `kind` label in a grown district.
    fn mean_plot(bench: &Bench, label: &str) -> f64 {
        let plots: Vec<_> = bench
            .homes()
            .unwrap()
            .into_iter()
            .filter(|home| home.kind.definition().label == label)
            .map(|home| home.plot)
            .collect();
        assert!(!plots.is_empty(), "no {label} was built");
        plots.iter().sum::<f64>() / plots.len() as f64
    }

    #[test]
    fn a_street_household_takes_a_larger_plot_where_the_order_offers_larger_plots() {
        let offered = |scale: f64| {
            grown(6, |order| {
                order.plot_frontage *= scale;
                order.plot_depth *= scale;
            })
        };
        let (small, large) = (offered(0.8), offered(1.3));
        // The same kind of home, built by the same rounds on the same ground: the offer
        // is 2.6 times the area, and the plots taken follow it most of the way.
        let ratio = mean_plot(&large, "street household") / mean_plot(&small, "street household");
        assert!(
            ratio > 1.4,
            "a street household's plot grew {ratio:.2} times"
        );
    }

    #[test]
    fn rich_and_poor_streets_part_where_the_order_settles_households_by_standing() {
        // How far the difference in homes' means lies between streets, beyond what chance
        // leaves between streets of these sizes.
        let beyond_chance = |deference: f64| {
            let bench = grown(8, |order| {
                order.wealth_spread = 2.;
                order.deference = deference;
            });
            let [between, chance] = apart(&bench.homes().unwrap()).unwrap();
            between - chance
        };
        let (deferring, usual) = (beyond_chance(3.), beyond_chance(1.));
        // With lots spread wide and nobody settled by standing, streets differ as chance
        // makes them. Settled by standing, they part.
        assert!(
            usual < 0.06,
            "streets part {usual:.2} beyond chance unsettled"
        );
        assert!(
            deferring > usual + 0.05,
            "settled by standing {deferring:.2}, unsettled {usual:.2}"
        );
    }

    /// Prints what single terms of a town's order do to the same district. Run with
    /// `cargo test -p atlas-generation --lib survey_of_order_terms -- --ignored --nocapture`.
    #[test]
    #[ignore = "a readout for a person, not a check"]
    fn survey_of_order_terms() {
        let usual = grown(8, |_| {});
        let line = |name: &str, bench: &Bench| {
            let homes = bench.homes().unwrap();
            eprintln!(
                "{name:28} holdings {:4} homes {:4} laid {:5.0} m  plot {:4.0} m2  apart {:?}  in place with usual {:.0}%",
                bench.town.holdings().len(),
                homes.len(),
                bench.laid(),
                Bench::median_plot(&homes),
                apart(&homes).map(|[between, chance]| format!("{between:.2} (chance {chance:.2})")),
                100. * in_place(bench, &usual)
            );
        };
        line("usual", &usual);
        line(
            "street spacing 61 (was 60)",
            &grown(8, |o| o.street_spacing = 61.),
        );
        line(
            "plots 1.3 times each way",
            &grown(8, |o| {
                o.plot_frontage *= 1.3;
                o.plot_depth *= 1.3;
            }),
        );
        line(
            "plots 0.8 times each way",
            &grown(8, |o| {
                o.plot_frontage *= 0.8;
                o.plot_depth *= 0.8;
            }),
        );
        line("spread 2", &grown(8, |o| o.wealth_spread = 2.));
        line(
            "spread 2, deference 3",
            &grown(8, |o| {
                o.wealth_spread = 2.;
                o.deference = 3.;
            }),
        );
        line(
            "clustering 2, satiety 0.5",
            &grown(8, |o| {
                o.clustering = 2.;
                o.satiety = 0.5;
            }),
        );
        line(
            "survey 3, worn 0.5",
            &grown(8, |o| {
                o.survey = 3.;
                o.worn = 0.5;
            }),
        );
    }

    /// Prints each kind of home with its count and plots under three plot offers. Run with
    /// `cargo test -p atlas-generation --lib survey_of_plots -- --ignored --nocapture`.
    #[test]
    #[ignore = "a readout for a person, not a check"]
    fn survey_of_plots() {
        for scale in [0.8, 1., 1.3] {
            let bench = grown(8, |o| {
                o.plot_frontage *= scale;
                o.plot_depth *= scale;
            });
            let homes = bench.homes().unwrap();
            // hpc-exempt: a handful of kinds of one bench town.
            let mut kinds = std::collections::BTreeMap::<&str, Vec<f64>>::new();
            for home in &homes {
                kinds
                    .entry(home.kind.definition().label)
                    .or_default()
                    .push(home.plot);
            }
            let total: f64 = homes.iter().map(|h| h.plot).sum();
            eprintln!(
                "plots {scale} times: {} homes on {:.0} m2, mean {:.0}",
                homes.len(),
                total,
                total / homes.len().max(1) as f64
            );
            for (kind, plots) in kinds {
                let mean = plots.iter().sum::<f64>() / plots.len() as f64;
                let least = plots.iter().copied().fold(f64::INFINITY, f64::min);
                let most = plots.iter().copied().fold(0., f64::max);
                eprintln!(
                    "    {kind:24} {:3}  mean {mean:5.0}  {least:5.0} to {most:5.0}",
                    plots.len()
                );
            }
        }
    }

    /// Prints what each civic order makes of the same district. Run with
    /// `cargo test -p atlas-generation --lib survey_of_civic_orders -- --ignored --nocapture`.
    #[test]
    #[ignore = "a readout for a person, not a check"]
    fn survey_of_civic_orders() {
        for civic in std::iter::once(None).chain(Civic::ALL.into_iter().map(Some)) {
            let started = std::time::Instant::now();
            let mut bench = Bench::district(Site {
                civic,
                ..Site::default()
            })
            .unwrap();
            bench.rounds(10).unwrap();
            let homes = bench.homes().unwrap();
            let mut means: Vec<_> = homes.iter().map(|h| h.means).collect();
            means.sort_by(f64::total_cmp);
            let at = |share: f64| {
                means
                    .get(((means.len().max(1) - 1) as f64 * share) as usize)
                    .copied()
                    .unwrap_or(0.)
            };
            eprintln!(
                "{:18} holdings {:4} homes {:4} laid {:5.0} m  plot {:4.0} m2  means {:.2}-{:.2}  apart {:?}  {:.1} s",
                civic.map_or("no order", Civic::name),
                bench.town.holdings().len(),
                homes.len(),
                bench.laid(),
                Bench::median_plot(&homes),
                at(0.1),
                at(0.9),
                apart(&homes).map(|[between, chance]| format!("{between:.2} (chance {chance:.2})")),
                started.elapsed().as_secs_f64()
            );
        }
    }
}
