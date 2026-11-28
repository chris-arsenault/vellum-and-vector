//! Collective investment compares the protected population and cost of alternative
//! enclosures. The same choice is made once for each era the town's record tells of,
//! against the town as it then was, and a wall nobody keeps falls stretch by stretch, so
//! a city's walls tell its history: none, one, several, kept, outgrown or fallen.
use super::{
    fields::{neighborhood, policy, position, CityFields},
    geometry::{pos, xy},
    landscape::contour,
    Urban,
};
use crate::{
    atlas::{regional::city::captured_settlement, state::State},
    field::{people::work::habitable, refinement::courses::cell_at, shared::Scalar},
    lattice::TriangularLattice,
    spatial::SpatialKernel,
    town::{
        geometry::distance,
        walls::{self, enclosure_value, Section, Wall},
    },
};
use atlas_map::{
    regions::{boundary_lines, parts},
    Geometry, Position,
};
use std::io;

pub(super) use crate::town::walls::READINESS;

/// What a wall's sponsors read of the city in one round. The map gathers it from its
/// fields; a test builds it from constructed ground.
pub(super) struct City<'a> {
    pub mesh: &'a TriangularLattice,
    pub spatial: &'a dyn SpatialKernel,
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
    /// The outline of the ground where a field passes a level.
    pub contour: &'a Contour<'a>,
}
pub(super) type Contour<'a> = dyn Fn(&[f64], f64) -> io::Result<Option<Geometry>> + 'a;

/// A town's record as its wall sponsors read it.
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
    /// The settlement's roll, from which each era's chance is dealt.
    pub fortune: f64,
}
impl Sponsors {
    /// The present era's place in the record.
    fn last(&self) -> usize {
        self.eras.len().saturating_sub(1)
    }
    /// How threatened `era` left the town: nothing while it had no townsfolk, otherwise
    /// the weight of its causes scaled by the era's chance.
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
        walls::threat(causes, walls::era_chance(self.fortune, era, 0))
    }
    /// The least a circuit must be worth for the town of `era` to raise it.
    fn least(&self, era: usize) -> f64 {
        walls::RAISE / self.threat(era).max(f64::MIN_POSITIVE)
    }
    /// Whether the town of `era` kept a wall of this worth standing.
    fn keeps(&self, era: usize, worth: f64) -> bool {
        self.threat(era) * worth >= walls::UPKEEP * walls::RAISE
    }
    /// The era's town beside today's: its townsfolk as a share of today's.
    fn share(&self, era: usize) -> f64 {
        let today = self.eras.last().map_or(0., |(_, townsfolk)| *townsfolk);
        if today <= 0. {
            return 0.;
        }
        (self.eras[era].1 / today).clamp(0., 1.)
    }
    /// The round in which the present era's sponsor begins: the era's chance falls on
    /// one of the years the rounds stand for.
    fn begins(&self, rounds: &[f64]) -> usize {
        let mut year = walls::era_chance(self.fortune, self.last(), 1) * rounds.iter().sum::<f64>();
        for (index, years) in rounds.iter().enumerate() {
            if year < *years {
                return index + 1;
            }
            year -= years;
        }
        rounds.len().max(1)
    }
    /// The era that raised a wall, by the name it carries; one with no known era is the
    /// present's.
    fn era_of(&self, wall: &Wall) -> usize {
        wall.era
            .as_deref()
            .and_then(|name| self.eras.iter().position(|(era, _)| era == name))
            .unwrap_or(self.last())
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

/// The town a circuit is planned against: the city today, or the town of an earlier era
/// as a share of today's ground and people; and the least a circuit must be worth for
/// that town, threatened as its era left it, to raise one.
struct Planned<'a> {
    share: f64,
    round: usize,
    era: Option<&'a str>,
    least: f64,
}

/// The cells a circuit holds, the people in them today, and those of them no earlier
/// wall holds.
fn held(
    city: &City,
    envelope: &Geometry,
    positions: &[Position],
    old: &[Wall],
) -> io::Result<(Vec<u32>, f64, f64)> {
    let covered = city
        .spatial
        .covers_points(envelope, positions)
        .map_err(io::Error::other)?;
    let mut inside = Vec::new();
    let (mut population, mut new_population) = (0., 0.);
    for (c, _) in covered.iter().enumerate().filter(|(_, b)| **b) {
        inside.push(c as u32);
        let people = city.fields.claims[c].people * city.mesh.area(c) / 1e6;
        population += people;
        if old.iter().all(|w| !w.encloses(c)) {
            new_population += people;
        }
    }
    Ok((inside, population, new_population))
}

/// One section of a circuit with the work it takes: more through built ground and
/// across busy ways. Water and cliffs carry no wall.
fn section(city: &City, [a, b]: [[f64; 2]; 2]) -> Option<Section> {
    let mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
    let cell = cell_at(city.mesh, mid).filter(|&c| city.firm[c])?;
    let length = distance(a, b);
    if length <= 0. {
        return None;
    }
    let x = city.fields.claims[cell];
    Some(Section {
        ends: [a, b],
        cell,
        cost: length * (1. + x.built + city.fields.access[cell] * x.trade.ln_1p().max(0.)),
        built: 0.,
        disused: 0.,
        repaired: 0.,
    })
}
fn sections(city: &City, exterior: Vec<Position>, deviation: f64) -> io::Result<Vec<Section>> {
    let trace = city
        .spatial
        .resample_trace(
            &Geometry::LineString {
                coordinates: exterior,
            },
            deviation,
            Some(city.mesh.spacing() * 2.),
        )
        .map_err(io::Error::other)?;
    let mut sections = Vec::new();
    for ring in boundary_lines(&trace) {
        for pair in ring.windows(2) {
            sections.extend(section(city, [xy(pair[0]), xy(pair[1])]));
        }
    }
    Ok(sections)
}

fn proposal(
    city: &City,
    shape: Geometry,
    (rings, old): (&Rings, &[Wall]),
    planned: &Planned,
) -> io::Result<Option<(f64, Wall)>> {
    let positions = &rings.positions;
    let town_area = city.area * rings.town_share();
    let Geometry::Polygon { coordinates } = shape else {
        return Ok(None);
    };
    let Some(exterior) = coordinates.into_iter().next() else {
        return Ok(None);
    };
    let envelope = Geometry::Polygon {
        coordinates: vec![exterior.clone()],
    };
    let area = city.spatial.area(&envelope).map_err(io::Error::other)?;
    let (inside, population, new_population) = held(city, &envelope, positions, old)?;
    if new_population <= 0. || new_population < 0.5 * population {
        return Ok(None);
    }
    let deviation = city.mesh.spacing().max(town_area.sqrt() * 0.005);
    let sections = sections(city, exterior, deviation)?;
    if sections.is_empty() {
        return Ok(None);
    }
    let cost: f64 = sections.iter().map(|s| s.cost).sum();
    // The people the ground held then, taken as today's by the town's share of today.
    let value = enclosure_value(area / town_area, new_population * planned.share, cost);
    Ok(Some((
        value,
        Wall {
            round: planned.round,
            inside,
            area,
            worth: value,
            sections,
            era: planned.era.map(str::to_owned),
            ..Default::default()
        },
    )))
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
/// How many of the least pressed of the city's cells lay outside a town that held `share`
/// of today's people: the town stood on the most pressed ground that holds that share
/// now. Today's town is the whole of the city's ground.
fn outside(city: &City, ranked: &[usize], share: f64) -> usize {
    if share >= 1. {
        return 0;
    }
    let people = |c: usize| city.fields.claims[c].people.max(0.);
    let all: f64 = ranked.iter().map(|&c| people(c)).sum();
    let mut held = 0.;
    for (taken, &c) in ranked.iter().rev().enumerate() {
        if held >= share * all {
            return ranked.len() - taken;
        }
        held += people(c);
    }
    0
}
/// The ground a sponsor reads when it plans a circuit: how firmly each cell is occupied,
/// the city's cells in that order, and where among them the town it plans against begins.
struct Rings {
    pressure: Vec<f64>,
    ranked: Vec<usize>,
    from: usize,
    positions: Vec<Position>,
}
impl Rings {
    /// The ground of the town that held `share` of today's people. An earlier era's
    /// smaller town is read again at its own grain, so its circuit follows the shape of
    /// the old core and not the whole city's.
    fn about(city: &City, occupied: &[f64], share: f64) -> io::Result<Self> {
        let mesh = city.mesh;
        let reach = |area: f64| (area.sqrt() * 0.055).max(2. * mesh.spacing());
        let mut pressed = pressure(city, occupied, reach(city.area));
        let mut order = ranked(city, &pressed)?;
        let mut from = outside(city, &order, share);
        if from > 0 {
            let town = city.area * (order.len() - from) as f64 / order.len() as f64;
            pressed = pressure(city, occupied, reach(town));
            order = ranked(city, &pressed)?;
            from = outside(city, &order, share);
        }
        Ok(Self {
            pressure: pressed,
            ranked: order,
            from,
            positions: (0..mesh.len()).map(|c| pos(position(mesh, c))).collect(),
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
        Some(self.pressure[self.ranked[at.min(last)]])
    }
}

/// The best circuit a sponsor finds for the town it plans against, among the rings its
/// order considers, each tightened by `tighten`.
fn best_circuit(
    city: &City,
    occupied: &[f64],
    old: &[Wall],
    planned: &Planned,
    tighten: f64,
) -> io::Result<Option<Wall>> {
    let rings = Rings::about(city, occupied, planned.share)?;
    let mut best: Option<(f64, Wall)> = None;
    for fraction in ring_shares(tighten) {
        let Some(level) = rings.level(fraction) else {
            break;
        };
        let Some(shape) = (city.contour)(&rings.pressure, level.max(f64::EPSILON))? else {
            continue;
        };
        for poly in parts(&shape) {
            let found = proposal(city, poly, (&rings, old), planned)?;
            trace_choice(planned, fraction, found.as_ref());
            best = better(best, found, planned.least.max(0.12));
        }
    }
    Ok(best.map(|(_, wall)| wall))
}
/// One circuit a sponsor weighed, written to the server log when `ATLAS_TRACE_CITY` is
/// set: the era that weighed it, the ring, what it was worth and what it had to be.
fn trace_choice(planned: &Planned, ring: f64, found: Option<&(f64, Wall)>) {
    if std::env::var_os("ATLAS_TRACE_CITY").is_none() {
        return;
    }
    eprintln!(
        "{}",
        serde_json::json!({ "event": "city.wall-choice", "details": {
            "era": planned.era,
            "round": planned.round,
            "ring": ring,
            "worth": found.map(|(worth, _)| worth),
            "least": planned.least.max(0.12),
            "areaKm2": found.map(|(_, wall)| wall.area / 1e6),
            "work": found.map(|(_, wall)| wall.sections.iter().map(|s| s.cost).sum::<f64>().round()),
        }})
    );
}
/// The circuit worth more of two, where the newcomer is worth more than `least`.
fn better(
    best: Option<(f64, Wall)>,
    found: Option<(f64, Wall)>,
    least: f64,
) -> Option<(f64, Wall)> {
    match (best, found) {
        (Some(best), Some(found)) if found.0 > best.0 && found.0 > least => Some(found),
        (None, Some(found)) if found.0 > least => Some(found),
        (best, _) => best,
    }
}

/// The walls of the town's earlier eras as this round's city tells them, oldest first.
/// Each era's town stood on the most crowded of today's ground, as much of it as now
/// holds that era's share of today's people. Its sponsor weighed rings about that town as today's sponsor does about the
/// city, and raised the best one if, threatened as that era left the town, it was worth
/// the work; it had that era's share of today's means and the whole era to build in.
/// The past is told again each round: where an old wall stands people gather behind it,
/// the crowded ground it was drawn round sharpens, and the next telling follows.
fn tell_past(city: &City, sponsors: &Sponsors, means: &Means) -> io::Result<Vec<Wall>> {
    let mut walls = Vec::new();
    for era in 0..sponsors.last() {
        let share = sponsors.share(era);
        if share <= 0. {
            continue;
        }
        let planned = Planned {
            share,
            round: 0,
            era: Some(&sponsors.eras[era].0),
            least: sponsors.least(era),
        };
        let tighten = sponsors.citadel;
        if let Some(mut wall) = best_circuit(city, &means.occupied, &walls, &planned, tighten)? {
            fund(city.fields, &mut wall, means.capacity * share);
            walls.push(wall);
        }
    }
    Ok(walls)
}

/// Whether the town of `era` kept the wall at `index`: threatened as the era left it,
/// the wall was worth keeping, no newer wall had taken its place, and today the city
/// has not outgrown it.
fn kept(walls: &[Wall], index: usize, sponsors: &Sponsors, era: usize) -> bool {
    let wall = &walls[index];
    let superseded = walls[index + 1..]
        .iter()
        .any(|newer| sponsors.era_of(newer) <= era);
    sponsors.keeps(era, wall.worth) && !superseded && (era < sponsors.last() || !wall.outgrown)
}
/// The eras since a wall was raised in which nobody kept it.
fn unkept(walls: &[Wall], index: usize, sponsors: &Sponsors) -> usize {
    (sponsors.era_of(&walls[index]) + 1..=sponsors.last())
        .filter(|&era| !kept(walls, index, sponsors, era))
        .count()
}

/// The length of wall that stands or falls as one, in metres.
const STRETCH: f64 = 240.;
/// Where the stretch beginning at `start` ends.
fn stretch_end(sections: &[Section], start: usize) -> usize {
    let mut length = 0.;
    let mut end = start;
    while end < sections.len() && length < STRETCH {
        length += distance(sections[end].ends[0], sections[end].ends[1]);
        end += 1;
    }
    end
}
/// Lets fall the stretches of a wall that `eras` unkept eras have cost it. Each stretch
/// has its own chance; the ground about it sets how likely that chance is to take it, so
/// later rounds only add to what has fallen as the city presses closer.
fn decay(city: &City, fortune: f64, index: usize, wall: &mut Wall, eras: usize) {
    let (mut start, mut number) = (0, 0);
    while start < wall.sections.len() {
        let end = stretch_end(&wall.sections, start);
        let stretch = &mut wall.sections[start..end];
        let loss = stretch
            .iter()
            .map(|s| {
                let x = city.fields.claims[s.cell];
                walls::era_loss(x.built, x.ruin)
            })
            .sum::<f64>()
            / stretch.len() as f64;
        if walls::stretch_chance(fortune, index, number) < walls::lost_after(loss, eras) {
            for s in stretch {
                s.disused = s.disused.max(s.built);
            }
        }
        start = end;
        number += 1;
    }
}

/// Resolves how each wall stands today. A wall is outgrown when it holds too small a
/// share of the people it is measured against; a wall of an earlier era loses stretches
/// for each era nobody kept it.
fn age(city: &City, sponsors: &Sponsors, walls: &mut [Wall], measured: f64) {
    for index in 0..walls.len() {
        let residents: f64 = walls[index]
            .inside
            .iter()
            .map(|&c| city.fields.claims[c as usize].people * city.mesh.area(c as usize) / 1e6)
            .sum();
        let wall = &mut walls[index];
        wall.outgrown |= wall.round < city.round && residents < 0.45 * measured;
        let eras = unkept(walls, index, sponsors);
        if walls[index].inherited() && eras > 0 {
            decay(city, sponsors.fortune, index, &mut walls[index], eras);
        }
    }
}

fn wanting(s: &Section) -> bool {
    s.built < s.cost || s.repaired < s.disused
}
/// Spends on one section: first what has fallen, then what was never built.
fn work(s: &mut Section, mut budget: f64) -> f64 {
    let repair = budget.min((s.disused - s.repaired).max(0.));
    s.repaired += repair;
    budget -= repair;
    let add = budget.min((s.cost - s.built).max(0.));
    s.built += add;
    budget - add
}
/// Spends `budget` on a wall's unbuilt and fallen sections, the most useful first and
/// then along the line from work already standing. Returns what is left.
fn fund(fields: &CityFields, w: &mut Wall, mut budget: f64) -> f64 {
    let mut bids = crate::hpc::KeyedHeap::new(
        [crate::hpc::Direction::Descending],
        crate::hpc::Direction::Ascending,
    );
    let benefits: Vec<_> = w
        .sections
        .iter()
        .map(|s| {
            let x = fields.claims[s.cell];
            (1. + fields.access[s.cell] + x.built) / (1. + x.ruin)
        })
        .collect();
    let n = w.sections.len();
    for (i, s) in w.sections.iter().enumerate() {
        if wanting(s) {
            let adjacent =
                w.sections[(i + n - 1) % n].built > 0. || w.sections[(i + 1) % n].built > 0.;
            bids.push(i as u32, [benefits[i] * (1. + 2. * f64::from(adjacent))]);
        }
    }
    while let Some((i, _)) = bids.pop() {
        if budget <= 0. {
            break;
        }
        let i = i as usize;
        if !wanting(&w.sections[i]) {
            continue;
        }
        budget = work(&mut w.sections[i], budget);
        for j in [(i + n - 1) % n, (i + 1) % n] {
            if w.sections[j].built < w.sections[j].cost {
                bids.push(j as u32, [3. * benefits[j]]);
            }
        }
    }
    budget
}
/// Whether today's sponsor works on this wall: its own circuit, or an earlier era's
/// wall it still keeps. A wall the city has outgrown is history.
fn tended(walls: &[Wall], index: usize, sponsors: &Sponsors) -> bool {
    let wall = &walls[index];
    !wall.outgrown && (!wall.inherited() || kept(walls, index, sponsors, sponsors.last()))
}
/// Spends this round's work on the walls today's sponsor tends, in the order they were
/// raised, and draws every wall's standing lines.
fn tend(city: &City, sponsors: &Sponsors, walls: &mut [Wall], mut budget: f64) {
    for index in 0..walls.len() {
        if tended(walls, index, sponsors) {
            budget = fund(city.fields, &mut walls[index], budget);
        }
        walls[index].lines = walls[index]
            .sections
            .iter()
            .filter_map(Section::standing)
            .collect();
    }
}

/// The wall work one supporter gives in a year, in metres of plain wall.
const YEAR_WORK: f64 = 0.005;
/// What today's sponsor has been charged: all the work on its own circuits, and the
/// repairs it made to earlier eras' walls.
fn charged(wall: &Wall) -> f64 {
    if wall.inherited() {
        wall.sections.iter().map(|s| s.repaired).sum()
    } else {
        wall.funded()
    }
}
/// The work today's sponsor can give this round: nothing before the year of the era in
/// which it begins; from then, what its supporters give in the years the round stands
/// for, within the standing stock not yet spent. A circuit begun in the era's last years
/// is still building when the map is drawn.
fn present_work(city: &City, sponsors: &Sponsors, means: &Means, walls: &[Wall]) -> f64 {
    if city.round < sponsors.begins(city.rounds) {
        return 0.;
    }
    let spent: f64 = walls.iter().map(charged).sum();
    let years = city
        .rounds
        .get(city.round.saturating_sub(1))
        .copied()
        .unwrap_or(0.);
    (means.capacity - spent)
        .max(0.)
        .min(means.supporters * YEAR_WORK * years)
}

/// The share of a circuit's work that must be done before its sponsor stops reconsidering
/// its line.
const WELL_BEGUN: f64 = 0.5;
/// The line a sponsor may still redraw this round: its newest circuit, if that is its
/// own era's, in use, unfinished and not yet well begun. The city gathers and shifts
/// between rounds, and a line drawn before it gathered should not bind it. A wall the
/// city has outgrown, or one an earlier era raised, is history and is never redrawn.
fn redrawn(walls: &mut Vec<Wall>) -> Option<Wall> {
    let unsettled = walls.last().is_some_and(|wall| {
        let whole: f64 = wall.sections.iter().map(|s| s.cost).sum();
        !wall.inherited()
            && !wall.outgrown
            && wall.unfinished()
            && wall.funded() < WELL_BEGUN * whole
    });
    if unsettled {
        walls.pop()
    } else {
        None
    }
}
/// Moves the work done on a line its sponsor has redrawn onto the new line, section by
/// section, so redrawing loses no work and the work stays charged to the sponsor.
fn carry_work(from: &Wall, onto: &mut Wall) {
    let mut work = from.funded();
    for section in &mut onto.sections {
        let done = work.min((section.cost - section.built).max(0.));
        section.built += done;
        work -= done;
    }
}
/// The shares of a town's ground whose pressure contours a sponsor considers as rings.
/// A civic order's citadel above one draws every ring in round more crowded ground.
fn ring_shares(tighten: f64) -> [f64; 3] {
    let usual = [0.32, 0.56, 0.76];
    if tighten <= 1. {
        return usual;
    }
    usual.map(|share| 1. - (1. - share) / tighten)
}
/// Today's sponsor chooses its circuit: a new one once its earlier work is finished,
/// or the line this round's city calls for in place of one barely begun.
fn choose_enclosure(
    city: &City,
    sponsors: &Sponsors,
    means: &Means,
    walls: &mut Vec<Wall>,
) -> io::Result<()> {
    let earlier = redrawn(walls);
    let ready = walls
        .iter()
        .filter(|w| !w.inherited() && !w.outgrown)
        .all(|w| !w.unfinished());
    if !ready {
        walls.extend(earlier);
        return Ok(());
    }
    let planned = Planned {
        share: 1.,
        round: city.round,
        era: sponsors.eras.last().map(|(era, _)| era.as_str()),
        least: sponsors.least(sponsors.last()),
    };
    let best = best_circuit(city, &means.occupied, walls, &planned, sponsors.citadel)?;
    // The line this round's city calls for replaces one barely begun and takes over
    // the work done on it; with no line to draw this round, the earlier one stands.
    match (best, earlier) {
        (Some(mut wall), Some(earlier)) => {
            carry_work(&earlier, &mut wall);
            walls.push(wall);
        }
        (Some(wall), None) | (None, Some(wall)) => walls.push(wall),
        (None, None) => {}
    }
    Ok(())
}

/// One round of the city's walls. The town's past is told from this round's city: the
/// walls its earlier eras found worth raising. Today's sponsor then chooses and builds
/// what this era's threat makes worth the work; every wall is judged outgrown or not,
/// loses what unkept eras cost it, and is repaired where today's sponsor still keeps it.
/// Walls draw people and works behind them before the next round, so each round's
/// telling starts from a city the last one shaped.
// owner-direction(2026-11-28): a wall enclosing twice the built ground is acceptable only when that is not always the case; sometimes there are interior walls, no walls, half decayed walls or several walls
pub(super) fn raise(city: &City, sponsors: &Sponsors, walls: Vec<Wall>) -> io::Result<Vec<Wall>> {
    let means = means(city);
    let own = walls.into_iter().filter(|w| !w.inherited());
    let mut walls = tell_past(city, sponsors, &means)?;
    walls.extend(own);
    let budget = present_work(city, sponsors, &means, &walls);
    if budget > 0. {
        choose_enclosure(city, sponsors, &means, &mut walls)?;
    }
    age(
        city,
        sponsors,
        &mut walls,
        means.supporters / sponsors.citadel.max(1.),
    );
    tend(city, sponsors, &mut walls, budget);
    trace(city, sponsors, &means, budget, &walls);
    Ok(walls)
}

/// The round's wall decisions, written to the server log when `ATLAS_TRACE_CITY` is set.
fn trace(city: &City, sponsors: &Sponsors, means: &Means, budget: f64, walls: &[Wall]) {
    if std::env::var_os("ATLAS_TRACE_CITY").is_none() {
        return;
    }
    let threats: Vec<_> = (0..=sponsors.last())
        .map(|era| sponsors.threat(era))
        .collect();
    let told: Vec<_> = walls
        .iter()
        .enumerate()
        .map(|(index, wall)| {
            serde_json::json!({
                "era": wall.era,
                "round": wall.round,
                "areaKm2": wall.area / 1e6,
                "worth": wall.worth,
                "work": wall.sections.iter().map(|s| s.cost).sum::<f64>().round(),
                "funded": wall.funded().round(),
                "standing": wall.standing_share(),
                "outgrown": wall.outgrown,
                "unkeptEras": unkept(walls, index, sponsors),
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
            "threats": threats,
            "begins": sponsors.begins(city.rounds),
            "citadel": sponsors.citadel,
            "supporters": means.supporters.round(),
            "capacity": means.capacity.round(),
            "budget": budget.round(),
            "walls": told,
        }})
    );
}

/// The town's record as its wall sponsors read it: the eras its history tells of, the
/// odds its site, standing and civic order give that an era moves it to wall, and its
/// roll.
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
        spatial: state.spatial.as_ref(),
        fields: &u.fields,
        capital: &capital,
        firm: &firm,
        area: state
            .spatial
            .area(state.scope.settled_outline())
            .map_err(io::Error::other)?,
        round: r.round,
        rounds: &crate::field::refinement::people::DEVELOPMENT_EXPOSURE,
        contour: &|values, level| contour(state, values, level),
    };
    raise(&city, &sponsors(state, readiness)?, r.city.walls.clone())
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod bench;

#[cfg(test)]
mod tests {
    use super::*;

    fn circuit(built: [f64; 4]) -> Wall {
        Wall {
            round: 1,
            inside: vec![0],
            sections: built
                .map(|built| Section {
                    ends: [[0., 0.], [100., 0.]],
                    cell: 0,
                    cost: 100.,
                    built,
                    disused: 0.,
                    repaired: 0.,
                })
                .to_vec(),
            ..Default::default()
        }
    }

    #[test]
    fn a_sponsor_redraws_a_line_barely_begun_and_keeps_one_well_begun() {
        // A finished old wall and a new line with a tenth of its work done: the new line
        // may be redrawn, the old wall stays.
        let mut walls = vec![circuit([100.; 4]), circuit([40., 0., 0., 0.])];
        assert!(redrawn(&mut walls).is_some());
        assert_eq!(walls.len(), 1);
        // A line more than half built binds its sponsor.
        let mut walls = vec![circuit([100., 100., 35., 0.])];
        assert!(redrawn(&mut walls).is_none());
        assert_eq!(walls.len(), 1);
        // A finished wall is never redrawn, and a city with none has none to redraw.
        assert!(redrawn(&mut vec![circuit([100.; 4])]).is_none());
        assert!(redrawn(&mut Vec::new()).is_none());
        // A wall the city has outgrown is history, however little of it was built, and
        // so is one an earlier era left unfinished.
        let mut old = circuit([40., 0., 0., 0.]);
        old.outgrown = true;
        assert!(redrawn(&mut vec![old]).is_none());
        let mut past = circuit([40., 0., 0., 0.]);
        past.round = 0;
        assert!(redrawn(&mut vec![past]).is_none());
    }

    #[test]
    fn a_redrawn_line_takes_over_the_work_done_on_the_earlier_one() {
        // Each round a sponsor can fund fifteen parts in a hundred of a line. Redrawing
        // the line every round still builds it, and nothing done is lost or refunded.
        let mut line = circuit([0.; 4]);
        for round in 1..=4 {
            let mut walls = vec![line];
            let earlier = redrawn(&mut walls);
            let mut next = circuit([0.; 4]);
            if let Some(earlier) = &earlier {
                carry_work(earlier, &mut next);
            }
            line = earlier.map_or_else(|| walls.pop().unwrap(), |_| next);
            // This round's funds.
            let section = line.sections.iter_mut().find(|s| s.built < s.cost).unwrap();
            section.built += 60.;
            assert_eq!(line.funded(), 60. * f64::from(round));
        }
        // After the fourth round more than half stands, so the sponsor keeps that line.
        assert!(redrawn(&mut vec![line]).is_none());
    }

    #[test]
    fn a_citadel_draws_its_rings_round_more_crowded_ground() {
        assert_eq!(ring_shares(1.), [0.32, 0.56, 0.76]);
        // Twice the citadel halves the ground left outside each ring's level.
        let tight = ring_shares(2.);
        assert!((tight[0] - 0.66).abs() < 1e-12 && (tight[2] - 0.88).abs() < 1e-12);
        assert!(tight
            .iter()
            .zip(ring_shares(1.))
            .all(|(tight, usual)| *tight > usual));
        // An order that builds no citadel leaves the rings as they were.
        assert_eq!(ring_shares(0.5), ring_shares(1.));
    }
}
