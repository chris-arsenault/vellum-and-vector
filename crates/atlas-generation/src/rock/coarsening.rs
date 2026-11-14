//! Contact reduction preserves the incoming cap and unbounded basement.
use super::material::{blend_layers, MaterialLayer};
use std::io;

pub fn same_material(a: &MaterialLayer, b: &MaterialLayer) -> bool {
    a.kind == b.kind
        && a.secondary_kind == b.secondary_kind
        && a.secondary_share == b.secondary_share
        && a.strength == b.strength
        && a.damage == b.damage
        && a.grain_x == b.grain_x
        && a.grain_y == b.grain_y
        && a.bed_slope_x == b.bed_slope_x
        && a.bed_slope_y == b.bed_slope_y
        && a.deposited == b.deposited
        && a.consolidation == b.consolidation
        && a.altered == b.altered
        && a.mixed == b.mixed
        && a.cargo.as_ref().filter(|cargo| !cargo.is_empty())
            == b.cargo.as_ref().filter(|cargo| !cargo.is_empty())
}
pub struct Fold<'a> {
    pub upper: usize,
    pub kind: usize,
    pub thickness: f64,
    pub above: f64,
    pub result: &'a MaterialLayer,
}
pub type ObserveFold<'a> = dyn FnMut(Fold<'_>) -> io::Result<()> + 'a;

/// Prefer equivalent beds, then the thinnest contact; equal depths preserve shallower detail.
pub fn coarsen_one(
    layers: &mut Vec<MaterialLayer>,
    basement: bool,
    observe: &mut ObserveFold<'_>,
) -> io::Result<()> {
    let mut best = layers.len() - if basement { 3 } else { 2 };
    let mut equivalent = same_material(&layers[best], &layers[best + 1]);
    let mut thickness = layers[best].depth + layers[best + 1].depth;
    for at in (1..best).rev() {
        let candidate = same_material(&layers[at], &layers[at + 1]);
        let depth = layers[at].depth + layers[at + 1].depth;
        if (candidate && !equivalent) || (candidate == equivalent && depth < thickness) {
            best = at;
            equivalent = candidate;
            thickness = depth;
        }
    }
    let a = &layers[best];
    let b = &layers[best + 1];
    let result = blend_layers(a, b, a.depth, b.depth);
    observe(Fold {
        upper: best,
        kind: a.kind,
        thickness: a.depth,
        above: layers[..best].iter().map(|bed| bed.depth).sum(),
        result: &result,
    })?;
    layers[best] = result;
    layers.remove(best + 1);
    Ok(())
}
struct Contacts {
    next: Vec<Option<usize>>,
    above: Vec<f64>,
    equivalent: Vec<bool>,
    thickness: Vec<f64>,
    basement: bool,
}
impl Contacts {
    fn new(layers: &[MaterialLayer], basement: bool) -> Self {
        let size = layers.len();
        let mut result = Self {
            next: (0..size).map(|i| (i + 1 < size).then_some(i + 1)).collect(),
            above: vec![0.0; size],
            equivalent: vec![false; size],
            thickness: vec![0.0; size],
            basement,
        };
        for i in 0..size {
            if i > 0 {
                result.above[i] = result.above[i - 1] + layers[i - 1].depth;
            }
            result.update(layers, i);
        }
        result
    }
    fn update(&mut self, layers: &[MaterialLayer], upper: usize) {
        let Some(lower) = self.next[upper] else {
            return;
        };
        if upper == 0 || (self.basement && lower == layers.len() - 1) {
            return;
        }
        self.equivalent[upper] = same_material(&layers[upper], &layers[lower]);
        self.thickness[upper] = layers[upper].depth + layers[lower].depth;
    }
    fn best(&self) -> (usize, usize, usize) {
        let mut best = self.next[0].expect("Contact reduction needs buried beds");
        let mut previous = best;
        let mut chosen_previous = 0;
        let mut chosen_rank = 1;
        let mut rank = 2;
        let mut at = self.next[best];
        while let Some(index) = at {
            let Some(lower) = self.next[index] else {
                break;
            };
            if self.basement && lower == self.next.len() - 1 {
                break;
            }
            if (self.equivalent[index] && !self.equivalent[best])
                || (self.equivalent[index] == self.equivalent[best]
                    && self.thickness[index] <= self.thickness[best])
            {
                best = index;
                chosen_previous = previous;
                chosen_rank = rank;
            }
            previous = index;
            rank += 1;
            at = self.next[index];
        }
        (best, chosen_previous, chosen_rank)
    }
    fn compact(&self, layers: &mut Vec<MaterialLayer>) {
        let mut count = 0;
        let mut at = Some(0);
        while let Some(index) = at {
            if count != index {
                layers[count] = layers[index].clone();
            }
            count += 1;
            at = self.next[index];
        }
        layers.truncate(count);
    }
    fn reduce(
        &mut self,
        layers: &mut [MaterialLayer],
        size: usize,
        observe: &mut ObserveFold<'_>,
    ) -> io::Result<()> {
        for _ in size..layers.len() {
            let (upper, previous, rank) = self.best();
            let lower = self.next[upper].expect("Selected contact has a lower bed");
            let a = &layers[upper];
            let b = &layers[lower];
            let result = blend_layers(a, b, a.depth, b.depth);
            observe(Fold {
                upper: rank,
                kind: a.kind,
                thickness: a.depth,
                above: self.above[upper],
                result: &result,
            })?;
            layers[upper] = result;
            self.next[upper] = self.next[lower];
            self.update(layers, upper);
            self.update(layers, previous);
        }
        Ok(())
    }
}
pub fn coarsen_bulk(
    layers: &mut Vec<MaterialLayer>,
    size: usize,
    basement: bool,
    observe: &mut ObserveFold<'_>,
) -> io::Result<()> {
    if layers.len() <= size {
        return Ok(());
    }
    let mut contacts = Contacts::new(layers, basement);
    let result = contacts.reduce(layers, size, observe);
    contacts.compact(layers);
    result
}
pub fn coarsen_package(
    layers: &mut Vec<MaterialLayer>,
    size: usize,
    basement: bool,
    observe: &mut ObserveFold<'_>,
) -> io::Result<()> {
    if layers.len() >= 24 {
        return coarsen_bulk(layers, size, basement, observe);
    }
    while layers.len() > size {
        coarsen_one(layers, basement, observe)?;
    }
    Ok(())
}
