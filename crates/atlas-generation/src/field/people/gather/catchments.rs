//! Locate a coarse census among reachable homes on fine ground.
use crate::{
    field::{
        people::{
            growth::Guidance,
            work::{habitable, km2, Work},
        },
        refinement::people::CensusCell,
        Field,
    },
    hpc::{Direction, KeyedHeap},
    human::operations::HouseholdTransfers,
    storage::ReadBand,
    town::geometry::distance,
};
use std::io;

pub(super) struct Site {
    pub position: [f64; 2],
    pub census: CensusCell,
    pub inherited: f64,
    pub residents: f64,
    /// The households the site can take, weighted by how good its location is.
    pub places: f64,
    pub dry: bool,
    pub ways: smallvec::SmallVec<[(usize, f64); 4]>,
}

/// What household placement reads of each cell beside its ways.
pub(super) struct Settling<'a> {
    /// Each cell's worth to households and the people its built ground holds.
    pub ground: &'a crate::field::people::dwelling::Ground,
    /// The people per square kilometre the cell's own land feeds.
    pub fed: &'a ReadBand<f64>,
    pub settings: super::PlacementSettings,
}

/// The households a square kilometre can take. Its built ground holds the people who live
/// there as tightly as its ground costs and their purse allows, open ground beside built
/// ground counts for the share builders can add, and the land's own households weigh in
/// whatever stands on it. All of them are worth more the better the location.
pub(super) fn places(
    built: f64,
    beside: f64,
    held: f64,
    fed: f64,
    worth: f64,
    settings: &super::PlacementSettings,
) -> f64 {
    let built = built.clamp(0., 1.);
    let housed = (built + settings.edge_growth * beside.clamp(0., 1.) * (1. - built)) * held;
    (housed + settings.land_hold * fed.max(0.)) * worth
}

// owner-direction(2026-11-27): physically and socially motivated processes create built ground as a numeric field, the way ice coverage, rivers and population migration are created, with no simple formula equating people to built ground
pub(super) fn sites(
    field: &Field,
    work: &Work,
    city: &Guidance,
    residents: &ReadBand<f64>,
    settling: &Settling<'_>,
) -> io::Result<Vec<Site>> {
    let mesh = field.mesh();
    let [ox, oy] = mesh.origin();
    let built = field.people().view(crate::human::HumanField::Layer(
        crate::human::catalogue::LayerId::BuiltUp,
    ));
    let mut sites = Vec::with_capacity(mesh.len());
    for c in 0..mesh.len() {
        let area = km2(field, c);
        let people = residents.get(c)?;
        let inherited = city.census[c].density;
        let share = built.get(c)?;
        let mut beside = share;
        let mut ways = smallvec::SmallVec::new();
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(c, edge) {
                beside = beside.max(built.get(next)?);
                let passage = super::step_passed(work, c, edge)?;
                if passage > 0. {
                    ways.push((next, mesh.edge_length(c, edge) / passage));
                }
            }
        }
        let [x, y] = mesh.position(c);
        sites.push(Site {
            position: [ox + x, oy + y],
            census: city.census[c],
            inherited: inherited * area,
            residents: people * area,
            places: if city.weight[c] > 0. {
                area * places(
                    share,
                    beside,
                    settling.ground.held.get(c)?,
                    settling.fed.get(c)?,
                    settling.ground.worth.get(c)?,
                    &settling.settings,
                )
            } else {
                0.
            },
            dry: habitable(field, c)?,
            ways,
        });
    }
    for link in &work.going.linked {
        if link.passed > 0. {
            let cost = mesh.physical_distance(link.a, link.b) / link.passed;
            sites[link.a].ways.push((link.b, cost));
            sites[link.b].ways.push((link.a, cost));
        }
    }
    Ok(sites)
}

// owner-direction(2026-11-25): distribute census households across overlapping catchments according to usable ground and access to livelihoods.
pub(super) fn placement(
    sites: &[Site],
    settings: super::PlacementSettings,
) -> Vec<HouseholdTransfers> {
    let mut target = vec![0.; sites.len()];
    let mut seen = vec![false; sites.len()];
    let mut dist = vec![f64::INFINITY; sites.len()];
    let mut catchments = Vec::new();
    for (i, site) in sites.iter().enumerate() {
        if !seen[i] && site.dry {
            let source = connected_donor(sites, i, &mut seen);
            catchments.push(locate_census(
                sites,
                &source,
                &mut dist,
                &mut target,
                settings,
            ));
        }
    }
    let mut present: Vec<_> = sites.iter().map(|s| s.residents).collect();
    catchments
        .into_iter()
        .filter_map(|members| place_available(members, &target, &mut present))
        .collect()
}

/// Separate disconnected parts of one parent cell before offering its households places.
fn connected_donor(sites: &[Site], i: usize, seen: &mut [bool]) -> Vec<usize> {
    let site = &sites[i];
    let mut source = vec![i];
    seen[i] = true;
    let mut at = 0;
    while at < source.len() {
        for &(b, _) in &sites[source[at]].ways {
            if !seen[b] && sites[b].dry && sites[b].census.id == site.census.id {
                seen[b] = true;
                source.push(b);
            }
        }
        at += 1;
    }
    source
}

fn locate_census(
    sites: &[Site],
    source: &[usize],
    dist: &mut [f64],
    target: &mut [f64],
    settings: super::PlacementSettings,
) -> Vec<usize> {
    let site = &sites[source[0]];
    let census = source.iter().map(|&c| sites[c].inherited).sum::<f64>();
    let reach = settings.catchment_spans * site.census.span.max(1.);
    let members = accessible(sites, source, dist, reach);
    let weight = |c: usize| {
        sites[c].places
            * (1. - (dist[c] / reach).powi(2))
                .max(0.)
                .powf(settings.catchment_falloff)
    };
    let room = members.iter().map(|&c| weight(c)).sum::<f64>();
    if room > 0. {
        for &c in &members {
            target[c] += census * weight(c) / room;
        }
    } else {
        for &c in source {
            target[c] += sites[c].inherited;
        }
    }
    for &c in &members {
        dist[c] = f64::INFINITY;
    }
    members
}

fn accessible(sites: &[Site], source: &[usize], dist: &mut [f64], reach: f64) -> Vec<usize> {
    let centre = sites[source[0]].census.centre;
    let mut members = Vec::new();
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for &c in source {
        dist[c] = distance(sites[c].position, centre);
        members.push(c);
        queue.push(c as u32, [dist[c]]);
    }
    while let Some((c, [d])) = queue.pop() {
        let c = c as usize;
        if d != dist[c] {
            continue;
        }
        for &(b, cost) in &sites[c].ways {
            let offer = d + cost;
            if !(sites[b].dry && offer < reach && offer < dist[b]) {
                continue;
            }
            if !dist[b].is_finite() {
                members.push(b);
            }
            dist[b] = offer;
            queue.push(b as u32, [offer]);
        }
    }
    members
}

/// Only reassign surplus households. Repeated rounds can respond to a new road
/// while keeping the inherited census as the supply behind each catchment.
fn place_available(
    members: Vec<usize>,
    target: &[f64],
    present: &mut [f64],
) -> Option<HouseholdTransfers> {
    let mut sources = Vec::new();
    let mut receivers = Vec::new();
    for c in members {
        let difference = present[c] - target[c];
        if difference > 1e-9 {
            sources.push((c, difference));
        }
        if difference < -1e-9 {
            receivers.push((c, -difference));
        }
    }
    let supply = sources.iter().map(|(_, q)| q).sum::<f64>();
    let demand = receivers.iter().map(|(_, q)| q).sum::<f64>();
    let placed = supply.min(demand);
    if placed <= 0. {
        return None;
    }
    for (c, q) in &mut sources {
        let give = *q * placed / supply;
        *q = (give / present[*c]).min(1.);
        present[*c] -= give;
    }
    for (c, q) in &mut receivers {
        *q /= demand;
        present[*c] += placed * *q;
    }
    Some(HouseholdTransfers { sources, receivers })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_accessible_destination_draws_from_both_census_areas_but_not_across_open_water() {
        let sites = catchment_sites();
        let mut after: Vec<_> = sites.iter().map(|s| s.residents).collect();
        for p in placement(&sites, super::super::DEFAULT_PLACEMENT) {
            let mut pool = 0.;
            for (c, share) in p.sources {
                let offer = share * after[c];
                after[c] -= offer;
                pool += offer;
            }
            for (c, share) in p.receivers {
                after[c] += share * pool;
            }
        }
        assert!(after[2] > after[1] && after[2] > after[3]);
        assert!(after[0] < sites[0].residents);
        assert_eq!(after[4..], [0., 200.]);
    }

    /// A row of square-kilometre cells with one census spread evenly over them, a market at
    /// the middle and a thin share of built ground everywhere.
    struct Row {
        residents: Vec<f64>,
        built: Vec<f64>,
        /// How each cell's district has its households live, what its households can pay,
        /// and how many walls enclose it.
        character: Vec<f64>,
        purse: Vec<f64>,
        enclosed: Vec<f64>,
        /// The people a built square kilometre held at each cell in the last pass.
        held: Vec<f64>,
        settings: super::super::PlacementSettings,
        building: crate::field::people::building::Building,
    }
    const ROOM: f64 = 8_000.;
    const FED: f64 = 200.;
    impl Row {
        fn new() -> Self {
            Self {
                residents: vec![4_000.; 9],
                built: vec![0.15; 9],
                character: vec![1.; 9],
                purse: vec![1.; 9],
                enclosed: vec![0.; 9],
                held: vec![ROOM; 9],
                // The row states its own settings so retuning a default leaves it unchanged.
                settings: super::super::PlacementSettings {
                    location_draw: 3.,
                    ground_thrift: 0.2,
                    wall_premium: 0.5,
                    edge_growth: 0.05,
                    land_hold: 0.5,
                    ..super::super::DEFAULT_PLACEMENT
                },
                building: crate::field::people::building::Building {
                    pace: 0.5,
                    farmland_resistance: 1.,
                    release: 0.5,
                },
            }
        }
        fn opportunity(cell: usize) -> f64 {
            10_000. / (1. + (cell as f64 - 4.).powi(2))
        }
        /// Households settle where built ground has room, then builders add a share of the
        /// ground still lacking and ground nobody needs goes out of use.
        fn pass(&mut self) {
            use crate::field::people::{building, dwelling};
            let n = self.built.len();
            let worth: Vec<_> = (0..n)
                .map(|c| dwelling::worth(Self::opportunity(c), self.enclosed[c], &self.settings))
                .collect();
            self.held = (0..n)
                .map(|c| {
                    dwelling::held(
                        ROOM,
                        // Each cell is wider than a walk, so its neighbours are its own.
                        dwelling::neighbours(self.residents[c]),
                        self.purse[c],
                        self.character[c],
                        self.settings.ground_thrift,
                    )
                })
                .collect();
            let sites: Vec<_> = (0..n)
                .map(|c| {
                    let beside = [c.wrapping_sub(1), c, c + 1]
                        .into_iter()
                        .filter_map(|i| self.built.get(i))
                        .fold(0., |a: f64, b| a.max(*b));
                    let mut ways = smallvec::SmallVec::new();
                    if c > 0 {
                        ways.push((c - 1, 1.));
                    }
                    if c + 1 < n {
                        ways.push((c + 1, 1.));
                    }
                    Site {
                        position: [c as f64, 0.],
                        census: CensusCell {
                            id: 0,
                            centre: [4., 0.],
                            span: 1_000.,
                            density: 4_000.,
                        },
                        inherited: 4_000.,
                        residents: self.residents[c],
                        places: places(
                            self.built[c],
                            beside,
                            self.held[c],
                            FED,
                            worth[c],
                            &self.settings,
                        ),
                        dry: true,
                        ways,
                    }
                })
                .collect();
            for p in placement(&sites, self.settings) {
                let mut pool = 0.;
                for (c, share) in p.sources {
                    let offer = share * self.residents[c];
                    self.residents[c] -= offer;
                    pool += offer;
                }
                for (c, share) in p.receivers {
                    self.residents[c] += share * pool;
                }
            }
            for c in 0..n {
                let change = building::change(
                    &building::Ground {
                        people: self.residents[c],
                        built: self.built[c],
                        held: self.held[c],
                        // Everything unbuilt is under the plough.
                        open: 0.,
                        buildable: 1.,
                        fed: FED,
                        builders: 1.,
                    },
                    &self.building,
                );
                self.built[c] += change.added - change.released;
            }
        }
        fn settled(mut self) -> Self {
            for _ in 0..9 {
                self.pass();
            }
            self
        }
        /// People on each built square kilometre of a cell.
        fn density(&self, cell: usize) -> f64 {
            self.residents[cell] / self.built[cell]
        }
        fn ground(&self) -> f64 {
            self.built.iter().sum()
        }
    }

    #[test]
    fn good_ground_fills_and_crowds_while_poor_ground_empties_and_gives_up_its_built_share() {
        let row = Row::new().settled();
        // The market cell fills and holds more than a village's room; the cells beside it
        // are built further than they began.
        assert!(row.built[4] > 0.9 && row.built[3] > 0.15);
        assert!(row.residents[4] > ROOM);
        // The far cells keep few people and give up most of the built share they started with.
        assert!(row.residents[0] < 1_000.);
        assert!(row.built[0] < 0.1);
        // People stand closer toward the market: dearer ground, and more of them after it.
        assert!(row.density(4) > row.density(3) && row.density(3) > row.density(0));
    }

    #[test]
    fn idle_ground_stays_where_nothing_takes_it_out_of_use() {
        let mut kept = Row::new();
        kept.building.release = 0.;
        let kept = kept.settled();
        let released = Row::new().settled();
        assert!(kept.built[0] >= 0.15);
        assert!(released.built[0] < kept.built[0]);
        assert!(released.ground() < kept.ground());
    }

    #[test]
    fn a_districts_character_changes_how_many_people_its_ground_holds() {
        let ordinary = Row::new().settled();
        let mut tenements = Row::new();
        tenements.character[3..=5].fill(2.5);
        let tenements = tenements.settled();
        let mut estates = Row::new();
        estates.character[3..=5].fill(0.35);
        let estates = estates.settled();
        assert!(tenements.density(4) > 1.5 * ordinary.density(4));
        assert!(estates.density(4) < 0.6 * ordinary.density(4));
        // The same people need less ground as tenements and more as estates, and estates
        // still fill the ground they take.
        assert!(tenements.ground() < ordinary.ground() && ordinary.ground() < estates.ground());
        assert!(estates.built[4] > 0.99);
    }

    #[test]
    fn a_full_purse_spreads_over_more_ground_and_dear_ground_is_lived_on_more_closely() {
        let ordinary = Row::new().settled();
        let mut rich = Row::new();
        rich.purse[3..=5].fill(4.);
        let rich = rich.settled();
        // The same market ground holds fewer people where its households can pay for more.
        assert!(rich.density(4) < ordinary.density(4));
        assert!(rich.ground() > ordinary.ground());
        // Without thrift neither price nor purse changes how people live.
        let mut thriftless = Row::new();
        thriftless.settings.ground_thrift = 0.;
        thriftless.purse[3..=5].fill(4.);
        thriftless.pass();
        assert!(thriftless.held.iter().all(|&held| held == ROOM));
    }

    #[test]
    fn a_wall_draws_households_inside_it() {
        let open = Row::new().settled();
        let mut walled = Row::new();
        walled.enclosed[5] = 1.;
        let walled = walled.settled();
        assert!(walled.residents[5] > 1.1 * open.residents[5]);
        assert!(walled.density(5) > open.density(5));
    }

    #[test]
    fn without_a_location_draw_no_ground_is_worth_crowding() {
        let mut even = Row::new();
        even.settings.location_draw = 0.;
        let even = even.settled();
        // Every cell has the same room and the same hold, so people stay spread.
        assert!((even.residents[4] - even.residents[0]).abs() < 1.);
        assert!(even.built[4] < 0.6);
    }

    fn catchment_sites() -> Vec<Site> {
        let mut sites = Vec::new();
        for (i, inherited) in [90., 90., 10., 10., 0., 200.].into_iter().enumerate() {
            let id = usize::from(i >= 2);
            let mut ways = smallvec::SmallVec::new();
            if i > 0 {
                ways.push((i - 1, 1.));
            }
            if i < 5 {
                ways.push((i + 1, 1.));
            }
            sites.push(Site {
                position: [i as f64, 0.],
                census: CensusCell {
                    id,
                    centre: [if id == 0 { 0.5 } else { 2.5 }, 0.],
                    span: 2.,
                    density: inherited,
                },
                inherited,
                residents: inherited,
                places: if i == 2 { 6. } else { 2. },
                dry: i != 4,
                ways,
            });
        }
        sites
    }
}
