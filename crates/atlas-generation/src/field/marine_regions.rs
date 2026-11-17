//! Named seas follow breadth saddles; the classifier does not alter water connectivity.
use super::Field;
use crate::{
    hpc::{Direction, KeyedHeap, SmallIntSet},
    metric::search::physical_distance,
    storage::Band,
    water::column::Store,
};
// hpc-exempt: sparse marine region records keyed by watershed root; cell data use bands.
use std::{collections::BTreeMap, io};
const PASSAGE_BREADTH_RATIO: f64 = 0.5;
const SHALLOW_BREADTH_REDUCTION: f64 = 0.3;
const MINIMUM_PASSAGE_RELIEF_CELLS: f64 = 1.0;
const MINIMUM_REGION_CELLS: f64 = 4.0;
const SUBORDINATE_SEA_RATIO: f64 = 0.25;
const SHALLOW_SEA_SHARE: f64 = 0.5;

#[derive(Clone)]
pub struct Region {
    pub id: usize,
    pub peak: usize,
    pub area: f64,
    pub breadth: f64,
    pub ocean: bool,
}
pub struct Regions {
    pub labels: Band<i32>,
    pub regions: Vec<Region>,
}
fn coastal_breadth(field: &Field) -> io::Result<Band<f64>> {
    let mesh = &field.mesh;
    let kind = field.water().column.kind;
    let mut distance = field.coverage.borrow_mut().allocate(f64::INFINITY);
    let mut seeds = Vec::new();
    for cell in 0..mesh.len() {
        if kind.get(cell)? != 1 {
            distance.set(cell, 0.0)?;
            continue;
        }
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(cell, edge) {
                if kind.get(next)? != 1 {
                    distance.set(
                        cell,
                        distance.get(cell)?.min(mesh.edge_length(cell, edge) / 2.0),
                    )?;
                }
            }
        }
        if distance.get(cell)?.is_finite() {
            seeds.push(cell);
        }
    }
    physical_distance(mesh, seeds, &mut distance, f64::INFINITY, |_, _| Ok(()))?;
    Ok(distance)
}
struct Watershed {
    parent: Band<i32>,
    breadth: Band<f64>,
}
impl Watershed {
    fn root(&mut self, mut cell: usize) -> io::Result<usize> {
        let mut root = cell;
        while self.parent.get(root)? != root as i32 {
            root = self.parent.get(root)? as usize;
        }
        while self.parent.get(cell)? != cell as i32 {
            let next = self.parent.get(cell)? as usize;
            self.parent.set(cell, root as i32)?;
            cell = next;
        }
        Ok(root)
    }
    fn join(&mut self, a: usize, b: usize) -> io::Result<usize> {
        let (mut a, mut b) = (self.root(a)?, self.root(b)?);
        let (wa, wb) = (self.breadth.get(a)?, self.breadth.get(b)?);
        if wa < wb || (wa == wb && a > b) {
            std::mem::swap(&mut a, &mut b);
        }
        self.parent.set(b, a as i32)?;
        Ok(a)
    }
    fn separated(&self, field: &Field, a: usize, b: usize, saddle: usize) -> io::Result<bool> {
        let smaller = if self.breadth.get(a)? < self.breadth.get(b)? {
            a
        } else {
            b
        };
        let narrow = self.breadth.get(smaller)?;
        let sill = self.breadth.get(saddle)?;
        Ok(sill < narrow * PASSAGE_BREADTH_RATIO
            && narrow - sill > MINIMUM_PASSAGE_RELIEF_CELLS * field.mesh.area(smaller).sqrt())
    }
    fn activate(&mut self, field: &Field, cell: usize) -> io::Result<()> {
        self.parent.set(cell, cell as i32)?;
        let mut neighbors = SmallIntSet::default();
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                if self.parent.get(next)? >= 0 {
                    neighbors.add(self.root(next)? as i32);
                }
            }
        }
        let mut roots = KeyedHeap::new([Direction::Descending], Direction::Ascending);
        for &root in neighbors.items() {
            roots.push(root as u32, [self.breadth.get(root as usize)?]);
        }
        let Some((first, _)) = roots.pop() else {
            return Ok(());
        };
        self.parent.set(cell, first as i32)?;
        while let Some((root, _)) = roots.pop() {
            let a = self.root(cell)?;
            let b = self.root(root as usize)?;
            if !self.separated(field, a, b, cell)? {
                self.join(a, b)?;
            }
        }
        Ok(())
    }
    // hpc-exempt: sparse marine region metadata, ordered by root identity.
    fn gather(&mut self, field: &Field) -> io::Result<BTreeMap<usize, Region>> {
        let kind = field.water().column.kind;
        // hpc-exempt: sparse marine region records; membership remains in typed labels.
        let mut found = BTreeMap::new();
        for cell in 0..field.mesh.len() {
            if kind.get(cell)? != 1 {
                continue;
            }
            let root = self.root(cell)?;
            let breadth = 2.0 * self.breadth.get(root)?;
            let region = found.entry(root).or_insert(Region {
                id: root,
                peak: root,
                area: 0.0,
                breadth,
                ocean: true,
            });
            region.area += field.mesh.area(cell);
        }
        Ok(found)
    }
    fn strongest_neighbor(&mut self, field: &Field, region: usize) -> io::Result<Option<usize>> {
        let kind = field.water().column.kind;
        let (mut neighbor, mut passage) = (None, f64::NEG_INFINITY);
        for cell in 0..field.mesh.len() {
            if kind.get(cell)? != 1 || self.root(cell)? != region {
                continue;
            }
            for edge in 0..3 {
                let Some(next) = field.mesh.neighbor(cell, edge) else {
                    continue;
                };
                if kind.get(next)? != 1 || self.root(next)? == self.root(cell)? {
                    continue;
                }
                let breadth = self.breadth.get(cell)?.min(self.breadth.get(next)?);
                if breadth <= passage {
                    continue;
                }
                passage = breadth;
                neighbor = Some(next);
            }
        }
        Ok(neighbor)
    }
    // hpc-exempt: region records keyed by representative, not field data.
    fn merge_small(&mut self, field: &Field) -> io::Result<BTreeMap<usize, Region>> {
        let mut regions = self.gather(field)?;
        let mut order = regions.values().cloned().collect::<Vec<_>>();
        // hpc-exempt: sparse region metadata ranked once by geographic area.
        order.sort_by(|a, b| a.area.total_cmp(&b.area).then(a.id.cmp(&b.id)));
        for region in order {
            let current = regions[&self.root(region.id)?].clone();
            if current.area >= MINIMUM_REGION_CELLS * field.mesh.area(current.peak) {
                continue;
            }
            let Some(neighbor) = self.strongest_neighbor(field, current.id)? else {
                continue;
            };
            let other = regions[&self.root(neighbor)?].clone();
            let root = self.join(current.id, other.id)?;
            let absorbed = if root == current.id { &other } else { &current };
            regions.get_mut(&root).unwrap().area += absorbed.area;
            regions.remove(&absorbed.id);
        }
        self.gather(field)
    }
}
pub fn regions(field: &Field, shelf_break: f64) -> io::Result<Regions> {
    let mut breadth = coastal_breadth(field)?;
    let water = field.water();
    for cell in 0..breadth.len() {
        breadth.set(
            cell,
            breadth.get(cell)?
                * (1.0
                    - SHALLOW_BREADTH_REDUCTION
                        * (1.0
                            - (water.column.store(Store::Standing).held(cell)? / shelf_break)
                                .min(1.0))),
        )?;
    }
    let order = field
        .coverage
        .borrow_mut()
        .order(&breadth.read_only(), Direction::Descending)?;
    let mut watershed = Watershed {
        parent: field.coverage.borrow_mut().allocate(-1),
        breadth,
    };
    for cell in order {
        let cell = cell?;
        if water.column.kind.get(cell)? == 1 {
            watershed.activate(field, cell)?;
        }
    }
    let mut regions = watershed
        .merge_small(field)?
        .into_values()
        .collect::<Vec<_>>();
    let mut labels = field.coverage.borrow_mut().allocate(-1);
    for cell in 0..field.mesh.len() {
        if water.column.kind.get(cell)? == 1 {
            labels.set(cell, watershed.root(cell)? as i32)?;
        }
    }
    classify(field, &labels, &mut regions, shelf_break)?;
    Ok(Regions { labels, regions })
}
fn classify(
    field: &Field,
    labels: &Band<i32>,
    regions: &mut [Region],
    shelf_break: f64,
) -> io::Result<()> {
    let mut index = vec![usize::MAX; field.mesh.len()];
    for (at, region) in regions.iter().enumerate() {
        index[region.id] = at;
    }
    let mut shallow = vec![0.0; regions.len()];
    let mut neighbor_area = vec![0.0f64; regions.len()];
    let water = field.water();
    for cell in 0..field.mesh.len() {
        let id = labels.get(cell)?;
        if id < 0 {
            continue;
        }
        let at = index[id as usize];
        if water.column.store(Store::Standing).held(cell)? <= shelf_break {
            shallow[at] += field.mesh.area(cell);
        }
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                let other = labels.get(next)?;
                if other >= 0 && other != id {
                    neighbor_area[at] = neighbor_area[at].max(regions[index[other as usize]].area);
                }
            }
        }
    }
    for (at, region) in regions.iter_mut().enumerate() {
        if shallow[at] >= region.area * SHALLOW_SEA_SHARE
            || region.area < neighbor_area[at] * SUBORDINATE_SEA_RATIO
        {
            region.ocean = false;
        }
    }
    Ok(())
}
pub fn extend_labels(field: &Field, labels: &Band<i32>) -> io::Result<Band<i32>> {
    let mut extended = field.coverage.borrow_mut().copy_band(labels)?;
    let mut distance = field.coverage.borrow_mut().allocate(f64::INFINITY);
    let mut seeds = Vec::new();
    for cell in 0..labels.len() {
        if labels.get(cell)? >= 0 {
            distance.set(cell, 0.0)?;
            seeds.push(cell);
        }
    }
    physical_distance(
        &field.mesh,
        seeds,
        &mut distance,
        f64::INFINITY,
        |target, source| extended.set(target, extended.get(source)?),
    )?;
    Ok(extended)
}
