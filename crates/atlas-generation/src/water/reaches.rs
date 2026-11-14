//! Retained reach records and their derived cell index, ported from water/reaches.ts.
use super::balance::MONTHS;
use std::{cell::OnceCell, rc::Rc};

#[derive(Clone, Debug, PartialEq)]
pub struct FormerCourse {
    pub cells: Vec<usize>,
    pub left_in: f64,
}
#[derive(Clone)]
pub struct Reach {
    pub(super) id: usize,
    pub(super) cells: Vec<usize>,
    pub(super) downstream: Option<usize>,
    pub(super) order: u16,
    pub(super) flow: f64,
    pub(super) least: f64,
    pub(super) flood: f64,
    pub(super) months: usize,
    pub(super) dry: bool,
    pub(super) drawn: bool,
    pub(super) dried_in: Option<f64>,
    pub(super) former: Vec<FormerCourse>,
    pub(super) monthly: Vec<f64>,
    pub(super) catchment: Vec<f64>,
    pub(super) bed: Vec<f64>,
    pub(super) width: Vec<f64>,
    pub(super) depth: Vec<f64>,
    pub(super) leakage: Vec<f64>,
    pub(super) river: Option<String>,
    pub(super) record: Option<String>,
    pub(super) name: Option<String>,
}
impl Reach {
    pub fn id(&self) -> usize {
        self.id
    }
    pub fn cells(&self) -> &[usize] {
        &self.cells
    }
    pub fn downstream(&self) -> Option<usize> {
        self.downstream
    }
    pub fn order(&self) -> u16 {
        self.order
    }
    pub fn flow(&self) -> f64 {
        self.flow
    }
    pub fn least(&self) -> f64 {
        self.least
    }
    pub fn flood(&self) -> f64 {
        self.flood
    }
    pub fn months(&self) -> usize {
        self.months
    }
    pub fn dry(&self) -> bool {
        self.dry
    }
    pub fn drawn(&self) -> bool {
        self.drawn
    }
    pub fn dried_in(&self) -> Option<f64> {
        self.dried_in
    }
    pub fn former(&self) -> &[FormerCourse] {
        &self.former
    }
    pub fn monthly(&self) -> &[f64] {
        &self.monthly
    }
    pub fn catchment(&self) -> &[f64] {
        &self.catchment
    }
    pub fn bed(&self) -> &[f64] {
        &self.bed
    }
    pub fn width(&self) -> &[f64] {
        &self.width
    }
    pub fn depth(&self) -> &[f64] {
        &self.depth
    }
    pub fn leakage(&self) -> &[f64] {
        &self.leakage
    }
    pub fn river(&self) -> Option<&str> {
        self.river.as_deref()
    }
    pub fn record(&self) -> Option<&str> {
        self.record.as_deref()
    }
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
    pub fn months_at(&self, at: usize) -> usize {
        self.monthly
            .iter()
            .skip(at * MONTHS)
            .take(MONTHS)
            .filter(|&&flow| flow > 0.0)
            .count()
    }
    pub fn regime(&self) -> Regime {
        if self.dry || self.months == 0 {
            Regime::Dry
        } else if self.months >= MONTHS {
            Regime::Perennial
        } else {
            Regime::Seasonal
        }
    }
    pub(super) fn new(id: usize, cells: Vec<usize>) -> Self {
        let count = cells.len();
        Self {
            id,
            cells,
            downstream: None,
            order: 1,
            flow: 0.0,
            least: 0.0,
            flood: 0.0,
            months: 0,
            dry: false,
            drawn: false,
            dried_in: None,
            former: Vec::new(),
            monthly: vec![0.0; count * MONTHS],
            catchment: vec![0.0; count],
            bed: vec![0.0; count],
            width: vec![0.0; count],
            depth: vec![0.0; count],
            leakage: vec![0.0; count],
            river: None,
            record: None,
            name: None,
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
pub enum Regime {
    Perennial,
    Seasonal,
    Dry,
}
#[derive(Clone)]
pub struct BoundaryEntry {
    pub cell: usize,
    pub monthly: [f64; MONTHS],
    pub catchment: f64,
}

/// Public readers receive shared records and slices, never mutable profile arrays.
/// ```compile_fail
/// use atlas_generation::water::reaches::ReachStore;
/// fn mutate(store: &mut ReachStore) { store.get(1).unwrap().monthly[0] = 20.0; }
/// ```
#[derive(Clone)]
pub struct ReachStore {
    // Stable monotonically allocated IDs also preserve the source Map's insertion order.
    records: Vec<Option<Reach>>,
    index: OnceCell<Rc<ReachIndex>>,
    pub(super) entries: Vec<BoundaryEntry>,
}
impl Default for ReachStore {
    fn default() -> Self {
        Self {
            records: vec![None],
            index: OnceCell::new(),
            entries: Vec::new(),
        }
    }
}
impl ReachStore {
    pub fn get(&self, id: usize) -> Option<&Reach> {
        self.records.get(id).and_then(Option::as_ref)
    }
    pub fn reaches(&self) -> impl Iterator<Item = &Reach> {
        self.records.iter().flatten()
    }
    pub fn entries(&self) -> &[BoundaryEntry] {
        &self.entries
    }
    pub fn next(&self) -> usize {
        self.records.len()
    }
    pub fn add(&mut self, cells: Vec<usize>) -> usize {
        let id = self.next();
        self.records_mut().push(Some(Reach::new(id, cells)));
        id
    }
    pub(super) fn get_mut(&mut self, id: usize) -> Option<&mut Reach> {
        self.records_mut().get_mut(id).and_then(Option::as_mut)
    }
    /// Every mutable record access invalidates the derived preference and position index.
    pub(super) fn records_mut(&mut self) -> &mut Vec<Option<Reach>> {
        self.index.take();
        &mut self.records
    }
    pub fn cell_index(&self) -> Rc<ReachIndex> {
        self.index
            .get_or_init(|| Rc::new(self.build_cell_index()))
            .clone()
    }
    fn build_cell_index(&self) -> ReachIndex {
        let size = self
            .reaches()
            .flat_map(|reach| &reach.cells)
            .max()
            .map_or(0, |cell| cell + 1);
        let mut index = ReachIndex {
            ids: vec![0; size],
            along: vec![0; size],
        };
        for reach in self.reaches() {
            for (at, &cell) in reach.cells.iter().enumerate() {
                if self
                    .get(index.ids[cell])
                    .is_none_or(|held| preferred(reach, at, held, index.along[cell]))
                {
                    index.ids[cell] = reach.id;
                    index.along[cell] = at;
                }
            }
        }
        index
    }
}
fn preferred(candidate: &Reach, at: usize, held: &Reach, held_at: usize) -> bool {
    let rank = |reach: &Reach, position| {
        (
            !(reach.dry || reach.months_at(position) == 0),
            !reach.dry,
            reach.order,
            std::cmp::Reverse(reach.id),
        )
    };
    rank(candidate, at) > rank(held, held_at)
}
pub struct ReachIndex {
    ids: Vec<usize>,
    along: Vec<usize>,
}
impl ReachIndex {
    pub fn get<'a>(&self, store: &'a ReachStore, cell: usize) -> Option<&'a Reach> {
        self.ids.get(cell).and_then(|id| store.get(*id))
    }
    pub fn position(&self, cell: usize) -> Option<usize> {
        self.along.get(cell).copied()
    }
}
