//! City walls are walked into being. In each era the town's record tells of, and in each
//! round of the present one, a town takes one of the edges of its built body to wall and
//! its builders work along it. A builder takes the wall up where its line was left
//! loose; where none is, it sets out on edge with none of the town's wall in sight and
//! carries a wall both ways from there. It looks a few steps ahead, and stops where it
//! joins its town's own wall, where water too wide to cross lies ahead, or when the
//! work the era gives is spent. A wall begun keeps the line it was begun on through the
//! rounds that follow. Wall of earlier eras falls in patches that shift from era to era,
//! sooner where built ground presses on it; later builders are drawn onto old lines that
//! lie near their own and take what still stands into their wall.
//!
//! Chance enters where an era draws the edges its town weighs and which of them it
//! takes, how each era's town leaned, where and which way each builder sets out, how
//! the era's line sways inside the edge here and outside it there, the small whims of
//! each step, how threatened each era was and in which year today's builders begin, and
//! which stretches wear takes.
//!
//! Nothing here names a kind of wall. A circuit, an arc open to one side, an old wall
//! deep inside a later one, a stump, a ruin and no wall at all are what the walks and
//! the wear leave behind for different towns, histories and rolls. The pattern is
//! `crate::chance::examples`.
use super::{
    fields::{neighborhood, policy, position, CityFields},
    Urban,
};
use crate::{
    atlas::{regional::city::captured_settlement, state::State},
    chance::{best, Chance, Front, Noise, Patches, Stride, Walker, Whims},
    field::{people::work::habitable, refinement::courses::cell_at, shared::Scalar},
    lattice::TriangularLattice,
    town::{
        geometry::distance,
        walls::{self, enclosure_value, LooseEnd, Section, Wall},
    },
};
use std::io;

pub(super) use crate::town::walls::READINESS;

/// The turns a builder may take at each step, in radians off its heading, and the sharp
/// turns it tries where every one of those is shut.
const FAN: [f64; 5] = [-0.65, -0.325, 0.0, 0.325, 0.65];
const SHARP: [f64; 4] = [-1.2, 1.2, -1.9, 1.9];
/// The least built share at which ground counts as the town's own.
const BUILT: f64 = 0.1;
/// How many cells either side of the town's edge a builder may stray, and how many
/// cells off a builder sees wall already laid: a little further, so wall anywhere
/// across the ribbon is in sight from the edge.
const RIBBON: i8 = 3;
const SIGHT: i8 = RIBBON + 2;
/// The most builders who set out in one era, or one round of the present era.
const BUILDERS: usize = 24;
/// How many of the sections a builder laid last this way are still its own work in
/// hand: it does not take them for wall it has come upon. They reach far enough back
/// that a builder rounding the tip of a finger of town does not take the other side of
/// the finger for the end of its work. And how many sections laid before it, where it
/// began, it likewise passes by on its first steps.
const OWN: usize = 40;
const FRESH: usize = 10;
/// How many cells off a builder meets its own town's wall: the ribbon's half width.
/// Builders of one era steer for the same line and are drawn to wall in sight, so two
/// stretches come this near before they could pass side by side.
const MEET: i8 = RIBBON;
/// How strongly the ground a few steps on keeps a builder to its line along the town's
/// edge, beside holding its heading. A cell off the line there outweighs the sharpest
/// turn of its fan, so a builder steers for the line; steering early, it seldom has to
/// turn hard.
const HOLD: f64 = 2.5;
/// How many steps on a builder looks when it judges a step, and how much less a way is
/// worth for each of those steps it cannot see along the ribbon.
const LOOK: u8 = 3;
const BLIND: f64 = 1.5;
/// A builder has turned back on itself when its heading swings by more than this, in
/// radians, within this many steps: most of a full turn. The tip of a finger of town
/// turns a wall half round; only a builder that has lost the edge goes further.
const TURN: f64 = 4.4;
const TURN_STEPS: usize = 12;
/// How many times longer someone takes over water, or ground too steep for a wall, than
/// over firm ground.
const WADE: f64 = 12.;
/// How many edges an era's town weighs before it walls one.
const EDGES: usize = 4;
/// The work of taking a length of an earlier era's standing wall into a new line, as a
/// share of the work of laying that length new.
const MAKE_GOOD: f64 = 0.1;
/// How many times the work wall takes over a stream or a steep bank, and how much less
/// a step onto one is worth to a builder than a step on firm ground: it goes over where
/// it must, by the shortest way.
const OVER_WATER: f64 = 3.;
const WET: f64 = 2.;
/// How far, in cells, a wall's line sways off the town's edge, in or out, and over how
/// many cells one sway runs. The sway is the era's own, so one era's builders agree on
/// the line and another era's take a different one round the same town.
const SWAY: f64 = 2.;
const SWAY_RUN: f64 = 8.;
/// What wall already laid is worth to a builder choosing its next step: the full worth
/// on the wall, less with every cell off it.
const FOLLOW: f64 = 4.;
/// How much chance counts in a builder's choice of turn, and how far its heading drifts
/// at each step, in radians. A builder's chance holds for six steps, so its drift
/// carries it through a slow bend and not a knot.
const WHIM: f64 = 0.12;
const DRIFT: f64 = 0.04;
/// How much the side an era's threat came from counts in where a builder sets out.
const FACING: f64 = 1.5;
/// How lopsided an earlier era's town was: how far chance tilts the ground it favoured.
/// Today's town is read as it stands, tilted a little: which of its quarters carry the
/// most weight when the wall is planned is the era's own.
const LEAN: f64 = 0.6;
const LEAN_TODAY: f64 = 0.25;
/// The share of an edge's whole work below which an era does not begin a wall.
const LEAST: f64 = 0.04;
/// The wall work one supporter gives in a year, in metres of plain wall.
const YEAR_WORK: f64 = 0.005;
/// The years of one era's wear; the rounds of a city map together stand for about one.
const ERA_YEARS: f64 = 330.;
/// The breadth of the patches wall falls in, in metres.
const WEAR_PATCH: f64 = 260.;

/// What a wall's builders read of the city in one round. The map gathers it from its
/// fields; a test builds it from constructed ground.
pub(super) struct City<'a> {
    pub mesh: &'a TriangularLattice,
    pub fields: &'a CityFields,
    /// Standing works at each cell, a square kilometre.
    pub capital: &'a [f64],
    /// Ground that can carry a wall: dry and not too steep.
    pub firm: &'a [bool],
    /// This round, counted from one.
    pub round: usize,
    /// The years each round stands for.
    pub rounds: &'a [f64],
}

/// A town's record as its wall builders read it.
#[derive(Clone, Debug)]
pub(super) struct Sponsors {
    /// Each recorded era's name and townsfolk, oldest first; the last is the present.
    pub eras: Vec<(String, f64)>,
    /// The weight of the causes that move the town to defend itself in any era: its
    /// site, its standing and its civic order.
    pub resolve: f64,
    /// Their weight in the present era, when a contest for the town counts too.
    pub present: f64,
    /// How tight a core the civic order's walls enclose.
    pub citadel: f64,
    /// The settlement's roll, from which every draw for its walls is dealt.
    pub fortune: f64,
    /// How much of its part chance plays: one in every map, nought to still it.
    pub wildness: f64,
}
impl Sponsors {
    /// The present era's place in the record.
    fn last(&self) -> usize {
        self.eras.len().saturating_sub(1)
    }
    fn chance(&self, purpose: &str) -> Chance {
        Chance::named((self.fortune * f64::from(i32::MAX)) as i32, purpose)
    }
    /// How threatened `era` left the town: nothing while it had no townsfolk, otherwise
    /// the weight of its causes scaled by a wait drawn for the era.
    fn threat(&self, era: usize) -> f64 {
        if self
            .eras
            .get(era)
            .is_some_and(|(_, townsfolk)| *townsfolk <= 0.)
        {
            return 0.;
        }
        let causes = if era >= self.last() {
            self.present
        } else {
            self.resolve
        };
        let wait = self.chance("city.wall.threat").wait([era as f64, 0.], 1.);
        walls::threat(causes, 1. + (wait - 1.) * self.wildness)
    }
    /// The side an era's threat came from, as a heading from the town's middle.
    fn bearing(&self, era: usize) -> f64 {
        self.chance("city.wall.bearing").angle([era as f64, 0.])
    }
    /// The era's town beside today's: its townsfolk as a share of today's.
    fn share(&self, era: usize) -> f64 {
        let today = self.eras.last().map_or(0., |(_, townsfolk)| *townsfolk);
        if today <= 0. {
            return 0.;
        }
        (self.eras[era].1 / today).clamp(0., 1.)
    }
    /// The round in which the present era's builders first set out: the era's chance
    /// falls on one of the years the rounds stand for.
    fn begins(&self, rounds: &[f64]) -> usize {
        let draw = self
            .chance("city.wall.begins")
            .unit([self.last() as f64, 0.]);
        let mut year = draw * self.wildness * rounds.iter().sum::<f64>();
        for (index, years) in rounds.iter().enumerate() {
            if year < *years {
                return index + 1;
            }
            year -= years;
        }
        rounds.len().max(1)
    }
}

/// What the city can give its walls: how firmly each cell is occupied, how many stand
/// behind the work, and the standing stock that can be turned to it, in metres of plain
/// wall.
struct Means {
    occupied: Vec<f64>,
    supporters: f64,
    capacity: f64,
}
fn means(city: &City) -> Means {
    let mesh = city.mesh;
    let mut occupied = Vec::with_capacity(mesh.len());
    let (mut supporters, mut capital) = (0., 0.);
    for (c, x) in city.fields.claims.iter().enumerate() {
        let area_km = mesh.area(c) / 1e6;
        let share = city.fields.stencil[c];
        supporters += x.people * share * area_km;
        capital += city.capital[c] * share * area_km;
        occupied.push(
            share
                * (x.people.max(0.) / 500.).ln_1p()
                * (0.45
                    + x.built.sqrt()
                    + 0.35 * city.fields.developed[c]
                    + 0.25 * city.fields.civic[c]
                    + 0.25 * city.fields.access[c]),
        );
    }
    Means {
        occupied,
        supporters,
        capacity: capital / (crate::human::catalogue::FULL_STANDING_PER_BUILT_KM2 * 8. / 1e6)
            * 0.15,
    }
}

/// One spell of building: an earlier era's, or one round of the present era's.
struct Season<'a> {
    era: usize,
    name: Option<&'a str>,
    /// The round it belongs to; nought for an earlier era.
    round: usize,
    /// The town of the season beside today's, by townsfolk.
    share: f64,
}
impl Season<'_> {
    fn past(&self) -> bool {
        self.round == 0
    }
}

/// How firmly ground is occupied about each cell, read over `reach`.
fn pressure(city: &City, occupied: &[f64], reach: f64) -> Vec<f64> {
    (0..city.mesh.len())
        .map(|c| neighborhood(city.mesh, [occupied], c, reach)[0])
        .collect()
}
/// Whether a cell is the town's ground: the city's own, with buildings on it.
fn towns(city: &City, cell: usize) -> bool {
    city.fields.stencil[cell] > 0.5 && city.fields.claims[cell].built > BUILT
}
/// The town's cells, the least pressed first.
fn ranked(city: &City, pressure: &[f64]) -> io::Result<Vec<usize>> {
    let cells: Vec<_> = (0..pressure.len()).filter(|&c| towns(city, c)).collect();
    let values: Vec<_> = cells.iter().map(|&c| pressure[c]).collect();
    let order = crate::hpc::radix_order(
        &[crate::hpc::NumericKey::Float(&values)],
        crate::hpc::Direction::Ascending,
    )
    .map_err(io::Error::other)?;
    Ok(order.into_iter().map(|at| cells[at]).collect())
}
/// How many of the least pressed of the town's cells lay outside a town with `share` of
/// today's people: the town stood on as great a share of today's built ground, the most
/// pressed of it.
fn outside(ranked: &[usize], share: f64) -> usize {
    let within = (ranked.len() as f64 * share.clamp(0., 1.)).round() as usize;
    ranked.len() - within.min(ranked.len())
}

/// The ground a season's town stood on, as its builders read it: how firmly each cell
/// is pressed, the cells of today's town in that order, where among them the season's
/// town begins, and the town's most pressed place.
struct Ground {
    pressure: Vec<f64>,
    ranked: Vec<usize>,
    from: usize,
    peak: [f64; 2],
}
impl Ground {
    /// Today's town is the city's built ground as it stands. An earlier era's town stood
    /// on the most pressed share of that ground equal to its share of today's people,
    /// read at its own grain, and it did not grow evenly: a many-scaled field of its own
    /// tilts which ground it favoured, so each era's town leans its own way. Today's
    /// town is tilted a little by the same means.
    fn of(city: &City, occupied: &[f64], sponsors: &Sponsors, season: &Season) -> io::Result<Self> {
        let mesh = city.mesh;
        let reach = |area: f64| (area.sqrt() * 0.055).max(2. * mesh.spacing());
        let built = (0..mesh.len()).filter(|&c| towns(city, c)).count() as f64 * mesh.area(0);
        let lean = sponsors
            .chance("city.wall.lean")
            .nth(season.era as i32)
            .noise((built * season.share).sqrt().max(mesh.spacing()), 3);
        let tilt = sponsors.wildness * if season.past() { LEAN } else { LEAN_TODAY };
        let read = |reach: f64| -> Vec<f64> {
            pressure(city, occupied, reach)
                .into_iter()
                .enumerate()
                .map(|(c, pressed)| pressed * (1. + tilt * lean.signed(position(mesh, c))))
                .collect()
        };
        let mut pressed = read(reach(built));
        let mut order = ranked(city, &pressed)?;
        let mut from = outside(&order, season.share);
        if from > 0 {
            let town = (order.len() - from) as f64 * mesh.area(0);
            pressed = read(reach(town));
            order = ranked(city, &pressed)?;
            from = outside(&order, season.share);
        }
        let peak = order.last().map_or([0.; 2], |&c| position(mesh, c));
        Ok(Self {
            pressure: pressed,
            ranked: order,
            from,
            peak,
        })
    }
    /// How many cells the town stood on.
    fn town_cells(&self) -> usize {
        self.ranked.len() - self.from
    }
    /// The pressure that `fraction` of the town's ground lies below.
    /// Nothing where the town stood on no ground at all.
    fn level(&self, fraction: f64) -> Option<f64> {
        let last = self.ranked.len().checked_sub(1)?;
        let span = last.checked_sub(self.from)?;
        let at = self.from + (span as f64 * fraction) as usize;
        Some(self.pressure[self.ranked[at.min(last)]].max(f64::EPSILON))
    }
}

/// What it takes to lay wall across a cell, beside plain wall. Wall carried over a
/// stream or a steep bank, on arches or a water gate, takes several times the work.
/// Today's builders pay more through built ground and across busy ways. An earlier
/// era's wall ran along the open edge of the town as it then was, whatever stands there
/// now.
fn toll(city: &City, cell: usize, past: bool) -> f64 {
    let over = if city.firm[cell] { 1. } else { OVER_WATER };
    if past {
        return over;
    }
    let x = city.fields.claims[cell];
    over * (1. + x.built + city.fields.access[cell] * x.trade.ln_1p().max(0.))
}

/// One edge a town might wall: how long it runs, the work of walling all of it, what
/// that is worth, the cells of the town's body that lie along it, and the ribbon of
/// ground either side of it that a builder keeps to.
struct Edge {
    length: f64,
    work: f64,
    worth: f64,
    rim: Vec<usize>,
    ribbon: Vec<i8>,
}
impl Edge {
    /// How many cells off the edge a cell lies: nought on it, less within the town's
    /// body, more outside it, nothing beyond the ribbon.
    fn off(&self, cell: usize) -> Option<f64> {
        let steps = self.ribbon[cell];
        (steps != i8::MAX).then(|| f64::from(steps))
    }
}
fn neighbours(mesh: &TriangularLattice, cell: usize) -> impl Iterator<Item = usize> + '_ {
    (0..3).filter_map(move |side| mesh.neighbor(cell, side))
}
/// Every cell that can be reached from `from` through cells that `passable` allows,
/// `from` included.
fn flood(
    mesh: &TriangularLattice,
    from: Vec<usize>,
    passable: impl Fn(usize) -> bool,
) -> Vec<bool> {
    let mut within = vec![false; mesh.len()];
    for &cell in &from {
        within[cell] = true;
    }
    let mut reached = from;
    while let Some(cell) = reached.pop() {
        for next in neighbours(mesh, cell) {
            if passable(next) && !within[next] {
                within[next] = true;
                reached.push(next);
            }
        }
    }
    within
}
/// The town's body within an edge: the city's ground pressed above `level` and joined
/// to the town's most pressed place, with whatever ground that surrounds. Ground as
/// pressed that lies apart, a village in the city's outskirts or a quarter across open
/// fields, is not the town's body and is not walled with it. A yard, a garden or a pond
/// the town has grown round is: a wall goes round a town, not round each gap in it.
fn body(city: &City, ground: &Ground, level: f64) -> Vec<bool> {
    let own = |cell: usize| city.fields.stencil[cell] > 0.5;
    let peak = ground
        .ranked
        .last()
        .filter(|&&peak| ground.pressure[peak] > level);
    let pressed = flood(city.mesh, peak.into_iter().copied().collect(), |cell| {
        ground.pressure[cell] > level && own(cell)
    });
    surrounded(city, &pressed)
}
/// The ground `held` holds and surrounds: everything that cannot be reached from outside
/// the city, or from the edge of the map, without crossing it.
fn surrounded(city: &City, held: &[bool]) -> Vec<bool> {
    let mesh = city.mesh;
    let outside = (0..mesh.len())
        .filter(|&cell| {
            !held[cell] && (city.fields.stencil[cell] <= 0.5 || neighbours(mesh, cell).count() < 3)
        })
        .collect();
    let open = flood(mesh, outside, |cell| !held[cell]);
    open.into_iter().map(|open| !open).collect()
}
/// The body a wall already begun was planned round: the ground its course surrounds.
fn planned(city: &City, course: &[u32]) -> Vec<bool> {
    let mut held = vec![false; city.mesh.len()];
    for &cell in course {
        held[cell as usize] = true;
    }
    surrounded(city, &held)
}
/// The cells of a body that face ground outside it.
fn rim(city: &City, body: &[bool]) -> Vec<usize> {
    (0..body.len())
        .filter(|&cell| {
            body[cell]
                && (0..3).any(|side| {
                    city.mesh
                        .neighbor(cell, side)
                        .is_none_or(|next| !body[next])
                })
        })
        .collect()
}
/// How many cells each cell lies from the nearest of `from`, for cells within `reach`
/// cells of one. Cells further off are left at the most a count can hold.
fn steps_from(mesh: &TriangularLattice, from: &[usize], reach: i8) -> Vec<i8> {
    let mut steps = vec![i8::MAX; mesh.len()];
    let mut front = from.to_vec();
    for &cell in &front {
        steps[cell] = 0;
    }
    for step in 1..=reach {
        let mut next = Vec::new();
        for cell in front {
            for beside in neighbours(mesh, cell) {
                if steps[beside] == i8::MAX {
                    steps[beside] = step;
                    next.push(beside);
                }
            }
        }
        front = next;
    }
    steps
}
/// The ribbon along a body's rim: for every cell within a few cells of it, how many
/// cells off the rim it lies, counted below nought within the body and above it
/// outside. Cells further off are not on the ribbon.
fn ribbon(city: &City, body: &[bool], rim: &[usize]) -> Vec<i8> {
    let mut steps = steps_from(city.mesh, rim, RIBBON);
    for (cell, steps) in steps.iter_mut().enumerate() {
        if body[cell] && *steps != i8::MAX {
            *steps = -*steps;
        }
    }
    steps
}
/// The length of a body cell's sides that face ground outside the body.
fn open_sides(city: &City, body: &[bool], cell: usize) -> f64 {
    (0..3)
        .filter(|&side| {
            city.mesh
                .neighbor(cell, side)
                .is_none_or(|next| !body[next])
        })
        .map(|side| city.mesh.edge_length(cell, side))
        .sum()
}
/// Measures the edge round a body of the town: the people within it and its rim.
// The worth of an edge is the owner's: a wall is planned against the whole town, so one
// that takes in very little of it is worth very little.
fn edge(city: &City, ground: &Ground, body: &[bool], season: &Season) -> Edge {
    let rim = rim(city, body);
    let (mut length, mut work) = (0., 0.);
    for &cell in &rim {
        let run = open_sides(city, body, cell);
        length += run;
        work += run * toll(city, cell, season.past());
    }
    let (mut cells, mut people) = (0., 0.);
    for cell in (0..body.len()).filter(|&cell| body[cell]) {
        cells += 1.;
        people += city.fields.claims[cell].people * city.mesh.area(cell) / 1e6;
    }
    let share = (cells / ground.town_cells().max(1) as f64).min(1.);
    Edge {
        length,
        work,
        worth: enclosure_value(share, people * season.share, work),
        ribbon: ribbon(city, body, &rim),
        rim,
    }
}
/// The share of a town's built ground left outside an edge, once a civic order's
/// citadel has drawn the edge in: a citadel above one leaves that many times less
/// ground inside.
fn tightened(share: f64, tighten: f64) -> f64 {
    if tighten <= 1. {
        return share;
    }
    1. - (1. - share) / tighten
}
/// The shares of a town's built ground left outside the edges a town weighs when chance
/// plays no part, from wide to tight: nearly all of the town, its main body, its core.
fn ring_shares(tighten: f64) -> [f64; 3] {
    [0.05, 0.3, 0.6].map(|share| tightened(share, tighten))
}
/// The shares of a town's built ground left outside the edges a season's town weighs.
/// Each era draws its own, anywhere between nearly all of the town and its core, so no
/// two towns weigh the same outlines. With chance stilled they are the usual three.
fn weighed(sponsors: &Sponsors, season: &Season) -> Vec<f64> {
    let usual = ring_shares(1.);
    if sponsors.wildness <= 0. {
        return ring_shares(sponsors.citadel).to_vec();
    }
    let chance = sponsors.chance("city.wall.reach").nth(season.era as i32);
    (0..EDGES)
        .map(|edge| chance.between([edge as f64, 0.], [usual[0], usual[2]]))
        .map(|share| tightened(share, sponsors.citadel))
        .collect()
}
/// The edge a season's town sets out to wall: one of the edges it weighs, each drawing
/// for itself with the more worthwhile the likelier; with chance stilled, the most
/// worthwhile.
fn chosen_edge(city: &City, sponsors: &Sponsors, ground: &Ground, season: &Season) -> Option<Edge> {
    let edges = weighed(sponsors, season)
        .into_iter()
        .filter_map(|share| ground.level(share))
        .map(|level| edge(city, ground, &body(city, ground, level), season))
        .enumerate()
        .filter(|(_, edge)| edge.worth > 0. && edge.length > 0.);
    if sponsors.wildness <= 0. {
        return best(edges, |(_, edge)| edge.worth).map(|(_, edge)| edge);
    }
    let sharp = 2. / sponsors.wildness;
    sponsors
        .chance("city.wall.edge")
        .nth(season.era as i32)
        .weighted(
            edges,
            |(ring, _)| [*ring as f64, 0.],
            |(_, edge)| edge.worth.powf(sharp),
        )
        .map(|(_, edge)| edge)
}
/// The edge a season's builders walk. A wall the present era has begun keeps the line
/// it was begun on, measured again against the town as it now stands: the town may
/// grow past it or gather behind it, the builders go on with the wall they planned.
fn edge_to_walk(
    city: &City,
    sponsors: &Sponsors,
    ground: &Ground,
    (season, walls): (&Season, &[Wall]),
) -> Option<Edge> {
    // A wall with no line on record has none to keep: its town draws an edge afresh.
    let begun = walls
        .last()
        .filter(|wall| begun(wall, season) && !wall.course.is_empty());
    match begun {
        Some(wall) => Some(edge(city, ground, &planned(city, &wall.course), season)),
        None => chosen_edge(city, sponsors, ground, season),
    }
}

/// The work a season gives its walls. An era gives what its town could, by how keenly
/// its threat and the worth of the edge moved it. The present era's builders set out in
/// a year of the era dealt by chance and give, each round after, what their supporters
/// can do in the years the round stands for, within the standing stock not yet spent.
fn work(
    city: &City,
    sponsors: &Sponsors,
    means: &Means,
    walls: &[Wall],
    (season, edge): (&Season, &Edge),
) -> f64 {
    let keen = walls::keenness(sponsors.threat(season.era), edge.worth);
    if season.past() {
        return means.capacity * season.share * keen;
    }
    if city.round < sponsors.begins(city.rounds) {
        return 0.;
    }
    let spent: f64 = walls
        .iter()
        .filter(|wall| !wall.inherited())
        .map(Wall::funded)
        .sum();
    let years = city
        .rounds
        .get(city.round.saturating_sub(1))
        .copied()
        .unwrap_or(0.);
    (means.capacity - spent)
        .max(0.)
        .min(means.supporters * YEAR_WORK * years)
        * keen
}

/// The cells a stretch between two points crosses.
fn crossed<'a>(city: &'a City<'a>, [from, to]: [[f64; 2]; 2]) -> impl Iterator<Item = usize> + 'a {
    (0..=4).filter_map(move |part| {
        let along = f64::from(part) / 4.;
        cell_at(
            city.mesh,
            [
                from[0] + (to[0] - from[0]) * along,
                from[1] + (to[1] - from[1]) * along,
            ],
        )
    })
}
/// The wall and section lying on each cell, standing or fallen.
struct Laid(Vec<Option<(u32, u32)>>);
impl Laid {
    fn of(city: &City, walls: &[Wall]) -> Self {
        let mut laid = Self(vec![None; city.mesh.len()]);
        for (wall, record) in walls.iter().enumerate() {
            for (at, section) in record.sections.iter().enumerate() {
                laid.mark(city, [wall, at], section.ends);
            }
        }
        laid
    }
    fn mark(&mut self, city: &City, [wall, section]: [usize; 2], ends: [[f64; 2]; 2]) {
        for cell in crossed(city, ends) {
            self.0[cell] = Some((wall as u32, section as u32));
        }
    }
    fn at(&self, cell: usize) -> Option<[usize; 2]> {
        self.0[cell].map(|(wall, section)| [wall as usize, section as usize])
    }
    /// Forgets what lies on the cells between two points, where that is `wall`'s
    /// sections from `from` on: they have been pulled down.
    fn clear(&mut self, city: &City, [wall, from]: [usize; 2], ends: [[f64; 2]; 2]) {
        for cell in crossed(city, ends) {
            if self
                .at(cell)
                .is_some_and(|[on, section]| on == wall && section >= from)
            {
                self.0[cell] = None;
            }
        }
    }
}

/// What a season's builders walk: the city, the town's ground, the edge they wall and
/// the draws that are theirs.
struct Walk<'a> {
    city: &'a City<'a>,
    sponsors: &'a Sponsors,
    ground: &'a Ground,
    edge: &'a Edge,
    season: &'a Season<'a>,
    /// The season's own wall.
    own: usize,
    /// The era's sway: where along the edge its line runs inside it and where outside.
    sway: Noise,
}
/// The cells within `reach` cells of `cell`, itself first and the nearer before the
/// further, each with how many cells off it lies.
fn around(mesh: &TriangularLattice, cell: usize, reach: i8) -> Vec<(usize, i8)> {
    let mut found = vec![(cell, 0)];
    let mut next = 0;
    while let Some(&(at, steps)) = found.get(next) {
        next += 1;
        if steps == reach {
            continue;
        }
        for beside in neighbours(mesh, at) {
            if found.iter().all(|(seen, _)| *seen != beside) {
                found.push((beside, steps + 1));
            }
        }
    }
    found
}
/// Why a builder stops carrying the wall one way: it has joined wall of its own town's
/// laying, it has carried the wall to a bank it cannot cross, its work is spent, every
/// way on is shut, it has turned back on itself, or it has walked three times the
/// edge's length.
#[derive(Clone, Copy, Debug)]
enum Stop {
    Joined,
    Banked,
    Spent,
    Shut,
    Turned,
    Round,
}
impl Stop {
    /// Whether the wall's line is left with a loose end: nothing closes it there.
    fn loose(self) -> bool {
        !matches!(self, Self::Joined | Self::Banked)
    }
}
/// One way a builder carries the wall from where it began.
struct Leg {
    builder: usize,
    /// Which way round the town it goes: one, or minus one.
    way: f64,
    /// How many sections the season's wall held when it began this way.
    began: usize,
    /// The sections laid before it where it began, which for its first steps it does
    /// not take for wall it has come upon: the first sections laid the other way from
    /// the same place, or the last at the loose end it takes up.
    behind: std::ops::Range<usize>,
    /// The steps taken this way and the work left.
    steps: usize,
    left: f64,
    /// Its heading after each step.
    headings: Vec<f64>,
}
impl Leg {
    /// Whether a section of the season's wall is the builder's own work in hand, which
    /// it does not take for wall it has come upon: the few sections it laid last this
    /// way, and, for its first steps, those laid before it where it began.
    fn in_hand(&self, section: usize, count: usize) -> bool {
        let last = section >= count.saturating_sub(OWN).max(self.began);
        last || (self.steps <= FRESH + 2 && self.behind.contains(&section))
    }
    /// Whether the builder has turned back on itself: over its last few steps its
    /// heading has swung further than any stretch of a town's edge turns in that
    /// distance. It has lost the edge and is circling.
    fn turned_back(&self) -> bool {
        let last = self.headings.len().saturating_sub(1);
        last >= TURN_STEPS && (self.headings[last] - self.headings[last - TURN_STEPS]).abs() > TURN
    }
}
impl Walk<'_> {
    /// What a builder knows of the wall lying about when it sets out: how many cells
    /// each cell lies from the standing wall of its own town's laying, and from any
    /// wall, of any era, standing or fallen, for cells within sight of some.
    fn sighted(&self, laid: &Laid, walls: &[Wall]) -> [Vec<i8>; 2] {
        let mesh = self.city.mesh;
        let own = |cell: &usize| {
            laid.at(*cell).is_some_and(|[wall, section]| {
                wall == self.own && walls[wall].sections[section].stands()
            })
        };
        let own: Vec<usize> = (0..mesh.len()).filter(own).collect();
        let any: Vec<usize> = (0..mesh.len())
            .filter(|&cell| laid.at(cell).is_some())
            .collect();
        [own, any].map(|cells| steps_from(mesh, &cells, SIGHT))
    }
    /// What a step from `from` to `at` is worth to a builder. It judges the step by
    /// where it leads a few steps on: most where that lies on the era's line, which
    /// sways a little inside the town's edge here and outside it there, and more the
    /// nearer wall already lies there, standing or fallen, so a builder closes on it
    /// and carries it on. Looking ahead, it turns before the line leaves it and comes
    /// onto the line without swinging across it. A step onto ground off the ribbon
    /// along the edge, or ground that cannot carry a wall, is worth nothing: a builder
    /// does not go there.
    fn worth(&self, wall: &[i8], [from, at]: [[f64; 2]; 2]) -> Option<f64> {
        let mesh = self.city.mesh;
        let cell = cell_at(mesh, at)?;
        self.edge.off(cell)?;
        let wet = !self.city.firm[cell];
        if wet && !self.comes_out([from, at]) {
            return None;
        }
        // It looks as far on as the step still leads along the ribbon, and a way it can
        // see less far along is worth less: at the tip of a finger of the town the ways
        // that turn with the edge are the ones it can see along.
        let (short, ahead, seen) = (0..LOOK)
            .find_map(|short| {
                let steps = f64::from(LOOK - short);
                let ahead = [0, 1].map(|axis| from[axis] + steps * (at[axis] - from[axis]));
                let seen = cell_at(mesh, ahead).filter(|&seen| self.edge.off(seen).is_some())?;
                Some((short, ahead, seen))
            })
            .unwrap_or((LOOK - 1, at, cell));
        let line = SWAY * self.sponsors.wildness * self.sway.signed(ahead);
        let off = (self.edge.off(seen).unwrap_or(0.) - line) / f64::from(RIBBON);
        let drawn = match wall[seen] {
            i8::MAX => 0.,
            steps => 1. - f64::from(steps) / f64::from(SIGHT + 1),
        };
        // The nearer wall lies, the less the era's own line counts: a builder two cells
        // off wall goes to it, and does not lay a second wall alongside.
        Some(
            FOLLOW * drawn
                - HOLD * off * off * (1. - drawn)
                - BLIND * f64::from(short)
                - WET * f64::from(wet),
        )
    }
    /// Whether a step onto water, or ground too steep for a wall, comes out on firm
    /// ground of the ribbon within two more steps the same way: a stream or a bank a
    /// wall can be carried over, not a lake or a cliff it must stop at.
    fn comes_out(&self, [from, at]: [[f64; 2]; 2]) -> bool {
        [2., 3.].into_iter().any(|steps| {
            let beyond = [0, 1].map(|axis| from[axis] + steps * (at[axis] - from[axis]));
            cell_at(self.city.mesh, beyond)
                .is_some_and(|cell| self.city.firm[cell] && self.edge.off(cell).is_some())
        })
    }
    /// Where a builder sets out anew: on edge with none of its own town's standing wall
    /// in sight, toward the side the era's threat came from, with chance in the
    /// choosing. Nowhere, once all the edge has its wall in sight.
    fn start(&self, standing: &[i8], builder: usize) -> Option<usize> {
        let mesh = self.city.mesh;
        let number = self.season.round * BUILDERS + builder;
        // One number for the era and the builder together: two given one after the
        // other would give era two's third builder the draws of era three's second.
        let chance = self
            .sponsors
            .chance("city.wall.start")
            .nth((self.season.era * 4096 + number) as i32);
        let bearing = self.sponsors.bearing(self.season.era);
        let on_edge = self
            .edge
            .rim
            .iter()
            .copied()
            .filter(|&cell| self.city.firm[cell] && standing[cell] == i8::MAX);
        best(on_edge, |&cell| {
            let [x, y] = position(mesh, cell);
            let outward = (y - self.ground.peak[1]).atan2(x - self.ground.peak[0]);
            self.sponsors.wildness * (FACING * (outward - bearing).cos() + chance.signed([x, y]))
        })
    }
    /// Which way round the town a builder works first: chance gives it.
    fn first_way(&self, builder: usize) -> f64 {
        let number = (self.season.round * BUILDERS + builder) as f64;
        let sunwise = self.sponsors.wildness > 0.
            && self
                .sponsors
                .chance("city.wall.way")
                .happens([self.season.era as f64, number], 0.5);
        if sunwise {
            -1.
        } else {
            1.
        }
    }
    /// A builder at its start, facing along the edge one `way` round the town or the
    /// other: toward the furthest cell of the edge a few cells off on that side, so it
    /// sets out along the edge as it runs there and not across it.
    fn facing(&self, start: usize, way: f64) -> Walker {
        let mesh = self.city.mesh;
        let point = position(mesh, start);
        let outward = [
            point[0] - self.ground.peak[0],
            point[1] - self.ground.peak[1],
        ];
        let along = around(mesh, start, SIGHT)
            .into_iter()
            .filter(|(cell, _)| self.edge.ribbon[*cell] == 0)
            .map(|(cell, _)| position(mesh, cell))
            .map(|at| [at[0] - point[0], at[1] - point[1]])
            .filter(|to| way * (outward[0] * to[1] - outward[1] * to[0]) > 0.);
        let heading = match best(along, |to| to[0].hypot(to[1])) {
            Some(to) => to[1].atan2(to[0]),
            None => outward[1].atan2(outward[0]) + way * std::f64::consts::FRAC_PI_2,
        };
        Walker { point, heading }
    }
    /// The cell of the season's own wall that a builder comes within a few cells of:
    /// laid by an earlier builder, in an earlier round or earlier in its own walk, it
    /// means this stretch of the edge is walled. The builder's own work in hand does
    /// not count, or it could never lay two sections in a row.
    fn met(&self, walls: &[Wall], laid: &Laid, (cell, leg): (usize, &Leg)) -> Option<usize> {
        let count = walls[self.own].sections.len();
        around(self.city.mesh, cell, MEET)
            .into_iter()
            .map(|(at, _)| at)
            .find(|&at| {
                laid.at(at).is_some_and(|[wall, section]| {
                    wall == self.own
                        && !leg.in_hand(section, count)
                        && walls[wall].sections[section].stands()
                })
            })
    }
    /// Whether a step runs along an earlier era's wall that still stands: one lies in
    /// the step's cell and runs within about forty-five degrees of the step. A step
    /// that only crosses old wall does not run along it.
    fn along_old_wall(
        &self,
        walls: &[Wall],
        laid: &Laid,
        ([from, to], cell): ([[f64; 2]; 2], usize),
    ) -> bool {
        let Some([wall, section]) = laid.at(cell) else {
            return false;
        };
        let old = &walls[wall].sections[section];
        if wall == self.own || !old.stands() {
            return false;
        }
        let [a, b] = old.ends;
        let (step, line) = (
            [to[0] - from[0], to[1] - from[1]],
            [b[0] - a[0], b[1] - a[1]],
        );
        let lengths = step[0].hypot(step[1]) * line[0].hypot(line[1]);
        (step[0] * line[0] + step[1] * line[1]).abs() > 0.7 * lengths
    }
    /// Lays a new section of the season's wall from `from` to `to`, charged as wall
    /// across `cell`, and returns the work it takes, or nothing where the work left does
    /// not cover it. Along an earlier era's wall that still stands the builder takes
    /// that wall into its own line, for the little work of making it good.
    fn section(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        ([from, to], cell): ([[f64; 2]; 2], usize),
        leg: &Leg,
    ) -> Option<f64> {
        let taken = self.along_old_wall(walls, laid, ([from, to], cell));
        let cost = distance(from, to)
            * toll(self.city, cell, self.season.past())
            * if taken { MAKE_GOOD } else { 1. };
        if cost > leg.left {
            return None;
        }
        let own = self.own;
        laid.mark(self.city, [own, walls[own].sections.len()], [from, to]);
        walls[own]
            .sections
            .push(Section::laid([from, to], cell, cost));
        Some(cost)
    }
    /// What a builder does with its step, and whether it stops. It lays a section of
    /// the season's wall across the step. Coming within a few cells of its own town's
    /// wall, its stretch is done: it lays a last length straight to that wall and
    /// stops. It stops, too, where the work left does not cover the step.
    fn lay(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        ends: [[f64; 2]; 2],
        leg: &mut Leg,
    ) -> Option<Stop> {
        let Some(cell) = cell_at(self.city.mesh, ends[1]) else {
            return Some(Stop::Shut);
        };
        let met = self.met(walls, laid, (cell, leg));
        let Some(spent) = self.section(walls, laid, (ends, cell), leg) else {
            return Some(Stop::Spent);
        };
        leg.left -= spent;
        let wall = met?;
        let tie = [ends[1], position(self.city.mesh, wall)];
        let Some(spent) = self.section(walls, laid, (tie, cell), leg) else {
            return Some(Stop::Spent);
        };
        leg.left -= spent;
        Some(Stop::Joined)
    }
    /// One builder's work, and the work left after it, or nothing where there is no
    /// work to do. A builder takes the wall up where its line was left loose. Where no
    /// end is loose it sets out anew on open edge and carries a wall both ways from
    /// there: half the work goes the first way, and whatever is then left the other.
    fn walk(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        builder: usize,
        mut left: f64,
    ) -> io::Result<Option<f64>> {
        let [standing, lying] = self.sighted(laid, walls);
        if !walls[self.own].loose.is_empty() {
            return self.take_up(walls, laid, &lying, (builder, left)).map(Some);
        }
        let Some(start) = self.start(&standing, builder) else {
            return Ok(None);
        };
        let way = self.first_way(builder);
        let set_out = walls[self.own].sections.len();
        for (way, share) in [(way, 0.5), (-way, 1.)] {
            let began = walls[self.own].sections.len();
            let leg = Leg {
                builder,
                way,
                began,
                behind: set_out..began.min(set_out + FRESH),
                steps: 0,
                left: left * share,
                headings: Vec::new(),
            };
            // Where its own wall already stands at the start, the first way having come
            // right round to it, there is nothing to carry the other way.
            if self.met(walls, laid, (start, &leg)).is_some() {
                continue;
            }
            left -= self
                .carry(walls, laid, &lying, (self.facing(start, way), leg))?
                .0;
        }
        Ok(Some(left))
    }
    /// Takes the wall up at the loose end left longest and carries it on the way it was
    /// going, with an even share of the work for each loose end. Returns the work left.
    /// An end from which the builder can lay nothing more is given up, unless it was
    /// only work that ran short: that end waits for a later round.
    fn take_up(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        lying: &[i8],
        (builder, left): (usize, f64),
    ) -> io::Result<f64> {
        let ends = walls[self.own].loose.len();
        let end = walls[self.own].loose[0];
        let began = walls[self.own].sections.len();
        let leg = Leg {
            builder,
            way: end.way,
            began,
            behind: (end.section + 1).saturating_sub(FRESH)..end.section + 1,
            steps: 0,
            left: left / ends as f64,
            headings: Vec::new(),
        };
        let walker = Walker {
            point: end.at,
            heading: end.heading,
        };
        let (spent, stop) = self.carry(walls, laid, lying, (walker, leg))?;
        let waits = matches!(stop, Stop::Spent) && walls[self.own].sections.len() == began;
        if !waits {
            walls[self.own].loose.remove(0);
        }
        Ok(left - spent)
    }
    /// Carries the wall one way from where `walker` stands until it stops, and records
    /// the end as loose where it laid wall and nothing closes its line. Returns the work
    /// spent and why it stopped.
    fn carry(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        lying: &[i8],
        (mut walker, mut leg): (Walker, Leg),
    ) -> io::Result<(f64, Stop)> {
        let (given, began) = (leg.left, walker.point);
        let stop = self.leg(walls, laid, lying, (&mut walker, &mut leg))?;
        if matches!(stop, Stop::Turned) {
            self.pull_down(walls, laid, (&mut walker, &mut leg), began);
        }
        let count = walls[self.own].sections.len();
        if stop.loose() && count > leg.began {
            walls[self.own].loose.push(LooseEnd {
                at: walker.point,
                way: leg.way,
                heading: walker.heading,
                section: count - 1,
            });
        }
        self.trace_builder(&leg, [began, walker.point], given - leg.left, stop);
        Ok((given - leg.left, stop))
    }
    /// A builder that has turned back on itself pulls down what it laid since it went
    /// wrong, has that work again, and stands where it stood then, facing as it did.
    /// `began` is where it began this way.
    fn pull_down(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        (walker, leg): (&mut Walker, &mut Leg),
        began: [f64; 2],
    ) {
        let own = self.own;
        let keep = walls[own]
            .sections
            .len()
            .saturating_sub(TURN_STEPS)
            .max(leg.began);
        for section in walls[own].sections.drain(keep..) {
            leg.left += section.cost;
            laid.clear(self.city, [own, keep], section.ends);
        }
        let then = leg.headings.len().saturating_sub(TURN_STEPS + 1);
        walker.heading = leg.headings.get(then).copied().unwrap_or(walker.heading);
        walker.point = walls[own]
            .sections
            .get(keep.wrapping_sub(1))
            .filter(|_| keep > leg.began)
            .map_or(began, |section| section.ends[1]);
    }
    /// One way of a builder's work: a walk along the edge, laying wall until it joins
    /// its own town's wall, the work is spent, it can go no further, it has turned back
    /// on itself, or it has walked three times the edge's length. Where the way ahead
    /// is shut, by water, a cliff or the ribbon's end, it tries a sharp turn before
    /// giving up, so a wall turns along a bank it cannot cross.
    fn leg(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        lying: &[i8],
        (walker, leg): (&mut Walker, &mut Leg),
    ) -> io::Result<Stop> {
        let reach = self.city.mesh.spacing() * 0.75;
        let wild = self.sponsors.wildness;
        let stride = Stride {
            fan: &FAN,
            whim: WHIM * wild,
            drift: DRIFT * wild,
            span: 6. * reach,
        };
        let era = self.season.era as i32;
        let whims = Whims {
            turn: self.sponsors.chance("city.wall.turn").nth(era),
            drift: self.sponsors.chance("city.wall.drift").nth(era),
        };
        let sharp = Stride {
            fan: &SHARP,
            ..stride
        };
        // Each way of each builder's work has its own whims.
        let number =
            (2 * (self.season.round * BUILDERS + leg.builder)) as f64 + f64::from(leg.way < 0.);
        loop {
            let travelled = leg.steps as f64 * reach;
            if travelled >= 3. * self.edge.length {
                return Ok(Stop::Round);
            }
            let from = walker.point;
            let mut step = |stride: &Stride<'_>| {
                walker.step(stride, whims, [number, travelled], reach, |at| {
                    Ok(self.worth(lying, [from, at]))
                })
            };
            if !(step(&stride)? || step(&sharp)?) {
                return Ok(self.to_the_bank(walls, laid, walker.point, leg));
            }
            if let Some(stop) = self.lay(walls, laid, [from, walker.point], leg) {
                return Ok(stop);
            }
            leg.steps += 1;
            leg.headings.push(walker.heading);
            if leg.turned_back() {
                return Ok(Stop::Turned);
            }
        }
    }
    /// Where a builder can go no further and water or ground too steep for a wall lies
    /// within a few cells, it carries its wall on to that, so the bank or the cliff
    /// completes the line and nothing is left open between them. Elsewhere the way is
    /// only shut, and the end is left loose.
    fn to_the_bank(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        at: [f64; 2],
        leg: &mut Leg,
    ) -> Stop {
        let mesh = self.city.mesh;
        let bank = cell_at(mesh, at).and_then(|cell| {
            let bank = around(mesh, cell, MEET)
                .into_iter()
                .find(|(near, _)| !self.city.firm[*near])?;
            Some((cell, bank.0))
        });
        let Some((cell, bank)) = bank else {
            return Stop::Shut;
        };
        let reach = [at, position(mesh, bank)];
        match self.section(walls, laid, (reach, cell), leg) {
            Some(spent) => {
                leg.left -= spent;
                Stop::Banked
            }
            None => Stop::Spent,
        }
    }
    /// One way of a builder's work, written to the server log when `ATLAS_TRACE_CITY`
    /// is set: where it set out and stopped, how far it went, the work it spent and why
    /// it stopped.
    fn trace_builder(&self, leg: &Leg, [start, end]: [[f64; 2]; 2], spent: f64, stop: Stop) {
        if !traced() {
            return;
        }
        let builder = leg.builder;
        let travelled = leg.steps as f64 * self.city.mesh.spacing() * 0.75;
        let peak = self.ground.peak;
        let from_peak = |at: [f64; 2]| [(at[0] - peak[0]).round(), (at[1] - peak[1]).round()];
        eprintln!(
            "{}",
            serde_json::json!({ "event": "city.wall-builder", "details": {
                "era": self.season.name,
                "round": self.season.round,
                "builder": builder,
                "setOut": from_peak(start),
                "stopped": from_peak(end),
                "walkedKm": travelled / 1e3,
                "spent": spent.round(),
                "why": format!("{stop:?}"),
            }})
        );
    }
}

/// Whether a wall is the present era's own, begun in an earlier round of it.
fn begun(wall: &Wall, season: &Season) -> bool {
    !season.past() && !wall.inherited() && wall.era.as_deref() == season.name
}
/// The record a season's builders add to: the present era's wall if an earlier round
/// began one, otherwise a new one.
fn own_wall(walls: &mut Vec<Wall>, season: &Season) -> usize {
    if !walls.last().is_some_and(|wall| begun(wall, season)) {
        walls.push(Wall {
            round: season.round,
            era: season.name.map(str::to_owned),
            ..Default::default()
        });
    }
    walls.len() - 1
}
/// One season of building. The season's town is read from the ground, an edge is drawn
/// for it, and if the era gives enough work to begin, its builders walk.
fn build(
    city: &City,
    sponsors: &Sponsors,
    means: &Means,
    walls: &mut Vec<Wall>,
    season: &Season,
) -> io::Result<()> {
    let ground = Ground::of(city, &means.occupied, sponsors, season)?;
    let Some(edge) = edge_to_walk(city, sponsors, &ground, (season, walls)) else {
        return Ok(());
    };
    let mut left = work(city, sponsors, means, walls, (season, &edge));
    trace_season(sponsors, season, &edge, left);
    if left < LEAST * edge.work {
        return Ok(());
    }
    let own = own_wall(walls, season);
    walls[own].worth = edge.worth;
    if !season.past() && walls[own].course.is_empty() {
        walls[own].course = edge.rim.iter().map(|&cell| cell as u32).collect();
    }
    let mut laid = Laid::of(city, walls);
    let walk = Walk {
        city,
        sponsors,
        ground: &ground,
        edge: &edge,
        season,
        own,
        sway: sponsors
            .chance("city.wall.sway")
            .nth(season.era as i32)
            .noise(SWAY_RUN * city.mesh.spacing(), 2),
    };
    // Builders work one after another while work remains and there is work to do: each
    // takes the wall up where it was left loose, or begins on edge still open.
    for builder in 0..BUILDERS {
        if left < LEAST * edge.work {
            break;
        }
        let Some(after) = walk.walk(walls, &mut laid, builder, left)? else {
            break;
        };
        left = after;
    }
    if walls[own].sections.is_empty() {
        walls.remove(own);
    }
    Ok(())
}

/// Wall falls. Over `part` of an era, each standing section falls if it lies in the
/// patches the era's wear covers: a little of the ground everywhere, more where built
/// ground presses on the wall and its stone is taken, more where the quarter lies in
/// ruin. The patches shift as `time` passes, so each era takes different stretches and
/// what it takes it takes in runs. With `earlier` only walls of earlier eras wear: the
/// present era's builders keep what they are building.
fn wear(
    city: &City,
    sponsors: &Sponsors,
    walls: &mut [Wall],
    (time, part): (f64, f64),
    earlier: bool,
) {
    let patches = Patches::of(sponsors.chance("city.wall.wear").noise(WEAR_PATCH, 3));
    let worn = walls.iter_mut().filter(|wall| !earlier || wall.inherited());
    for section in worn.flat_map(|wall| &mut wall.sections) {
        if !section.stands() {
            continue;
        }
        let x = city.fields.claims[section.cell];
        let [a, b] = section.ends;
        let middle = [(a[0] + b[0]) / 2., (a[1] + b[1]) / 2.];
        // With chance stilled every stretch stands at the middle rank.
        let rank = 0.5 + (patches.rank_at(middle, time) - 0.5) * sponsors.wildness;
        if rank < walls::era_loss(x.built, x.ruin) * part {
            section.fall();
        }
    }
}

/// How long someone coming from outside the city takes to reach each cell, when the
/// cells in `barred` cannot be crossed. Water and ground too steep for a wall are
/// crossed many times more slowly than firm ground: a stream hinders, and a broad river
/// or a cliff holds an approach off as a wall does, so it completes a side.
fn approach(city: &City, outside: &[usize], barred: &[bool]) -> Vec<f64> {
    Front {
        chance: Chance::of(0, 0),
        roughness: 0.,
    }
    .arrivals(city.mesh, outside, f64::INFINITY, |_, to| {
        (!barred[to]).then_some(if city.firm[to] { 1. } else { 1. / WADE })
    })
}
/// Finds the ground each wall shelters and whether the city has outgrown it: whether it
/// is an earlier era's wall that now holds too small a share of the people it is
/// measured against. Ground is
/// sheltered where the standing wall makes someone coming from outside go a long way
/// round to reach it, or keeps them out altogether: all of the ground inside a closed
/// circuit, the ground close behind a long arc, none behind a stump.
fn shelter(city: &City, walls: &mut [Wall], measured: f64) {
    let n = city.mesh.len();
    let own: Vec<bool> = city.fields.stencil.iter().map(|s| *s > 0.5).collect();
    let outside: Vec<usize> = (0..n).filter(|&cell| !own[cell]).collect();
    let open = approach(city, &outside, &vec![false; n]);
    for wall in walls {
        let mut barred = vec![false; n];
        let mut standing = 0.;
        for section in wall.sections.iter().filter(|section| section.stands()) {
            standing += distance(section.ends[0], section.ends[1]);
            for cell in crossed(city, section.ends) {
                barred[cell] = true;
            }
        }
        let round = (0.15 * standing).max(3. * city.mesh.spacing());
        let kept = approach(city, &outside, &barred);
        wall.inside = (0..n)
            .filter(|&cell| own[cell] && !barred[cell] && kept[cell] - open[cell] > round)
            .map(|cell| cell as u32)
            .collect();
        wall.area = wall.inside.len() as f64 * city.mesh.area(0);
        let residents: f64 = wall
            .inside
            .iter()
            .map(|&c| city.fields.claims[c as usize].people * city.mesh.area(c as usize) / 1e6)
            .sum();
        // Only a wall of an earlier era can be outgrown; a tight wall of today's is
        // today's choice.
        wall.outgrown = wall.inherited() && !wall.open() && residents < 0.45 * measured;
        wall.lines = wall.sections.iter().filter_map(Section::standing).collect();
    }
}

/// The share of an era's years that have passed by the end of this round.
fn elapsed(city: &City) -> f64 {
    city.rounds.iter().take(city.round).sum::<f64>() / ERA_YEARS
}
/// One round of the city's walls. The first round tells the town's past: each earlier
/// era builds against the town as it then was and is followed by an era's wear. Every
/// round the present era's builders walk and the round's share of an era's wear falls.
/// The ground each wall shelters is then found again, so the next round's people and
/// works gather behind what stands.
// owner-direction(2026-11-28): a wall enclosing twice the built ground is acceptable only when that is not always the case; sometimes there are interior walls, no walls, half decayed walls or several walls
pub(super) fn raise(
    city: &City,
    sponsors: &Sponsors,
    mut walls: Vec<Wall>,
) -> io::Result<Vec<Wall>> {
    let means = means(city);
    let last = sponsors.last();
    if city.round <= 1 {
        for era in 0..last {
            let past = Season {
                era,
                name: Some(&sponsors.eras[era].0),
                round: 0,
                share: sponsors.share(era),
            };
            if past.share > 0. {
                build(city, sponsors, &means, &mut walls, &past)?;
            }
            wear(city, sponsors, &mut walls, (era as f64 + 1., 1.), false);
        }
    }
    let now = Season {
        era: last,
        name: sponsors.eras.last().map(|(era, _)| era.as_str()),
        round: city.round.max(1),
        share: 1.,
    };
    build(city, sponsors, &means, &mut walls, &now)?;
    let years = city
        .rounds
        .get(city.round.saturating_sub(1))
        .copied()
        .unwrap_or(0.);
    wear(
        city,
        sponsors,
        &mut walls,
        (last as f64 + elapsed(city), years / ERA_YEARS),
        true,
    );
    shelter(
        city,
        &mut walls,
        means.supporters / sponsors.citadel.max(1.),
    );
    trace(city, sponsors, &means, &walls);
    Ok(walls)
}

fn traced() -> bool {
    std::env::var_os("ATLAS_TRACE_CITY").is_some()
}
/// One season's choice, written to the server log when `ATLAS_TRACE_CITY` is set.
fn trace_season(sponsors: &Sponsors, season: &Season, edge: &Edge, work: f64) {
    if !traced() {
        return;
    }
    eprintln!(
        "{}",
        serde_json::json!({ "event": "city.wall-season", "details": {
            "era": season.name,
            "round": season.round,
            "townShare": season.share,
            "threat": sponsors.threat(season.era),
            "bearing": sponsors.bearing(season.era).to_degrees().round(),
            "edgeKm": edge.length / 1e3,
            "edgeWork": edge.work.round(),
            "worth": edge.worth,
            "work": work.round(),
        }})
    );
}
/// How every wall stands at the end of a round, written to the server log when
/// `ATLAS_TRACE_CITY` is set.
fn trace(city: &City, sponsors: &Sponsors, means: &Means, walls: &[Wall]) {
    if !traced() {
        return;
    }
    let told: Vec<_> = walls
        .iter()
        .map(|wall| {
            serde_json::json!({
                "era": wall.era,
                "round": wall.round,
                "shelteredKm2": wall.area / 1e6,
                "worth": wall.worth,
                "laidKm": wall.sections.iter().map(|s| distance(s.ends[0], s.ends[1])).sum::<f64>() / 1e3,
                "standing": wall.standing_share(),
                "outgrown": wall.outgrown,
                "condition": wall.condition(),
            })
        })
        .collect();
    eprintln!(
        "{}",
        serde_json::json!({ "event": "city.walls", "details": {
            "round": city.round,
            "eras": sponsors.eras,
            "causes": [sponsors.resolve, sponsors.present],
            "begins": sponsors.begins(city.rounds),
            "citadel": sponsors.citadel,
            "supporters": means.supporters.round(),
            "capacity": means.capacity.round(),
            "walls": told,
        }})
    );
}

/// The town's record as its wall builders read it: the eras its history tells of, the
/// weight its site, standing and civic order give to defending itself, and its roll.
fn sponsors(state: &State, readiness: f64) -> io::Result<Sponsors> {
    let p = policy(state)?;
    let town = captured_settlement(state)?;
    let attributes = town.as_ref().map(|f| &f.attributes);
    let contested = attributes
        .and_then(|a| a.get("contestedBy"))
        .is_some_and(|v| !v.is_null());
    let eras = attributes
        .and_then(|a| a.get("history"))
        .and_then(|v| v.as_array())
        .map(|history| {
            history
                .iter()
                .filter_map(|e| Some((e["era"].as_str()?.to_owned(), e["townsfolk"].as_f64()?)))
                .collect()
        })
        .unwrap_or_default();
    let weigh = |cause: bool, odds: f64| if cause { odds } else { 0. };
    let lasting = [
        weigh(p.site.guarded, walls::GUARDED),
        weigh(p.site.seat, walls::SEAT),
        weigh(p.enclosed_seat().is_some(), walls::ENCLOSED_SEAT),
        p.civic.map_or(0., |order| order.defence()),
    ];
    let odds = |contest: f64| readiness * walls::resolve(lasting.into_iter().chain([contest]));
    let own = state
        .scope
        .city
        .as_ref()
        .map(|city| city.settlement.to_bytes());
    Ok(Sponsors {
        eras,
        resolve: odds(0.),
        present: odds(weigh(contested, walls::CONTESTED)),
        citadel: p
            .civic
            .map_or(1., crate::town::templates::civic::Civic::citadel),
        fortune: p
            .fortune
            .unwrap_or_else(|| own.map_or(0.5, |own| walls::fortune(&own, 0))),
        wildness: 1.,
    })
}

pub(super) fn invest(state: &State, u: &Urban, readiness: f64) -> io::Result<Vec<Wall>> {
    let r = state.regional.as_ref().unwrap();
    let field = state.field();
    let mesh = field.mesh();
    let standing = field.people().view(crate::human::HumanField::Layer(
        crate::human::catalogue::LayerId::Standing,
    ));
    let slope = field.shared().scalar(Scalar::Slope);
    let mut capital = Vec::with_capacity(mesh.len());
    let mut firm = Vec::with_capacity(mesh.len());
    for c in 0..mesh.len() {
        capital.push(standing.get(c)?.max(0.));
        firm.push(habitable(field, c)? && slope.get(c)? <= 0.4);
    }
    let city = City {
        mesh,
        fields: &u.fields,
        capital: &capital,
        firm: &firm,
        round: r.round,
        rounds: &crate::field::refinement::people::DEVELOPMENT_EXPOSURE,
    };
    let sponsors = sponsors(state, readiness)?;
    capture(state, &city, &sponsors)?;
    raise(&city, &sponsors, r.city.walls.clone())
}

/// The ground a city gave its wall builders in one round, as the map read it: kept so
/// the bench can put the wall step through a real city's rounds in seconds.
#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct Captured {
    pub spacing: f64,
    pub round: usize,
    pub eras: Vec<(String, f64)>,
    pub resolve: f64,
    pub present: f64,
    pub citadel: f64,
    pub fortune: f64,
    /// Where each cell stands.
    pub at: Vec<[f64; 2]>,
    /// Each cell's people, built share, ruin, trade, access, stencil, developed share,
    /// civic reach, standing works and whether it can carry a wall.
    pub ground: Vec<[f32; 10]>,
}
/// Writes this round's ground to the directory `ATLAS_CAPTURE_WALL_GROUND` names, in a
/// file named for the settlement and the round. Nothing is written when it is unset.
fn capture(state: &State, city: &City, sponsors: &Sponsors) -> io::Result<()> {
    let Some(directory) = std::env::var_os("ATLAS_CAPTURE_WALL_GROUND") else {
        return Ok(());
    };
    let name = captured_settlement(state)?.map_or_else(|| "city".to_owned(), |town| town.name);
    let fields = city.fields;
    let captured = Captured {
        spacing: city.mesh.spacing(),
        round: city.round,
        eras: sponsors.eras.clone(),
        resolve: sponsors.resolve,
        present: sponsors.present,
        citadel: sponsors.citadel,
        fortune: sponsors.fortune,
        at: (0..city.mesh.len())
            .map(|cell| position(city.mesh, cell))
            .collect(),
        ground: (0..city.mesh.len())
            .map(|cell| {
                let x = fields.claims[cell];
                [
                    x.people,
                    x.built,
                    x.ruin,
                    x.trade,
                    fields.access[cell],
                    fields.stencil[cell],
                    fields.developed[cell],
                    fields.civic[cell],
                    city.capital[cell],
                    f64::from(city.firm[cell]),
                ]
                .map(|value| value as f32)
            })
            .collect(),
    };
    let path = std::path::Path::new(&directory).join(format!("{name}-round-{}.json", city.round));
    std::fs::create_dir_all(&directory)?;
    serde_json::to_writer(std::fs::File::create(path)?, &captured).map_err(io::Error::other)
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod bench;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_citadel_draws_its_edges_round_more_crowded_ground() {
        assert_eq!(ring_shares(1.), [0.05, 0.3, 0.6]);
        // Twice the citadel halves the ground each edge takes in.
        let tight = ring_shares(2.);
        assert!((tight[0] - 0.525).abs() < 1e-12 && (tight[2] - 0.8).abs() < 1e-12);
        assert!(tight
            .iter()
            .zip(ring_shares(1.))
            .all(|(tight, usual)| *tight > usual));
        // An order that builds no citadel leaves the edges as they were.
        assert_eq!(ring_shares(0.5), ring_shares(1.));
    }

    #[test]
    fn an_earlier_town_stood_on_its_share_of_todays_ground() {
        let cells: Vec<usize> = (0..200).collect();
        assert_eq!(outside(&cells, 1.), 0);
        assert_eq!(outside(&cells, 0.25), 150);
        assert_eq!(outside(&cells, 0.), 200);
        assert_eq!(outside(&[], 0.5), 0);
    }
}
