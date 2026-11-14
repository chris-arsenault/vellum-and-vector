//! Class winners and family margins use the same regular or adaptive membership patches.
use super::{adaptive::Adaptive, Grid, Layout};
use crate::{
    field::schema::NumericBand,
    hpc::SmallIntSet,
    storage::{Coverage, ReadBand},
};
// hpc-exempt: patch samplers keyed by sparse class identity; numerical patches use bands.
use std::{cell::RefCell, collections::BTreeMap, io};

#[derive(Clone)]
pub struct Surface<'a> {
    pub grid: &'a Grid,
    pub values: NumericBand,
    pub active: ReadBand<u8>,
    pub overlays: Vec<Overlay<'a>>,
}
#[derive(Clone)]
pub struct Overlay<'a> {
    pub surface: Surface<'a>,
    pub covers: &'a dyn Fn([f64; 2]) -> io::Result<bool>,
}
pub struct Sampler<'a> {
    source: Surface<'a>,
    coverage: &'a RefCell<Coverage>,
    // hpc-exempt: named class patch caches, each backed by dense numerical bands.
    patches: BTreeMap<i32, Adaptive<'a>>,
    candidate_starts: Vec<usize>,
    candidate_lengths: Vec<usize>,
    candidate_codes: Vec<i32>,
    overlays: Vec<Sampler<'a>>,
}
impl<'a> Sampler<'a> {
    pub fn new(source: &Surface<'a>, coverage: &'a RefCell<Coverage>) -> Self {
        let leaves = match &source.grid.layout {
            Layout::Adaptive(topology) => topology.leaves.len(),
            Layout::Raster { .. } => 0,
        };
        Self {
            source: source.clone(),
            coverage,
            // hpc-exempt: sparse class identities select band-backed patch samplers.
            patches: BTreeMap::new(),
            candidate_starts: vec![usize::MAX; leaves],
            candidate_lengths: vec![0; leaves],
            candidate_codes: Vec::new(),
            overlays: source
                .overlays
                .iter()
                .map(|overlay| Self::new(&overlay.surface, coverage))
                .collect(),
        }
    }
    pub fn sample(
        &mut self,
        point: [f64; 2],
        includes: Option<&dyn Fn(i32) -> bool>,
    ) -> io::Result<f64> {
        for (overlay, sampler) in self.source.overlays.iter().zip(&mut self.overlays).rev() {
            if (overlay.covers)(overlay.surface.grid.chart(point))? {
                return sampler.sample(point, includes);
            }
        }
        let grid = self.source.grid;
        let point = grid.chart(point);
        let [west, south, east, north] = grid.bounds;
        let point = [point[0].clamp(west, east), point[1].clamp(south, north)];
        match &grid.layout {
            Layout::Raster { width, height } => self.raster(*width, *height, point, includes),
            Layout::Adaptive(topology) => {
                let Some(leaf) = topology.at(point)? else {
                    return Ok(f64::NAN);
                };
                if self.candidate_starts[leaf] == usize::MAX {
                    let mut candidates = SmallIntSet::default();
                    self.visit(leaf, 2, &mut candidates)?;
                    self.candidate_starts[leaf] = self.candidate_codes.len();
                    self.candidate_lengths[leaf] = candidates.items().len();
                    self.candidate_codes.extend_from_slice(candidates.items());
                }
                let start = self.candidate_starts[leaf];
                let codes = &self.candidate_codes[start..start + self.candidate_lengths[leaf]];
                if codes.len() <= 1 {
                    let code = codes
                        .first()
                        .copied()
                        .unwrap_or(self.source.values.get(leaf)? as i32);
                    return Ok(single(code, includes));
                }
                let mut best = self.source.values.get(leaf)? as i32;
                let (mut best_value, mut inside, mut outside) = (f64::NEG_INFINITY, 0.0f64, 0.0f64);
                for &code in codes {
                    let patch = self.patches.entry(code).or_insert_with(|| {
                        Adaptive::new(topology, &mut self.coverage.borrow_mut())
                    });
                    let value = patch.sample(point, &|cell| {
                        Ok(f64::from(
                            self.source.active.get(cell)? != 0
                                && self.source.values.get(cell)? as i32 == code,
                        ))
                    })?;
                    if let Some(includes) = includes {
                        if includes(code) {
                            inside = inside.max(value);
                        } else {
                            outside = outside.max(value);
                        }
                    }
                    if value > best_value {
                        best = code;
                        best_value = value;
                    }
                }
                Ok(if includes.is_some() {
                    inside - outside
                } else {
                    best as f64
                })
            }
        }
    }
    fn visit(&self, cell: usize, rings: usize, codes: &mut SmallIntSet) -> io::Result<()> {
        if self.source.active.get(cell)? != 0 {
            codes.add(self.source.values.get(cell)? as i32);
        }
        if rings > 0 {
            let Layout::Adaptive(topology) = &self.source.grid.layout else {
                return Ok(());
            };
            for at in topology.offsets.get(cell)?..topology.offsets.get(cell + 1)? {
                self.visit(
                    topology.neighbors.get(at as usize)? as usize,
                    rings - 1,
                    codes,
                )?;
            }
        }
        Ok(())
    }
    fn raster(
        &self,
        width: usize,
        height: usize,
        point: [f64; 2],
        includes: Option<&dyn Fn(i32) -> bool>,
    ) -> io::Result<f64> {
        if width < 2 || height < 2 {
            return Ok(single(
                self.source
                    .values
                    .get(self.source.grid.sample_index(point)?)? as i32,
                includes,
            ));
        }
        let [x0, y0, x1, y1] = self.source.grid.bounds;
        let gx = ((point[0] - x0) / (x1 - x0) * (width - 1) as f64).clamp(0.0, (width - 1) as f64);
        let gy =
            ((point[1] - y0) / (y1 - y0) * (height - 1) as f64).clamp(0.0, (height - 1) as f64);
        let x = (gx.floor() as usize).min(width - 2);
        let y = (gy.floor() as usize).min(height - 2);
        let (tx, ty) = (gx - x as f64, gy - y as f64);
        let at = y * width + x;
        let mut codes = [0; 4];
        let mut mask = [0; 4];
        for (corner, cell) in [at, at + 1, at + width, at + width + 1]
            .into_iter()
            .enumerate()
        {
            codes[corner] = self.source.values.get(cell)? as i32;
            mask[corner] = self.source.active.get(cell)?;
        }
        let weights = [
            (1.0 - tx) * (1.0 - ty),
            tx * (1.0 - ty),
            (1.0 - tx) * ty,
            tx * ty,
        ];
        let nearest =
            codes[((gy + 0.5).floor() as usize - y) * 2 + (gx + 0.5).floor() as usize - x];
        let (mut best, mut best_weight, mut inside, mut outside) =
            (nearest, f64::NEG_INFINITY, 0.0f64, 0.0f64);
        for at in 0..4 {
            if mask[at] == 0 {
                continue;
            }
            let code = codes[at];
            let weight = (0..4)
                .filter(|&n| mask[n] != 0 && codes[n] == code)
                .map(|n| weights[n])
                .sum::<f64>();
            if let Some(includes) = includes {
                if includes(code) {
                    inside = inside.max(weight);
                } else {
                    outside = outside.max(weight);
                }
            }
            if weight > best_weight || (weight == best_weight && code == nearest) {
                best = code;
                best_weight = weight;
            }
        }
        Ok(if includes.is_some() {
            inside - outside
        } else {
            best as f64
        })
    }
}
fn single(code: i32, includes: Option<&dyn Fn(i32) -> bool>) -> f64 {
    includes.map_or(
        code as f64,
        |includes| if includes(code) { 1.0 } else { -1.0 },
    )
}
