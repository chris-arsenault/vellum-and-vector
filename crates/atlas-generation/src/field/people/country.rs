use super::work::km2;
use crate::{
    field::Field,
    human::{catalogue::LayerId, HumanField},
    links::Offers,
    metric::search::search,
    storage::Band,
};
// hpc-exempt: named place adjacency metadata uses sparse keyed records.
use std::{cell::Cell, collections::BTreeMap, io};

pub struct Spread {
    pub owner: Vec<i32>,
    pub from: Vec<i32>,
    pub cost: Band<f64>,
}
pub type Step<'a> = dyn Fn(usize, usize) -> io::Result<f64> + 'a;
pub fn spread(
    field: &Field,
    centres: &[usize],
    step: &Step<'_>,
    reach: f64,
    strength: Option<&[f64]>,
    offers: &Offers<Field>,
) -> io::Result<Spread> {
    let owner: Vec<Cell<i32>> = (0..field.mesh.len()).map(|_| Cell::new(-1)).collect();
    let mut from = vec![-1; field.mesh.len()];
    let mut cost = field
        .coverage
        .borrow_mut()
        .scratch(field.mesh.len(), f64::INFINITY);
    for (index, &cell) in centres.iter().enumerate() {
        owner[cell].set(index as i32);
        cost.set(cell, 0.0)?;
    }
    let power = |cell: usize| {
        strength
            .and_then(|s| {
                usize::try_from(owner[cell].get())
                    .ok()
                    .and_then(|at| s.get(at))
            })
            .copied()
            .unwrap_or(1.0)
    };
    let walk = |seeds: &[usize], cost: &mut Band<f64>, from: &mut [i32]| {
        search(
            &field.mesh,
            seeds.iter().copied(),
            cost,
            reach,
            |target, source| {
                owner[target].set(owner[source].get());
                from[target] = source as i32;
                Ok(())
            },
            |source, target, _| Ok(step(source, target)? / power(source)),
        )
    };
    walk(centres, &mut cost, &mut from)?;
    let links = offers.links(field)?;
    while !links.is_empty() {
        let mut opened = Vec::new();
        for link in &links {
            for (near, far) in [(link.a, link.b), (link.b, link.a)] {
                let through = cost.get(near)? + link.cost / power(near);
                if through > reach || through >= cost.get(far)? {
                    continue;
                }
                cost.set(far, through)?;
                owner[far].set(owner[near].get());
                from[far] = near as i32;
                opened.push(far);
            }
        }
        if opened.is_empty() {
            break;
        }
        walk(&opened, &mut cost, &mut from)?;
    }
    Ok(Spread {
        owner: owner.into_iter().map(Cell::into_inner).collect(),
        from,
        cost,
    })
}
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hinterland {
    pub km2: f64,
    pub people: f64,
    pub farmed_km2: f64,
    pub grazed_km2: f64,
}
pub struct Way {
    pub from: usize,
    pub to: usize,
    pub cells: Vec<usize>,
    pub cost: f64,
    pub afloat: f64,
}
pub struct Country {
    pub owner: Vec<i32>,
    pub hinterlands: Vec<Hinterland>,
    pub ways: Vec<Way>,
}
struct Crossing {
    a: usize,
    b: usize,
    cost: f64,
}
fn crossings(field: &Field, step: &Step<'_>, found: &Spread) -> io::Result<Vec<Crossing>> {
    // hpc-exempt: one entry per neighbouring named place pair, not cell storage.
    let mut best = BTreeMap::<(i32, i32), usize>::new();
    let mut crossings: Vec<Crossing> = Vec::new();
    for a in 0..field.mesh.len() {
        if found.owner[a] < 0 {
            continue;
        }
        for edge in 0..3 {
            let Some(b) = field.mesh.neighbor(a, edge) else {
                continue;
            };
            if found.owner[b] <= found.owner[a] {
                continue;
            }
            let cost = found.cost.get(a)? + step(a, b)? + found.cost.get(b)?;
            if !cost.is_finite() {
                continue;
            }
            let key = (found.owner[a], found.owner[b]);
            if let Some(&index) = best.get(&key) {
                if cost < crossings[index].cost {
                    crossings[index] = Crossing { a, b, cost };
                }
            } else {
                best.insert(key, crossings.len());
                crossings.push(Crossing { a, b, cost });
            }
        }
    }
    Ok(crossings)
}
fn back(from: &[i32], cell: usize) -> Vec<usize> {
    let mut cells = vec![cell];
    let mut at = from[cell];
    while at >= 0 {
        cells.push(at as usize);
        at = from[at as usize];
    }
    cells
}
pub fn country_of(
    field: &Field,
    centres: &[usize],
    step: &Step<'_>,
    reach: f64,
    links: &Offers<Field>,
) -> io::Result<Country> {
    let found = spread(field, centres, step, reach, None, links)?;
    let mut hinterlands: Vec<Hinterland> =
        (0..centres.len()).map(|_| Hinterland::default()).collect();
    let water = field.water().column.kind;
    let farmland = field.people.view(HumanField::Layer(LayerId::Farmland));
    let pasture = field.people.view(HumanField::Layer(LayerId::Pasture));
    for (cell, &index) in found.owner.iter().enumerate() {
        if index < 0 || water.get(cell)? != 0 {
            continue;
        }
        let area = km2(field, cell);
        let total = &mut hinterlands[index as usize];
        total.km2 += area;
        total.people += field.people.people(cell)? * area;
        total.farmed_km2 += farmland.get(cell)? * area;
        total.grazed_km2 += pasture.get(cell)? * area;
    }
    let mut ways = Vec::new();
    for crossing in crossings(field, step, &found)? {
        let mut cells = back(&found.from, crossing.a);
        cells.reverse();
        cells.extend(back(&found.from, crossing.b));
        let mut wet = 0;
        for &cell in &cells {
            wet += usize::from(water.get(cell)? != 0);
        }
        ways.push(Way {
            from: found.owner[crossing.a] as usize,
            to: found.owner[crossing.b] as usize,
            cost: crossing.cost,
            afloat: wet as f64 / cells.len() as f64,
            cells,
        });
    }
    Ok(Country {
        owner: found.owner,
        hinterlands,
        ways,
    })
}
