//! City walls are walked into being. In each era the town's record tells of, and in each
//! round of the present one, builders set out where the town's edge stands most open,
//! walk along that edge laying wall, and stop when the work the era gives them is spent.
//! Wall falls in patches that shift from era to era, sooner where built ground presses on
//! it; later builders are drawn along what stands and lay fallen wall again.
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
    chance::{best, Chance, Front, Patches, Stride, Walker, Whims},
    field::{people::work::habitable, refinement::courses::cell_at, shared::Scalar},
    lattice::TriangularLattice,
    town::{
        geometry::distance,
        walls::{self, enclosure_value, Section, Wall},
    },
};
use std::io;

pub(super) use crate::town::walls::READINESS;

/// The turns a builder may take at each step, in radians off its heading.
const FAN: [f64; 5] = [-0.65, -0.325, 0.0, 0.325, 0.65];
/// The builders who set out in one era, or one round of the present era.
const BUILDERS: usize = 3;
/// How strongly the ground keeps a builder to the town's edge, beside holding its heading.
const HOLD: f64 = 8.;
/// What wall already laid is worth to a builder choosing its next step.
const FOLLOW: f64 = 1.;
/// How much chance counts in a builder's choice of turn, and how far its heading drifts
/// at each step, in radians. A builder's chance holds for six steps, so its drift
/// carries it through a slow bend and not a knot.
const WHIM: f64 = 0.12;
const DRIFT: f64 = 0.04;
/// How much the side an era's threat came from counts in where a builder sets out.
const FACING: f64 = 1.5;
/// How lopsided an earlier era's town was: how far chance tilts the ground it favoured.
const LEAN: f64 = 0.6;
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
    /// The settled outline's area.
    pub area: f64,
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
/// The city's own cells, the least pressed first.
fn ranked(city: &City, pressure: &[f64]) -> io::Result<Vec<usize>> {
    let cells: Vec<_> = (0..pressure.len())
        .filter(|&c| city.fields.stencil[c] > 0.5)
        .collect();
    let values: Vec<_> = cells.iter().map(|&c| pressure[c]).collect();
    let order = crate::hpc::radix_order(
        &[crate::hpc::NumericKey::Float(&values)],
        crate::hpc::Direction::Ascending,
    )
    .map_err(io::Error::other)?;
    Ok(order.into_iter().map(|at| cells[at]).collect())
}
/// How many of the least pressed of the city's cells lay outside a town with `share` of
/// today's people: the town stood on as great a share of today's ground, the most
/// pressed of it.
fn outside(ranked: &[usize], share: f64) -> usize {
    let within = (ranked.len() as f64 * share.clamp(0., 1.)).round() as usize;
    ranked.len() - within.min(ranked.len())
}

/// The ground a season's town stood on, as its builders read it: how firmly each cell
/// is pressed, the city's cells in that order, where among them the town begins, and
/// the town's most pressed place.
struct Ground {
    pressure: Vec<f64>,
    ranked: Vec<usize>,
    from: usize,
    peak: [f64; 2],
}
impl Ground {
    /// Today's town is the city as it stands. An earlier era's town stood on the most
    /// pressed share of today's ground equal to its share of today's people, read at
    /// its own grain, and it did not grow evenly: a many-scaled field of its own tilts
    /// which ground it favoured, so each era's town leans its own way.
    fn of(city: &City, occupied: &[f64], sponsors: &Sponsors, season: &Season) -> io::Result<Self> {
        let mesh = city.mesh;
        let reach = |area: f64| (area.sqrt() * 0.055).max(2. * mesh.spacing());
        let lean = sponsors
            .chance("city.wall.lean")
            .nth(season.era as i32)
            .noise((city.area * season.share).sqrt().max(mesh.spacing()), 3);
        let tilt = if season.past() {
            LEAN * sponsors.wildness
        } else {
            0.
        };
        let read = |reach: f64| -> Vec<f64> {
            pressure(city, occupied, reach)
                .into_iter()
                .enumerate()
                .map(|(c, pressed)| pressed * (1. + tilt * lean.signed(position(mesh, c))))
                .collect()
        };
        let mut pressed = read(reach(city.area));
        let mut order = ranked(city, &pressed)?;
        let mut from = outside(&order, season.share);
        if from > 0 {
            let town = city.area * (order.len() - from) as f64 / order.len() as f64;
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
    /// The share of the city's ground the town stood on.
    fn town_share(&self) -> f64 {
        (self.ranked.len() - self.from) as f64 / self.ranked.len().max(1) as f64
    }
    /// The pressure that `fraction` of the town's ground lies below.
    fn level(&self, fraction: f64) -> Option<f64> {
        let last = self.ranked.len().checked_sub(1)?;
        let at = self.from + ((last - self.from) as f64 * fraction) as usize;
        Some(self.pressure[self.ranked[at.min(last)]].max(f64::EPSILON))
    }
    /// How far a cell is from being on the edge at `level`: nought on it.
    fn off(&self, cell: usize, level: f64) -> f64 {
        (self.pressure[cell] - level) / level
    }
}

/// What it takes to lay wall across a cell, beside plain wall. Today's builders pay
/// more through built ground and across busy ways. An earlier era's wall ran along the
/// open edge of the town as it then was, whatever stands there now.
fn toll(city: &City, cell: usize, past: bool) -> f64 {
    if past {
        return 1.;
    }
    let x = city.fields.claims[cell];
    1. + x.built + city.fields.access[cell] * x.trade.ln_1p().max(0.)
}

/// One edge a town might wall: the pressure that bounds it, how long it runs, the work
/// of walling all of it and what that is worth.
struct Edge {
    level: f64,
    length: f64,
    work: f64,
    worth: f64,
}
/// The length of a cell's sides that face ground outside the edge, and the work of
/// walling them.
fn frontier(city: &City, ground: &Ground, level: f64, cell: usize, past: bool) -> [f64; 2] {
    let mut run = 0.;
    for side in 0..3 {
        let within = city
            .mesh
            .neighbor(cell, side)
            .is_some_and(|next| ground.pressure[next] > level);
        if !within {
            run += city.mesh.edge_length(cell, side);
        }
    }
    [run, run * toll(city, cell, past)]
}
/// Measures the edge at `level`: the town's ground above it, the people there, and its
/// rim.
// The worth of an edge is the owner's: a wall is planned against the whole town, so one
// that takes in very little of it is worth very little.
fn edge(city: &City, ground: &Ground, level: f64, season: &Season) -> Edge {
    let (mut cells, mut people, mut length, mut work) = (0., 0., 0., 0.);
    for &cell in &ground.ranked[ground.from..] {
        if ground.pressure[cell] <= level {
            continue;
        }
        cells += 1.;
        people += city.fields.claims[cell].people * city.mesh.area(cell) / 1e6;
        let [run, toil] = frontier(city, ground, level, cell, season.past());
        length += run;
        work += toil;
    }
    let town = city.area * ground.town_share();
    let share = cells * city.mesh.area(0) / town.max(1.);
    Edge {
        level,
        length,
        work,
        worth: enclosure_value(share, people * season.share, work),
    }
}
/// The shares of a town's ground whose pressure levels its builders may take for the
/// edge, from wide to tight. A civic order's citadel above one draws every edge in
/// round more crowded ground.
fn ring_shares(tighten: f64) -> [f64; 3] {
    let usual = [0.32, 0.56, 0.76];
    if tighten <= 1. {
        return usual;
    }
    usual.map(|share| 1. - (1. - share) / tighten)
}
/// The edge a season's town walls: one of the edges its order considers, each drawing
/// for itself with the more worthwhile the likelier. With chance stilled it is the most
/// worthwhile.
fn chosen_edge(city: &City, sponsors: &Sponsors, ground: &Ground, season: &Season) -> Option<Edge> {
    let edges = ring_shares(sponsors.citadel)
        .into_iter()
        .filter_map(|share| ground.level(share))
        .map(|level| edge(city, ground, level, season))
        .filter(|edge| edge.worth > 0. && edge.length > 0.)
        .enumerate();
    if sponsors.wildness <= 0. {
        return best(edges, |(_, edge)| edge.worth).map(|(_, edge)| edge);
    }
    let sharp = 2. / sponsors.wildness;
    sponsors
        .chance("city.wall.edge")
        .nth(season.era as i32)
        .weighted(
            edges,
            |(at, _)| [*at as f64, 0.],
            |(_, edge)| edge.worth.powf(sharp),
        )
        .map(|(_, edge)| edge)
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
    fn stands(&self, walls: &[Wall], cell: usize) -> bool {
        self.at(cell)
            .is_some_and(|[wall, section]| walls[wall].sections[section].stands())
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
}
impl Walk<'_> {
    /// What the ground at a point is worth to a builder: most on the town's edge, and
    /// more where wall already lies. Ground that cannot carry a wall is worth nothing.
    fn worth(&self, laid: &Laid, at: [f64; 2]) -> Option<f64> {
        let cell = cell_at(self.city.mesh, at).filter(|&cell| self.city.firm[cell])?;
        let off = self.ground.off(cell, self.edge.level);
        Some(FOLLOW * f64::from(laid.at(cell).is_some()) - HOLD * (off * off).min(4.))
    }
    /// Where a builder sets out: on the edge, where no wall stands, toward the side the
    /// era's threat came from, with chance in the choosing.
    fn start(&self, laid: &Laid, walls: &[Wall], builder: usize) -> Option<usize> {
        let mesh = self.city.mesh;
        let number = self.season.round * BUILDERS + builder;
        let chance = self
            .sponsors
            .chance("city.wall.start")
            .nth(self.season.era as i32)
            .nth(number as i32);
        let bearing = self.sponsors.bearing(self.season.era);
        let on_edge = self.ground.ranked[self.ground.from..]
            .iter()
            .copied()
            .filter(|&cell| {
                self.city.firm[cell] && self.ground.off(cell, self.edge.level).abs() < 0.15
            });
        best(on_edge, |&cell| {
            let [x, y] = position(mesh, cell);
            let outward = (y - self.ground.peak[1]).atan2(x - self.ground.peak[0]);
            (1. - f64::from(laid.stands(walls, cell)))
                + self.sponsors.wildness
                    * (FACING * (outward - bearing).cos() + chance.signed([x, y]))
        })
    }
    /// A builder at its start, facing along the edge one way or the other.
    fn builder(&self, start: usize, builder: usize) -> Walker {
        let point = position(self.city.mesh, start);
        let outward = (point[1] - self.ground.peak[1]).atan2(point[0] - self.ground.peak[0]);
        let number = (self.season.round * BUILDERS + builder) as f64;
        let sunwise = self.sponsors.wildness > 0.
            && self
                .sponsors
                .chance("city.wall.way")
                .happens([self.season.era as f64, number], 0.5);
        let quarter = std::f64::consts::FRAC_PI_2;
        Walker {
            point,
            heading: outward + if sunwise { -quarter } else { quarter },
        }
    }
    /// Whether standing wall runs hard beside a cell: a builder there walks on without
    /// laying a second line against the first. The few sections the builder has only
    /// just laid do not count, or it could never lay two in a row.
    fn beside_wall(&self, walls: &[Wall], laid: &Laid, own: usize, cell: usize) -> bool {
        let fresh = walls[own].sections.len().saturating_sub(3);
        (0..3)
            .filter_map(|side| self.city.mesh.neighbor(cell, side))
            .filter_map(|next| laid.at(next))
            .any(|[wall, section]| {
                (wall != own || section < fresh) && walls[wall].sections[section].stands()
            })
    }
    /// What a builder does with its step from `from` to `to`, and the work it spends.
    /// Wall that stands is walked along for nothing; fallen wall is laid again; open
    /// ground gets a new section of the season's wall. Nothing is done, and the builder
    /// stops, where the work left does not cover it.
    fn lay(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        own: usize,
        [from, to]: [[f64; 2]; 2],
        left: f64,
    ) -> Option<f64> {
        let cell = cell_at(self.city.mesh, to)?;
        if let Some([wall, section]) = laid.at(cell) {
            let section = &mut walls[wall].sections[section];
            if section.stands() {
                return Some(0.);
            }
            let cost = section.cost;
            return (cost <= left).then(|| {
                section.relay();
                cost
            });
        }
        if self.beside_wall(walls, laid, own, cell) {
            return Some(0.);
        }
        let cost = distance(from, to) * toll(self.city, cell, self.season.past());
        if cost > left {
            return None;
        }
        laid.mark(self.city, [own, walls[own].sections.len()], [from, to]);
        walls[own]
            .sections
            .push(Section::laid([from, to], cell, cost));
        Some(cost)
    }
    /// One builder's walk along the edge, laying wall until its share of the work is
    /// spent, it can go no further, or it has walked the edge's length and half again.
    fn walk(
        &self,
        walls: &mut [Wall],
        laid: &mut Laid,
        (own, builder): (usize, usize),
        mut left: f64,
    ) -> io::Result<()> {
        let Some(start) = self.start(laid, walls, builder) else {
            return Ok(());
        };
        let mut walker = self.builder(start, builder);
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
        let number = (self.season.round * BUILDERS + builder) as f64;
        let mut travelled = 0.;
        while travelled < 1.5 * self.edge.length {
            let from = walker.point;
            let went = walker.step(&stride, whims, [number, travelled], reach, |at| {
                Ok(self.worth(laid, at))
            })?;
            let spent = went
                .then(|| self.lay(walls, laid, own, [from, walker.point], left))
                .flatten();
            let Some(spent) = spent else {
                break;
            };
            left -= spent;
            travelled += reach;
        }
        Ok(())
    }
}

/// The record a season's builders add to: the present era's wall if an earlier round
/// began one, otherwise a new one.
fn own_wall(walls: &mut Vec<Wall>, season: &Season) -> usize {
    let begun = walls.last().is_some_and(|wall| {
        !season.past() && !wall.inherited() && wall.era.as_deref() == season.name
    });
    if !begun {
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
    let Some(edge) = chosen_edge(city, sponsors, &ground, season) else {
        return Ok(());
    };
    let work = work(city, sponsors, means, walls, (season, &edge));
    trace_season(sponsors, season, &edge, work);
    if work < LEAST * edge.work {
        return Ok(());
    }
    let own = own_wall(walls, season);
    walls[own].worth = edge.worth;
    let mut laid = Laid::of(city, walls);
    let walk = Walk {
        city,
        sponsors,
        ground: &ground,
        edge: &edge,
        season,
    };
    for builder in 0..BUILDERS {
        walk.walk(walls, &mut laid, (own, builder), work / BUILDERS as f64)?;
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
/// what it takes it takes in runs.
fn wear(city: &City, sponsors: &Sponsors, walls: &mut [Wall], time: f64, part: f64) {
    let patches = Patches::of(sponsors.chance("city.wall.wear").noise(WEAR_PATCH, 3));
    for section in walls.iter_mut().flat_map(|wall| &mut wall.sections) {
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
/// cells in `barred` cannot be crossed.
fn approach(city: &City, outside: &[usize], barred: &[bool]) -> Vec<f64> {
    Front {
        chance: Chance::of(0, 0),
        roughness: 0.,
    }
    .arrivals(city.mesh, outside, f64::INFINITY, |_, to| {
        (!barred[to]).then_some(1.)
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
            wear(city, sponsors, &mut walls, era as f64 + 1., 1.);
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
        last as f64 + elapsed(city),
        years / ERA_YEARS,
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
        area: state
            .spatial
            .area(state.scope.settled_outline())
            .map_err(io::Error::other)?,
        round: r.round,
        rounds: &crate::field::refinement::people::DEVELOPMENT_EXPOSURE,
    };
    raise(&city, &sponsors(state, readiness)?, r.city.walls.clone())
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod bench;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_citadel_draws_its_edges_round_more_crowded_ground() {
        assert_eq!(ring_shares(1.), [0.32, 0.56, 0.76]);
        // Twice the citadel halves the ground left outside each edge's level.
        let tight = ring_shares(2.);
        assert!((tight[0] - 0.66).abs() < 1e-12 && (tight[2] - 0.88).abs() < 1e-12);
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
