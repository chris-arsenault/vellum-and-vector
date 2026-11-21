use super::{
    country,
    identity_reads::{leading_all, Leading},
    questions::Questions,
    reach::{Passage, REACH_SWEEPS},
    traditions::{self, Founding, Kind, Position},
    travel::Travel,
    work::{habitable, km2, working},
};
use crate::{
    execution::{Command, CommandContext, CommandKind, ExecutionResult},
    field::Field,
    hpc::{Direction, KeyedHeap},
    human::{
        catalogue::LayerId,
        identity::Tradition,
        operations::{self, Overlay},
        HumanField,
    },
    links::Offers,
    spatial::SpatialKernel,
    storage::{Band, ReadBand},
};
use atlas_map::{Geometry, Position as Point};
use std::{cell::RefCell, io, rc::Rc};

pub struct Era {
    pub memory: Rc<RefCell<traditions::Context>>,
    pub era: String,
    pub years: f64,
    pub mobility: f64,
    pub founders: usize,
    pub going: Rc<Passage>,
    pub friction: ReadBand<f64>,
    pub climbing: ReadBand<f64>,
    pub rivers: Rc<ReadBand<u32>>,
    pub links: Rc<Offers<Field>>,
}
impl Era {
    pub fn travel<'a>(&self, field: &'a Field) -> io::Result<Travel<'a>> {
        Travel::new(
            field,
            self.friction.clone(),
            self.climbing.clone(),
            self.rivers.clone(),
        )
    }
}
pub fn place(field: &Field, cell: usize) -> Position {
    let origin = field.mesh.origin();
    let point = field.mesh.position(cell);
    Position {
        x: origin[0] + point[0],
        y: origin[1] + point[1],
    }
}
pub fn apart(field: &Field, a: usize, b: usize) -> f64 {
    let a = field.mesh.position(a);
    let b = field.mesh.position(b);
    field.mesh.delta_x(a[0] - b[0]).hypot(a[1] - b[1])
}
fn origins(field: &Field, wanted: usize) -> io::Result<Vec<usize>> {
    let mut lived = KeyedHeap::new([Direction::Descending], Direction::Ascending);
    let mut land = 0.0;
    for cell in 0..field.mesh.len() {
        if !habitable(field, cell)? {
            continue;
        }
        land += field.mesh.area(cell);
        let people = field.people.people(cell)?;
        if people > 0.0 {
            lived.push(cell as u32, [people * km2(field, cell)]);
        }
    }
    let spacing = (land / wanted.max(1) as f64).sqrt() / 2.0;
    let mut chosen = Vec::new();
    while chosen.len() < wanted {
        let Some((cell, _)) = lived.pop() else {
            break;
        };
        let cell = cell as usize;
        if chosen
            .iter()
            .all(|&other| apart(field, cell, other) >= spacing)
        {
            chosen.push(cell);
        }
    }
    Ok(chosen)
}
fn founding_codes(field: &Field, era: &Era, began: &[usize]) -> io::Result<Vec<[i32; 3]>> {
    let mut memory = era.memory.borrow_mut();
    let mut peoples = Vec::new();
    for &cell in began {
        let founding = |kind, tongue| Founding {
            kind,
            key: format!("origin:{cell}"),
            origin: place(field, cell),
            era: era.era.clone(),
            parent: None,
            tongue,
        };
        let tongue = memory.found(founding(Kind::Tongue, None))?;
        let faith = memory.found(founding(Kind::Faith, Some(tongue)))?;
        let custom = memory.found(founding(Kind::Custom, Some(tongue)))?;
        peoples.push([tongue, faith, custom]);
    }
    Ok(peoples)
}
fn points(field: &Field, origins: &[usize]) -> Vec<Geometry> {
    let shifts = field
        .mesh
        .periodic_width()
        .map(|w| vec![0.0, -w, w])
        .unwrap_or_else(|| vec![0.0]);
    shifts
        .into_iter()
        .flat_map(|dx| {
            origins.iter().map(move |&cell| {
                let p = field.mesh.position(cell);
                Geometry::Point {
                    coordinates: Point::xy(p[0] + dx, p[1]),
                }
            })
        })
        .collect()
}
fn found(
    context: &mut CommandContext<'_, Field>,
    era: &Era,
    owner: &operations::Operations<Field>,
    spatial: &dyn SpatialKernel,
) -> ExecutionResult<()> {
    if era
        .memory
        .borrow()
        .traditions
        .known
        .iter()
        .any(|t| t.kind != Kind::Allegiance)
    {
        return Ok(());
    }
    let field = context.state();
    let began = origins(field, era.founders)?;
    if began.is_empty() {
        return Ok(());
    }
    let peoples = founding_codes(field, era, &began)?;
    let travel = era.travel(field)?;
    let reached = country::spread(
        field,
        &began,
        &|a, b| travel.step(a, b),
        f64::INFINITY,
        None,
        &era.links,
    )?;
    let geometries = points(field, &began);
    let index = spatial.index(&geometries).map_err(io::Error::other)?;
    let mut taken: [Band<i32>; 3] =
        std::array::from_fn(|_| field.coverage.borrow_mut().scratch(field.mesh.len(), 0));
    for (cell, &owner) in reached.owner.iter().enumerate().take(field.mesh.len()) {
        if field.people.people(cell)? <= 0.0 {
            continue;
        }
        let from = if owner >= 0 {
            owner as usize
        } else {
            let p = field.mesh.position(cell);
            index
                .nearest(Point::xy(p[0], p[1]))
                .map_err(io::Error::other)?
                .ok_or_else(|| {
                    io::Error::other("Founding origins are missing from spatial index")
                })?
                % began.len()
        };
        for (band, code) in taken.iter_mut().zip(peoples[from]) {
            band.set(cell, code)?;
        }
    }
    let traditions = std::array::from_fn(|i| taken.get(i).map(Band::read_only));
    let people = field.people.view(HumanField::Layer(LayerId::Population));
    context.run(
        &owner.overlay,
        &Overlay {
            traditions,
            people,
            hardness: 0.0,
        },
    )
}
/// Contacts hold at most the three strongest other traditions a cell feels over the reach.
struct Contacts {
    code: Vec<i32>,
    taking: Vec<f64>,
    counts: Vec<usize>,
    most: usize,
}
fn order_contacts(codes: &mut [i32; 3], press: &mut [f64; 3], count: usize) {
    for a in 0..count {
        for b in a + 1..count {
            if codes[b] < codes[a] {
                codes.swap(a, b);
                press.swap(a, b);
            }
        }
    }
}
/// How many other traditions' pressures a cell carries on through the reach.
const OTHERS: usize = 3;
/// The tradition pressures a cell feels over the travel reach: its own tradition's, which
/// always keeps its place and is what the cell resists with, and the strongest others.
#[derive(Clone, Copy)]
pub struct Pressures {
    own: (i32, f64),
    others: [(i32, f64); OTHERS],
}
impl Pressures {
    fn new(own: i32, mass: f64) -> Self {
        Self {
            own: (own, if own == 0 { 0.0 } else { mass.max(0.0) }),
            others: [(0, 0.0); OTHERS],
        }
    }
    /// Adds `value` of tradition `code`: to the cell's own, or to the strongest others.
    pub fn carry(&mut self, code: i32, value: f64) {
        if code == 0 || value <= 0.0 {
            return;
        }
        if code == self.own.0 {
            self.own.1 += value;
            return;
        }
        if let Some(slot) = self.others.iter_mut().find(|(c, _)| *c == code) {
            slot.1 += value;
            return;
        }
        let weakest = (0..OTHERS).fold(0, |w, i| {
            if self.others[i].1 < self.others[w].1 {
                i
            } else {
                w
            }
        });
        if self.others[weakest].0 == 0 || value > self.others[weakest].1 {
            self.others[weakest] = (code, value);
        }
    }
    fn take(&mut self, from: &Self, passed: f64) {
        self.carry(from.own.0, from.own.1 * passed);
        for &(code, value) in &from.others {
            self.carry(code, value * passed);
        }
    }
}
/// Each tradition's pressure, as people carry it along the going: every crowd's leading
/// tradition, passed on over the travel reach through any ground travel allows, so tongues and
/// faiths reach across straits and along ways and not only between touching cells.
fn carried(field: &Field, going: &Passage, leading: &Leading) -> io::Result<Vec<Pressures>> {
    let source: Vec<Pressures> = (0..field.mesh.len())
        .map(|cell| Pressures::new(leading.code[cell], leading.people[cell] * km2(field, cell)))
        .collect();
    going.reach_each(&field.mesh, &source, REACH_SWEEPS, Pressures::take)
}
fn felt(field: &Field, going: &Passage, leading: &Leading, rate: f64) -> io::Result<Contacts> {
    let mut result = Contacts {
        code: vec![0; field.mesh.len() * 3],
        taking: vec![0.0; field.mesh.len() * 3],
        counts: vec![0; field.mesh.len()],
        most: 0,
    };
    let reached = carried(field, going, leading)?;
    for (cell, carried_here) in reached.iter().enumerate() {
        let people = field.people.people(cell)?;
        if people * km2(field, cell) <= 0.0 {
            continue;
        }
        // A cell resists with its own tradition as felt over the same reach as its contacts,
        // so a crowd deep in its own country is not swamped by its neighbours' sum.
        let own = carried_here.own.1.max(people * km2(field, cell));
        let mut codes = [0; 3];
        let mut press = [0.0; 3];
        let mut count = 0;
        for &(code, value) in &carried_here.others {
            if code == 0 || value <= 0.0 {
                continue;
            }
            codes[count] = code;
            press[count] = value;
            count += 1;
        }
        let all: f64 = press.iter().sum();
        if all <= 0.0 {
            continue;
        }
        // Sort three packed slots by tradition code, preserving all simultaneous pressures.
        order_contacts(&mut codes, &mut press, count);
        result.counts[cell] = count;
        result.most = result.most.max(count);
        for at in 0..count {
            result.code[cell * 3 + at] = codes[at];
            result.taking[cell * 3 + at] = people * rate * press[at] / (all + own);
        }
    }
    Ok(result)
}
fn share(
    context: &mut CommandContext<'_, Field>,
    era: &Era,
    questions: &Questions,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    let rate = (0.15 * era.mobility * era.years / 100.0).min(1.0);
    let fading = context.query(&questions.forgetting)?.values();
    let field = context.state();
    let leading = leading_all(field)?;
    let taken = leading[..3]
        .iter()
        .map(|l| felt(field, &era.going, l, rate))
        .collect::<io::Result<Vec<_>>>()?;
    let mut codes = field.coverage.borrow_mut().scratch(field.mesh.len(), 0i32);
    let mut people = working(field);
    for (tradition, contacts) in [Tradition::Tongue, Tradition::Faith, Tradition::Custom]
        .into_iter()
        .zip(taken)
    {
        for round in 0..contacts.most {
            for cell in 0..context.state().mesh.len() {
                let present = contacts.counts[cell] > round;
                codes.set(
                    cell,
                    if present {
                        contacts.code[cell * 3 + round]
                    } else {
                        0
                    },
                )?;
                people.set(
                    cell,
                    if present {
                        contacts.taking[cell * 3 + round] * fading.get(cell)?
                    } else {
                        0.0
                    },
                )?;
            }
            if tradition == Tradition::Tongue {
                learn(context, owner, &codes, &people)?;
                continue;
            }
            let mut traditions = std::array::from_fn(|_| None);
            traditions[tradition as usize] = Some(codes.read_only());
            context.run(
                &owner.overlay,
                &Overlay {
                    traditions,
                    people: people.read_only(),
                    hardness: 0.0,
                },
            )?;
        }
    }
    forget(context, era, owner)
}
use super::facts::{FORGETTING_YEARS, KEPT_BY_USE, LEARNING};
/// People who meet a tongue learn it before they speak it: most come to know it beside their
/// own, the rest take it up and keep their old tongue as one they know.
fn learn(
    context: &mut CommandContext<'_, Field>,
    owner: &operations::Operations<Field>,
    codes: &Band<i32>,
    reached: &Band<f64>,
) -> ExecutionResult<()> {
    let [speaking, knowing] = learning(context.state(), codes, reached)?;
    context.run(&owner.overlay, &speaking)?;
    context.run(&owner.overlay, &knowing)
}
/// The two overlays a tongue's contact makes, to run in order: those who take up `codes` and
/// keep the tongue their place spoke as one they know, then those who come to know it beside
/// their own tongue. The second leaves the first's new speakers alone, so each of the people
/// reached is counted once. `reached` is how many people per km² the contact reaches.
fn learning(field: &Field, codes: &Band<i32>, reached: &Band<f64>) -> io::Result<[Overlay; 2]> {
    let spoken = leading_all(field)?;
    let mut old = field.coverage.borrow_mut().scratch(field.mesh.len(), 0i32);
    let mut knowing = working(field);
    let mut speaking = working(field);
    for cell in 0..field.mesh.len() {
        old.set(cell, spoken[0].code[cell])?;
        knowing.set(cell, reached.get(cell)? * LEARNING)?;
        speaking.set(cell, reached.get(cell)? * (1.0 - LEARNING))?;
    }
    let mut known = std::array::from_fn(|_| None);
    known[Tradition::Known as usize] = Some(codes.read_only());
    let mut taken_up = std::array::from_fn(|_| None);
    taken_up[Tradition::Tongue as usize] = Some(codes.read_only());
    taken_up[Tradition::Known as usize] = Some(old.read_only());
    Ok([
        Overlay {
            traditions: taken_up,
            people: speaking.read_only(),
            hardness: 0.0,
        },
        Overlay {
            traditions: known,
            people: knowing.read_only(),
            hardness: 0.0,
        },
    ])
}
/// A tongue known where almost no one around speaks it fades over the years.
fn forget(
    context: &mut CommandContext<'_, Field>,
    era: &Era,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    let fading = forgetting(context.state(), era.years, &era.era)?;
    context.run(&owner.overlay, &fading)
}
/// The overlay that fades, over `years`, the tongue each cell's people know where almost no
/// one on and around the cell speaks it.
fn forgetting(field: &Field, years: f64, era: &str) -> io::Result<Overlay> {
    let fading = 1.0 - (-years / FORGETTING_YEARS).exp();
    let mut lost = field.coverage.borrow_mut().scratch(field.mesh.len(), 0i32);
    let mut people = working(field);
    let (mut cells, mut knowing, mut all) = (0, 0.0, 0.0);
    for cell in 0..field.mesh.len() {
        let column = field.people.column(cell)?;
        let (known, holding) = crate::human::identity::leading(&column, Tradition::Known);
        let everyone: f64 = column.iter().map(|layer| layer.people).sum();
        all += everyone * km2(field, cell);
        if known == 0 || everyone <= 0.0 {
            continue;
        }
        cells += 1;
        knowing += holding * km2(field, cell);
        if super::speech::spoken(known, &super::speech::around(field, cell)?) < KEPT_BY_USE {
            lost.set(cell, -1)?;
            people.set(cell, holding * fading)?;
        }
    }
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_some() {
        eprintln!(
            "{}",
            serde_json::json!({"event": "people.tongues", "details": {
                "era": era, "cellsKnowingAnother": cells,
                "shareKnowingAnother": (knowing / all.max(f64::EPSILON) * 1000.0).round() / 1000.0}})
        );
    }
    let mut changes = std::array::from_fn(|_| None);
    changes[Tradition::Known as usize] = Some(lost.read_only());
    Ok(Overlay {
        traditions: changes,
        people: people.read_only(),
        hardness: 0.0,
    })
}
pub struct Operations {
    pub found: Command<Field, Era>,
    pub share: Command<Field, Era>,
}
impl Operations {
    pub fn new(
        questions: Rc<Questions>,
        owner: Rc<operations::Operations<Field>>,
        spatial: Rc<dyn SpatialKernel>,
    ) -> Self {
        let founding = owner.clone();
        Self {
            found: Command::with_inputs(
                "human.identity.found",
                CommandKind::Initialize,
                vec![],
                move |context, era| found(context, era, &founding, spatial.as_ref()),
            ),
            share: Command::with_inputs(
                "human.identity.contact",
                CommandKind::Elapsed,
                vec![],
                move |context, era| share(context, era, &questions, &owner),
            ),
        }
    }
}
pub fn operation(
    questions: Rc<Questions>,
    owner: Rc<operations::Operations<Field>>,
    spatial: Rc<dyn SpatialKernel>,
) -> Command<Field, Era> {
    let parts = Operations::new(questions, owner.clone(), spatial);
    let sunder = super::identity_sunder::operation(owner.clone());
    Command::with_inputs(
        "human.identity.era",
        CommandKind::Elapsed,
        vec![],
        move |context, era: &Era| {
            context.run(&parts.found, era)?;
            context.run(&owner.inherit, &())?;
            context.run(&parts.share, era)?;
            context.run(&sunder, era)?;
            context.run(
                &owner.harden,
                &operations::Harden {
                    years: era.years,
                    settling: 300.0,
                },
            )
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{forgetting, learning, Pressures, FORGETTING_YEARS, LEARNING};
    use crate::{
        execution::Executor,
        field::{people::fixture::*, Field},
        human::{
            identity::{held, Tradition},
            operations::Overlay,
        },
    };

    /// A frontier: speakers of tongue 1 at the middle of the land, beside a neighbour whose
    /// people speak `beside`.
    fn frontier(here: &[crate::human::identity::IdentityLayer], beside: i32) -> (Field, usize) {
        let mut cell = 0;
        let field = land(|seed, mesh| {
            cell = point(mesh, SIDE / 2.0, SIDE / 2.0);
            people(seed, cell, here);
            let next = (0..3).find_map(|e| mesh.neighbor(cell, e)).unwrap();
            people(seed, next, &[layer(300.0, beside, 0, 0, 0)]);
        });
        (field, cell)
    }
    fn applied(field: Field, overlays: Vec<Overlay>) -> Executor<Field> {
        let owner = Field::human_operations();
        let mut run = Executor::new(field);
        for overlay in &overlays {
            run.run_with(&owner.overlay, overlay).unwrap();
        }
        run
    }
    fn holding(field: &Field, cell: usize, tradition: Tradition, code: i32) -> f64 {
        held(&field.people.column(cell).unwrap(), tradition)
            .into_iter()
            .find(|(c, _)| *c == code)
            .map_or(0.0, |(_, people)| people)
    }

    #[test]
    fn a_frontier_keeps_the_tongue_its_neighbours_still_speak() {
        let (field, cell) = frontier(&[layer(100.0, 1, 2, 0, 0)], 2);
        let fading = forgetting(&field, FORGETTING_YEARS, "test").unwrap();
        let run = applied(field, vec![fading]);
        assert!((holding(run.state(), cell, Tradition::Known, 2) - 100.0).abs() < 1e-9);
    }
    #[test]
    fn a_tongue_no_one_around_speaks_fades_with_the_years() {
        let (field, cell) = frontier(&[layer(100.0, 1, 2, 0, 0)], 3);
        let fading = forgetting(&field, FORGETTING_YEARS, "test").unwrap();
        let run = applied(field, vec![fading]);
        let field = run.state();
        let kept = 100.0 * (-1.0f64).exp();
        assert!((holding(field, cell, Tradition::Known, 2) - kept).abs() < 1e-6);
        // Forgetting a second tongue leaves the first.
        assert!((holding(field, cell, Tradition::Tongue, 1) - 100.0).abs() < 1e-9);
    }
    #[test]
    fn contact_teaches_most_a_second_tongue_and_brings_the_rest_to_speak_it() {
        let (field, cell) = frontier(&[layer(100.0, 1, 0, 0, 0)], 2);
        let codes = {
            let mut band = field.coverage.borrow_mut().scratch(field.mesh.len(), 0i32);
            band.set(cell, 2).unwrap();
            band
        };
        let reached = {
            let mut band = field.coverage.borrow_mut().scratch(field.mesh.len(), 0.0);
            band.set(cell, 30.0).unwrap();
            band
        };
        let overlays = learning(&field, &codes, &reached).unwrap();
        let run = applied(field, overlays.into());
        let field = run.state();
        let knowing = holding(field, cell, Tradition::Known, 2);
        let speaking = holding(field, cell, Tradition::Tongue, 2);
        assert!((knowing - 30.0 * LEARNING).abs() < 1e-6, "{knowing}");
        assert!(
            (speaking - 30.0 * (1.0 - LEARNING)).abs() < 1e-6,
            "{speaking}"
        );
        // Those who took up the new tongue keep the old one as known.
        assert!((holding(field, cell, Tradition::Known, 1) - speaking).abs() < 1e-6);
        assert!((holding(field, cell, Tradition::Tongue, 1) - (100.0 - speaking)).abs() < 1e-6);
    }

    #[test]
    fn a_cell_keeps_its_own_tradition_and_the_three_strongest_others() {
        let mut felt = Pressures::new(5, 10.0);
        felt.carry(7, 2.0);
        felt.carry(7, 1.0);
        assert_eq!(
            felt.others.iter().find(|(c, _)| *c == 7).map(|s| s.1),
            Some(3.0)
        );
        for (code, value) in [(1, 50.0), (2, 40.0), (3, 0.5)] {
            felt.carry(code, value);
        }
        // A weak newcomer cannot displace the three strongest; a stronger one takes the weakest.
        assert!(!felt.others.iter().any(|(c, _)| *c == 3));
        felt.carry(9, 4.0);
        assert!(felt.others.iter().any(|(c, _)| *c == 9));
        assert!(!felt.others.iter().any(|(c, _)| *c == 7));
        felt.carry(4, 0.1);
        assert!(!felt.others.iter().any(|(c, _)| *c == 4));
        // Its own tradition is never pushed out, however strong the others.
        felt.carry(5, 1.0);
        assert_eq!(felt.own, (5, 11.0));
        felt.carry(0, 100.0);
        assert!(!felt.others.iter().any(|(c, _)| *c == 0));
    }
}
