//! Building: built ground follows the room people lack.
//!
//! Each pass, builders add a share of the ground the people of a cell still lack: freely on
//! open ground, and on working land where the people lacking room outweigh the people the
//! field feeds. Ground beyond what its people need goes out of use and back to the working
//! land round it. How much ground a household takes is settling's finding (`dwelling`): it
//! falls where ground is dear for the household's purse and rises where it is cheap. A
//! finer map inherits its parent's built share spread across each coarse cell; this is how
//! that share comes to stand where its people are. World history runs the same step over
//! the years of a pass (`Building::over_years`) and leaves emptied ground to neglect.
use super::{
    contract::MapType,
    land::Capital,
    questions::Questions,
    work::{habitable, km2, working, Work},
};
use crate::{
    execution::{CommandContext, ExecutionResult},
    field::{shared::Scalar, Field},
    human::{
        catalogue::LayerId,
        operations::{self, Convert, Lay},
        HumanField,
    },
    parameters::NumericParameter,
    storage::ReadBand,
    town::settings::STEEP_SLOPE,
};
use std::io;

#[derive(Clone, Copy)]
pub struct Building {
    /// The share of the ground still lacking that builders add in one pass.
    pub(super) pace: f64,
    /// How many people must lack room on a field, for each person it feeds, before half of
    /// it gives way to building.
    pub(super) farmland_resistance: f64,
    /// The share of the built ground nobody needs that goes out of use in one pass.
    pub(super) release: f64,
}
const STRATEGY: &str = "built-ground";
const PACE: NumericParameter = NumericParameter {
    name: "constructionPace",
    unit: "share of lacking ground per pass",
    default: 0.5,
    minimum: Some(0.),
    maximum: Some(1.),
    strategy: Some(STRATEGY),
    map_types: &[MapType::City, MapType::Region],
};
// Read on every map: World history takes fields for building as finer maps do.
const FARMLAND_RESISTANCE: NumericParameter = NumericParameter {
    name: "farmlandResistance",
    unit: "people lacking room per person fed",
    default: 1.,
    maximum: None,
    strategy: None,
    map_types: &[],
    ..PACE
};
const RELEASE: NumericParameter = NumericParameter {
    name: "idleGroundRelease",
    unit: "share of unneeded built ground per pass",
    ..PACE
};
pub(crate) const CONTROLS: &[NumericParameter] = &[PACE, FARMLAND_RESISTANCE, RELEASE];
impl Building {
    pub(super) const DEFAULT: Self = Self {
        pace: PACE.default,
        farmland_resistance: FARMLAND_RESISTANCE.default,
        release: RELEASE.default,
    };
    /// Building over the `years` of a World history pass: builders add the share of the
    /// lacking ground that a generation's building reaches in that time, and nothing is
    /// released, since ground people leave wears to ruin.
    pub(super) fn over_years(self, years: f64) -> Self {
        Self {
            pace: 1. - (-years.max(0.) / super::facts::BUILDING_YEARS).exp(),
            release: 0.,
            ..self
        }
    }
}
pub(crate) fn tune(
    mut strategy: Capital,
    input: &crate::atlas::dispatch::Input,
) -> io::Result<Capital> {
    use super::land::Investment;
    let building = Building {
        pace: input.number(PACE.name)?,
        farmland_resistance: input.number(FARMLAND_RESISTANCE.name)?,
        release: input.number(RELEASE.name)?,
    };
    strategy.algorithm = match strategy.algorithm {
        Investment::Historical(_) => Investment::Historical(building),
        Investment::Spatial(_) => Investment::Spatial(building),
    };
    Ok(strategy)
}

/// The share of a cell that can be built on: all of it up to half the slope nobody builds
/// on, none of it at that slope.
pub(super) fn buildable(slope: f64) -> f64 {
    (2. - 2. * slope.max(0.) / STEEP_SLOPE).clamp(0., 1.)
}
/// The share of working land that gives way to building: none where nobody lacks room, half
/// where the people lacking room equal `resistance` times the people the land feeds, and
/// nearly all of it under a crowd.
pub(super) fn giving_way(lacking: f64, fed: f64, resistance: f64) -> f64 {
    if lacking <= 0. {
        return 0.;
    }
    let hold = resistance.max(0.) * fed.max(0.);
    lacking / (lacking + hold)
}

/// One cell's ground as a pass finds it. People and the land's fed are per square
/// kilometre; the rest are shares of the cell.
pub(super) struct Ground {
    pub people: f64,
    pub built: f64,
    /// The people a built square kilometre holds here.
    pub held: f64,
    /// Ground lying open, under no use.
    pub open: f64,
    pub buildable: f64,
    pub fed: f64,
    /// How ready the people here are to build, from none to wholly.
    pub builders: f64,
}
/// What a pass does to one cell's built ground.
#[derive(Debug, PartialEq)]
pub(super) struct Change {
    pub added: f64,
    pub released: f64,
}
/// Builders add a share of the ground the cell's people lack, first on open ground and then
/// on working land as far as it gives way. Ground beyond what its people need goes out of
/// use at the release pace. People on ground that cannot be built further stay crowded.
pub(super) fn change(ground: &Ground, settings: &Building) -> Change {
    let needed = if ground.held > 0. {
        ground.people.max(0.) / ground.held
    } else {
        0.
    };
    let short = needed.min(ground.buildable.clamp(0., 1.)) - ground.built;
    if short > 0. {
        let giving = giving_way(
            ground.people - ground.built * ground.held,
            ground.fed,
            settings.farmland_resistance,
        );
        let on_open = short.min(ground.open.max(0.));
        let pace = settings.pace.clamp(0., 1.) * ground.builders.clamp(0., 1.);
        return Change {
            added: pace * (on_open + (short - on_open) * giving),
            released: 0.,
        };
    }
    Change {
        added: 0.,
        released: settings.release.clamp(0., 1.) * (ground.built - needed).max(0.),
    }
}

/// The people a built square kilometre holds at a cell: what settling found this pass, or
/// ordinary room as the district's households live where nobody has been placed yet.
pub(super) fn held(work: &Work, room: &ReadBand<f64>, cell: usize) -> io::Result<f64> {
    let found = work.held.get(cell)?;
    Ok(if found > 0. {
        found
    } else {
        room.get(cell)? * work.dwelling(cell)
    })
}

pub(super) fn develop(
    context: &mut CommandContext<'_, Field>,
    work: &Work,
    q: &Questions,
    owner: &operations::Operations<Field>,
    built: &ReadBand<f64>,
    settings: Building,
) -> ExecutionResult<()> {
    let room = context.query(&q.room)?.values();
    let builders = context.query(&q.building)?.values();
    let fed = context.query(&q.support)?.values();
    trace(context.state(), work, &room, "before building")?;
    let field = context.state();
    let slope = field.shared().scalar(Scalar::Slope);
    let farms = field.people.view(HumanField::Layer(LayerId::Farmland));
    let grazing = field.people.view(HumanField::Layer(LayerId::Pasture));
    let mut added = working(field);
    // Ground going out of use: to the fields and pasture round it, or to lie open.
    let mut returned = [working(field), working(field), working(field)];
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        let change = change(
            &Ground {
                people: field.people.people(cell)?,
                built: built.get(cell)?,
                held: held(work, &room, cell)?,
                open: field.people.free_area(cell)?,
                buildable: buildable(slope.get(cell)?),
                fed: fed.get(cell)?,
                builders: builders.get(cell)?,
            },
            &settings,
        );
        added.set(cell, change.added)?;
        if change.released > 0. {
            let (farm, pasture) = (farms.get(cell)?, grazing.get(cell)?);
            if farm + pasture > 0. {
                returned[0].set(cell, change.released * farm / (farm + pasture))?;
                returned[1].set(cell, change.released * pasture / (farm + pasture))?;
            } else {
                returned[2].set(cell, change.released)?;
            }
        }
    }
    super::land::occupy_land(context, owner, &added)?;
    let [to_fields, to_pasture, to_open] = returned;
    for (to, amount) in [
        (LayerId::Farmland, to_fields),
        (LayerId::Pasture, to_pasture),
    ] {
        context.run(
            &owner.convert,
            &Convert {
                from: LayerId::BuiltUp,
                to,
                amount: amount.read_only(),
            },
        )?;
    }
    context.run(
        &owner.withdraw,
        &Lay {
            kind: LayerId::BuiltUp,
            amount: to_open.read_only(),
        },
    )?;
    Ok(trace(context.state(), work, &room, "after building")?)
}

/// Where built ground stands against the people who need it, written to the server log when
/// `ATLAS_TRACE_PEOPLE` or `ATLAS_TRACE_CITY` is set: the built area, the area people need,
/// how much of the built area lies in nearly full and in thin cells, how many people live
/// on nearly full ground and how many beyond what the ground under them holds, the range
/// of people a built square kilometre holds where people live, the residents by how many
/// people stand on each built square kilometre under them, and the residents and built
/// ground inside standing walls and in looser, ordinary and tighter districts.
fn trace(field: &Field, work: &Work, room: &ReadBand<f64>, stage: &str) -> io::Result<()> {
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_none()
        && std::env::var_os("ATLAS_TRACE_CITY").is_none()
    {
        return Ok(());
    }
    let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
    let mut census = Census::default();
    for cell in 0..field.mesh.len() {
        let km2 = km2(field, cell);
        let stand = Stand {
            living: field.people.people(cell)? * km2,
            built: built.get(cell)? * km2,
            share: built.get(cell)?,
            holds: held(work, room, cell)?,
        };
        census.ground(&stand);
        census.crowding(&stand);
        census.setting(&stand, work.enclosed(cell), work.dwelling(cell));
    }
    eprintln!("{}", census.record(stage));
    Ok(())
}

/// One cell as the census reads it: its residents, its built square kilometres, the share
/// of it built and the people a built square kilometre of it holds.
struct Stand {
    living: f64,
    built: f64,
    share: f64,
    holds: f64,
}

/// Residents and the built square kilometres under them.
#[derive(Clone, Copy, Default)]
struct Settled {
    residents: f64,
    built: f64,
}
impl Settled {
    fn add(&mut self, stand: &Stand) {
        self.residents += stand.living;
        self.built += stand.built;
    }
    fn record(&self) -> serde_json::Value {
        serde_json::json!({"residents": self.residents.round(), "builtKm2": hundredths(self.built)})
    }
}

fn hundredths(value: f64) -> f64 {
    (value * 100.).round() / 100.
}

/// The upper limits of the bands of people standing on a built square kilometre.
const CROWDING_BANDS: [f64; 5] = [10_000., 20_000., 40_000., 80_000., f64::INFINITY];

#[derive(Default)]
struct Census {
    whole: Settled,
    full: Settled,
    thin_km2: f64,
    needed_km2: f64,
    beyond: f64,
    held: Option<(f64, f64)>,
    standing: [f64; 5],
    walled: Settled,
    /// Districts whose households live looser than ordinary, ordinary ground, and districts
    /// whose households live tighter.
    character: [Settled; 3],
}
impl Census {
    fn ground(&mut self, stand: &Stand) {
        self.whole.add(stand);
        if stand.share >= 0.9 {
            self.full.add(stand);
        } else if stand.share < 0.25 {
            self.thin_km2 += stand.built;
        }
    }
    fn crowding(&mut self, stand: &Stand) {
        if stand.living > 0. && stand.built > 0. {
            let density = stand.living / stand.built;
            let band = CROWDING_BANDS.iter().position(|&limit| density < limit);
            self.standing[band.unwrap_or(4)] += stand.living;
        }
        if stand.holds > 0. {
            self.needed_km2 += stand.living / stand.holds;
            self.beyond += (stand.living - stand.built * stand.holds).max(0.);
        }
        if stand.holds > 0. && stand.living > 0. {
            let (least, most) = self.held.unwrap_or((stand.holds, stand.holds));
            self.held = Some((least.min(stand.holds), most.max(stand.holds)));
        }
    }
    fn setting(&mut self, stand: &Stand, enclosed: f64, dwelling: f64) {
        if enclosed >= 0.5 {
            self.walled.add(stand);
        }
        let kind = if dwelling < 0.8 {
            0
        } else if dwelling > 1.25 {
            2
        } else {
            1
        };
        self.character[kind].add(stand);
    }
    fn record(&self, stage: &str) -> serde_json::Value {
        let (least, most) = self.held.unwrap_or((0., 0.));
        let [under10k, to20k, to40k, to80k, over80k] = self.standing.map(f64::round);
        let [looser, ordinary, tighter] = self.character.map(|settled| settled.record());
        serde_json::json!({"event": "people.built-ground", "stage": stage, "details": {
            "builtKm2": hundredths(self.whole.built),
            "neededKm2": hundredths(self.needed_km2),
            "builtInNearlyFullCellsKm2": hundredths(self.full.built),
            "builtInThinCellsKm2": hundredths(self.thin_km2),
            "residents": self.whole.residents.round(),
            "residentsOnNearlyFullGround": self.full.residents.round(),
            "residentsBeyondWhatTheirGroundHolds": self.beyond.round(),
            "peoplePerBuiltKm2Held": [least.round(), most.round()],
            "residentsByPeoplePerBuiltKm2": {
                "under10k": under10k, "10kTo20k": to20k, "20kTo40k": to40k,
                "40kTo80k": to80k, "over80k": over80k,
            },
            "insideWalls": self.walled.record(),
            "looserDistricts": looser,
            "ordinaryGround": ordinary,
            "tighterDistricts": tighter,
        }})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GROUND: Ground = Ground {
        people: 2_000.,
        built: 0.1,
        held: 8_000.,
        open: 1.,
        buildable: 1.,
        fed: 200.,
        builders: 1.,
    };
    const WHOLE: Building = Building {
        pace: 1.,
        farmland_resistance: 1.,
        release: 1.,
    };

    #[test]
    fn world_history_builds_a_generations_share_and_leaves_decay_to_neglect() {
        use crate::field::people::facts::BUILDING_YEARS;
        let generation = WHOLE.over_years(BUILDING_YEARS);
        assert!((generation.pace - (1. - (-1.0f64).exp())).abs() < 1e-12);
        assert_eq!(generation.release, 0.);
        assert_eq!(generation.farmland_resistance, WHOLE.farmland_resistance);
        assert_eq!(WHOLE.over_years(0.).pace, 0.);
        assert!(WHOLE.over_years(10. * BUILDING_YEARS).pace > 0.9999);
        // Ground its people have left stays until neglect wears it down.
        let emptied = Ground {
            people: 100.,
            built: 0.2,
            ..GROUND
        };
        assert_eq!(
            change(&emptied, &generation),
            Change {
                added: 0.,
                released: 0.
            }
        );
    }

    #[test]
    fn a_world_cell_builds_by_how_its_people_live_not_by_their_number_alone() {
        use crate::field::people::dwelling::{held, neighbours};
        let long = WHOLE.over_years(1e6);
        // What a wide cell builds for `people` per square kilometre with `purse`.
        let built = |people: f64, purse: f64| {
            let cell = Ground {
                people,
                built: 0.,
                held: held(8_000., neighbours(people), purse, 1., 0.2),
                ..GROUND
            };
            change(&cell, &long).added
        };
        // Ten times the people take less than ten times the ground: they live closer.
        assert!(built(400., 1.) > built(40., 1.));
        assert!(built(400., 1.) < 10. * built(40., 1.));
        // The same people with a fuller purse take more ground.
        assert!(built(400., 3.) > built(400., 1.));
        // Fields in the way hold building back, and people unready to build add none.
        let farmed = |builders: f64| {
            let cell = Ground {
                people: 400.,
                built: 0.,
                held: held(8_000., neighbours(400.), 1., 1., 0.2),
                open: 0.,
                builders,
                ..GROUND
            };
            change(&cell, &long).added
        };
        assert!(farmed(1.) > 0. && farmed(1.) < built(400., 1.));
        assert_eq!(farmed(0.), 0.);
        // Without thrift ground follows the count alone.
        let plain =
            |people: f64, purse: f64| people / held(8_000., neighbours(people), purse, 1., 0.);
        assert!((plain(400., 3.) - 10. * plain(40., 1.)).abs() < 1e-12);
    }

    #[test]
    fn builders_add_the_ground_people_lack_and_no_more() {
        // Two thousand people need a quarter of the cell where a square kilometre holds
        // eight thousand; a tenth stands.
        assert!((change(&GROUND, &WHOLE).added - 0.15).abs() < 1e-12);
        // Half the pace adds half of it, and people unready to build add none.
        let half = Building { pace: 0.5, ..WHOLE };
        assert!((change(&GROUND, &half).added - 0.075).abs() < 1e-12);
        let idle = Ground {
            builders: 0.,
            ..GROUND
        };
        assert_eq!(change(&idle, &WHOLE).added, 0.);
        // Households that live closer need less ground.
        let close = Ground {
            held: 20_000.,
            ..GROUND
        };
        assert_eq!(change(&close, &WHOLE).added, 0.);
    }

    #[test]
    fn ground_nobody_needs_goes_out_of_use() {
        let emptied = Ground {
            people: 400.,
            built: 0.3,
            ..GROUND
        };
        // Four hundred people keep a twentieth; the rest of the three tenths goes.
        let all = change(&emptied, &WHOLE);
        assert_eq!(all.added, 0.);
        assert!((all.released - 0.25).abs() < 1e-12);
        let slow = Building {
            release: 0.2,
            ..WHOLE
        };
        assert!((change(&emptied, &slow).released - 0.05).abs() < 1e-12);
    }

    #[test]
    fn a_crowd_on_ground_that_cannot_be_built_further_keeps_what_stands() {
        let steep = Ground {
            people: 6_000.,
            built: 0.6,
            buildable: 0.4,
            ..GROUND
        };
        assert_eq!(
            change(&steep, &WHOLE),
            Change {
                added: 0.,
                released: 0.
            }
        );
    }

    #[test]
    fn a_field_gives_way_only_to_people_who_lack_room() {
        assert_eq!(giving_way(0., 200., 1.), 0.);
        assert_eq!(giving_way(200., 200., 1.), 0.5);
        assert!(giving_way(6_000., 200., 1.) > 0.95);
        // A fertile field holds out longer, and a stronger hold longer still.
        assert!(giving_way(200., 400., 1.) < giving_way(200., 200., 1.));
        assert!(giving_way(200., 200., 3.) < giving_way(200., 200., 1.));
        // With no open ground, builders take the field only as far as it gives way.
        let farmed = Ground { open: 0., ..GROUND };
        let lacking = 2_000. - 0.1 * 8_000.;
        assert!(
            (change(&farmed, &WHOLE).added - 0.15 * giving_way(lacking, 200., 1.)).abs() < 1e-12
        );
    }

    #[test]
    fn steep_ground_cannot_be_built_on() {
        assert_eq!(buildable(0.), 1.);
        assert_eq!(buildable(0.5 * STEEP_SLOPE), 1.);
        assert!((0.4..0.6).contains(&buildable(0.75 * STEEP_SLOPE)));
        assert_eq!(buildable(STEEP_SLOPE), 0.);
    }
}
