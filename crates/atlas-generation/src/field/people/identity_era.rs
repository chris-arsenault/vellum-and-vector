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
    Ok(())
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
    use super::Pressures;

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
