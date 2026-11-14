//! Material-sensitive descent and flat guidance on the shared triangular lattice.
use super::{
    drainage::{Drainage, DrainageView},
    network::{retain_routes, RiverTerrain},
    reaches::ReachStore,
};
use crate::{
    flow_graph::gathered,
    lattice::TriangularLattice,
    noise::hash_unit,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::{Band, Coverage, ReadBand},
};
use std::io;
const EPSILON: f64 = 0.0000001;
pub struct GuidanceSettings {
    pub lookahead_distance: f64,
    pub outlet_alignment_weight: f64,
    pub inherited_valley_weight: f64,
    pub floor_gradient_weight: f64,
    pub conditioned_gradient_weight: f64,
    pub capture_weight: f64,
}
pub struct GuidanceInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub scale: &'a MapScale,
    pub water_kind: &'a ReadBand<u8>,
    pub elevation: &'a ReadBand<f64>,
    pub fluvial_erosion: &'a ReadBand<f64>,
    pub glacial_erosion: &'a ReadBand<f64>,
    pub open_boundary: bool,
    pub seed: i32,
    pub epoch_stable_seed: i32,
    pub response: &'a dyn Fn(usize, usize) -> io::Result<f64>,
    pub settings: &'a GuidanceSettings,
}
struct Router<'a> {
    input: GuidanceInputs<'a>,
    drainage: DrainageView,
    gradient: [Band<f64>; 2],
    erosion_length: f64,
    capture_area: f64,
}
impl Drainage {
    pub fn resolve_targets(
        &mut self,
        input: GuidanceInputs<'_>,
        rivers: &ReachStore,
        coverage: &mut Coverage,
    ) -> io::Result<Band<i32>> {
        let n = input.mesh.len();
        let mut gradient = [coverage.scratch(n, 0.0), coverage.scratch(n, 0.0)];
        for cell in 0..n {
            let values = input
                .mesh
                .gradient(cell, &|cell| self.elevations.get(cell))?;
            gradient[0].set(cell, values[0])?;
            gradient[1].set(cell, values[1])?;
        }
        let erosion_length = input
            .scale
            .resolve(RelativeMeasure::length(0.000025).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let capture_area = input
            .scale
            .resolve(
                RelativeMeasure::new(6.25e-6, 2, 1.0, LengthUnit::Metre)
                    .map_err(io::Error::other)?,
            )
            .map_err(io::Error::other)?
            .value();
        let router = Router {
            input,
            drainage: self.read_only(),
            gradient,
            erosion_length,
            capture_area,
        };
        let mut targets = coverage.scratch(n, -1);
        self.select_all(&router, &mut targets, None)?;
        if router.input.settings.capture_weight > 0.0 {
            let area = gathered(
                coverage,
                &targets.read_only(),
                |cell| Ok(router.input.mesh.area(cell)),
                |_, amount| Ok(amount),
            )?;
            self.select_all(&router, &mut targets, Some(&area))?;
        }
        retain_routes(
            rivers,
            &RiverTerrain {
                mesh: router.input.mesh,
                water_kind: router.input.water_kind,
                targets: &targets.read_only(),
            },
            &self.elevations.read_only(),
            &self.ranks.read_only(),
            &mut targets,
        )?;
        Ok(targets)
    }
    fn select_all(
        &mut self,
        router: &Router<'_>,
        targets: &mut Band<i32>,
        area: Option<&Band<f64>>,
    ) -> io::Result<()> {
        for cell in 0..router.input.mesh.len() {
            if router.input.water_kind.get(cell)? == 1 {
                continue;
            }
            let (target, tied) = match router.aspect_target(cell)? {
                Some(target) => (Some(target), false),
                None => router.scored_target(cell, area)?,
            };
            self.decision_total += 1;
            self.tie_decision_total += u64::from(tied);
            targets.set(cell, target.map_or(-1, |target| target as i32))?;
        }
        Ok(())
    }
    pub fn guide(
        &mut self,
        input: GuidanceInputs<'_>,
        rivers: &ReachStore,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let targets = self.resolve_targets(input, rivers, coverage)?;
        for cell in 0..targets.len() {
            self.guidance.set(cell, targets.get(cell)?)?;
        }
        Ok(())
    }
}
fn normalize([x, y]: [f64; 2]) -> [f64; 2] {
    let length = x.hypot(y);
    let length = if length == 0.0 { 1.0 } else { length };
    [x / length, y / length]
}
pub fn desired_direction(mesh: &TriangularLattice, source: usize, target: usize) -> [f64; 2] {
    let [x, y] = mesh.position(source);
    let [tx, ty] = mesh.position(target);
    normalize([
        f64::from(mesh.delta_x(tx - x) as f32),
        f64::from((ty - y) as f32),
    ])
}
fn coordinate_tie(mesh: &TriangularLattice, source: usize, target: usize, seed: i32) -> f64 {
    let [x, y] = mesh.position(source);
    let [tx, ty] = mesh.position(target);
    let word = |v: f64| v.trunc().rem_euclid(4_294_967_296.0) as u32 as i32;
    hash_unit(
        seed ^ word(MapScale::native(x) * 4.0),
        f64::from(word(MapScale::native(y) * 4.0) ^ word(MapScale::native(tx) * 4.0)),
        MapScale::native(ty) * 4.0,
    )
}
impl Router<'_> {
    fn legal(&self, source: usize, target: usize) -> io::Result<bool> {
        let a = self.drainage.elevations.get(source)?;
        let b = self.drainage.elevations.get(target)?;
        Ok(self.input.water_kind.get(target)? == 1
            || b < a
            || (b == a && self.drainage.ranks.get(target)? < self.drainage.ranks.get(source)?))
    }
    fn candidate_score(&self, source: usize, target: usize, alignment: f64) -> io::Result<f64> {
        let p = self.input.settings;
        let inherited = (100.0
            * MapScale::metres(
                self.input.fluvial_erosion.get(target)? + self.input.glacial_erosion.get(target)?,
                LengthUnit::Native,
            )
            / self.erosion_length)
            .clamp(0.0, 100.0);
        if self.input.water_kind.get(target)? == 1 {
            return Ok(10000.0 + alignment);
        }
        let [x, y] = self.input.mesh.position(source);
        let [tx, ty] = self.input.mesh.position(target);
        let length = self.input.mesh.delta_x(x - tx).hypot(y - ty);
        let drop = MapScale::metres(
            self.drainage.elevations.get(source)? - self.drainage.elevations.get(target)?,
            LengthUnit::Native,
        ) / length;
        if drop <= 0.0 {
            let progress =
                (self.drainage.ranks.get(source)? - self.drainage.ranks.get(target)?).clamp(0, 20);
            return Ok(alignment * p.outlet_alignment_weight / 10.0
                + f64::from(progress) * 0.15
                + inherited * p.inherited_valley_weight / 1000.0);
        }
        let floor_drop = (MapScale::metres(
            self.input.elevation.get(source)? - self.input.elevation.get(target)?,
            LengthUnit::Native,
        ) / length)
            .clamp(-0.005, 0.02);
        Ok(floor_drop * p.floor_gradient_weight / 0.1
            + drop.min(0.02) * p.conditioned_gradient_weight / 0.1
            + alignment * p.outlet_alignment_weight / 20.0
            + inherited * p.inherited_valley_weight / 1000.0)
    }
    fn descent_direction(&self, source: usize) -> io::Result<[f64; 2]> {
        let parent = usize::try_from(self.drainage.parents.get(source)?).ok();
        if let Some(parent) = parent {
            if self.drainage.elevations.get(parent)? == self.drainage.elevations.get(source)?
                && self.gradient[0].get(source)? == 0.0
                && self.gradient[1].get(source)? == 0.0
            {
                return Ok(desired_direction(self.input.mesh, source, parent));
            }
        }
        let (mut x, mut y, mut current, mut distance) = (0.0, 0.0, source, 0.0);
        while distance < self.input.settings.lookahead_distance {
            let Ok(parent) = usize::try_from(self.drainage.parents.get(current)?) else {
                break;
            };
            let segment = self
                .input
                .mesh
                .physical_distance(current, parent)
                .min(self.input.settings.lookahead_distance - distance);
            x -= self.gradient[0].get(current)? * segment;
            y -= self.gradient[1].get(current)? * segment;
            distance += segment;
            current = parent;
        }
        Ok(if x == 0.0 && y == 0.0 {
            desired_direction(self.input.mesh, source, current)
        } else {
            normalize([x, y])
        })
    }
    fn downhill_steps(&self, source: usize) -> io::Result<Option<Vec<Step>>> {
        let mut steps = Vec::with_capacity(3);
        let elevation = self.drainage.elevations.get(source)?;
        let [x, y] = self.input.mesh.position(source);
        for edge in 0..3 {
            let Some(target) = self.input.mesh.neighbor(source, edge) else {
                continue;
            };
            if self.input.water_kind.get(target)? == 1 {
                return Ok(None);
            }
            if self.drainage.elevations.get(target)? >= elevation {
                continue;
            }
            let [tx, ty] = self.input.mesh.position(target);
            steps.push(Step {
                target,
                delta: [self.input.mesh.delta_x(tx - x), ty - y],
            });
        }
        Ok(Some(steps))
    }
    fn expected_step(&self, cell: usize, heading: [f64; 2]) -> io::Result<[f64; 2]> {
        let Some(steps) = self.downhill_steps(cell)?.filter(|steps| !steps.is_empty()) else {
            return Ok([0.0; 2]);
        };
        let moves: Vec<_> = steps.iter().map(|step| step.delta).collect();
        let (left, right, p) = bracket(&moves, heading);
        Ok(std::array::from_fn(|axis| {
            p * moves[left][axis] + (1.0 - p) * moves[right][axis]
        }))
    }
    fn aspect_target(&self, source: usize) -> io::Result<Option<usize>> {
        let gx = self.gradient[0].get(source)?;
        let gy = self.gradient[1].get(source)?;
        let length = gx.hypot(gy);
        if length == 0.0 {
            return Ok(None);
        }
        let heading = [-gx / length, -gy / length];
        let Some(steps) = self
            .downhill_steps(source)?
            .filter(|steps| !steps.is_empty())
        else {
            return Ok(None);
        };
        let two_steps = steps
            .iter()
            .map(|step| {
                let next = self.expected_step(step.target, heading)?;
                Ok([step.delta[0] + next[0], step.delta[1] + next[1]])
            })
            .collect::<io::Result<Vec<_>>>()?;
        let (left, right, p) = bracket(&two_steps, heading);
        if left == right {
            return Ok(Some(steps[left].target));
        }
        let left_weight = p * (1.0 + (self.input.response)(source, steps[left].target)?);
        let right_weight = (1.0 - p) * (1.0 + (self.input.response)(source, steps[right].target)?);
        let [x, y] = self.input.mesh.position(source);
        let draw = hash_unit(
            self.input.epoch_stable_seed ^ 0x2f8a,
            MapScale::native(x),
            MapScale::native(y),
        );
        Ok(Some(
            steps[if draw * (left_weight + right_weight) < left_weight {
                left
            } else {
                right
            }]
            .target,
        ))
    }
    fn scored_target(
        &self,
        source: usize,
        area: Option<&Band<f64>>,
    ) -> io::Result<(Option<usize>, bool)> {
        let [dx, dy] = self.descent_direction(source)?;
        let (mut best, mut best_score, mut tie_decided) = (None, -f64::MAX, false);
        for edge in 0..3 {
            let Some(target) = self.input.mesh.neighbor(source, edge) else {
                continue;
            };
            if !self.legal(source, target)? {
                continue;
            }
            let [ex, ey] = self.input.mesh.edge_direction(source, edge);
            let capture = match area {
                None => 0.0,
                Some(area) => {
                    (1.0 + area.get(target)? / self.capture_area).log2()
                        * self.input.settings.capture_weight
                        / 1000.0
                }
            };
            let score = self.candidate_score(source, target, ex * dx + ey * dy)? + capture;
            if score > best_score + EPSILON {
                best = Some(target);
                best_score = score;
                tie_decided = false;
            } else if (score - best_score).abs() < EPSILON {
                let held = best.expect("A tied score has an existing target");
                let response =
                    (self.input.response)(source, target)? - (self.input.response)(source, held)?;
                tie_decided = response == 0.0;
                let preference = if response == 0.0 {
                    coordinate_tie(self.input.mesh, source, target, self.input.seed)
                        - coordinate_tie(self.input.mesh, source, held, self.input.seed)
                } else {
                    response
                };
                if preference > 0.0 {
                    best = Some(target);
                }
            }
        }
        let open = self.input.mesh.boundary(source)
            && (self.input.open_boundary
                || (self.input.mesh.open_boundary()
                    && self.drainage.parents.get(source)? < 0
                    && self.drainage.ranks.get(source)? >= 0));
        if best.is_none() && !open {
            return Err(io::Error::other(format!(
                "Conditioned triangle {source} has no outlet"
            )));
        }
        Ok((best, tie_decided))
    }
}
struct Step {
    target: usize,
    delta: [f64; 2],
}
fn bracket(moves: &[[f64; 2]], [ax, ay]: [f64; 2]) -> (usize, usize, f64) {
    let (mut left, mut right, mut nearest) = (None, None, 0);
    let cross = |at: usize| moves[at][0] * ay - moves[at][1] * ax;
    let cosine =
        |at: usize| (moves[at][0] * ax + moves[at][1] * ay) / moves[at][0].hypot(moves[at][1]);
    for at in 0..moves.len() {
        if cosine(at) > cosine(nearest) {
            nearest = at;
        }
        if cross(at) > 0.0 && left.is_none_or(|held| cosine(at) > cosine(held)) {
            left = Some(at);
        }
        if cross(at) <= 0.0 && right.is_none_or(|held| cosine(at) > cosine(held)) {
            right = Some(at);
        }
    }
    match (left, right) {
        (Some(left), Some(right)) => (left, right, -cross(right) / (cross(left) - cross(right))),
        _ => (nearest, nearest, 1.0),
    }
}
pub fn select_by_outlet_alignment(
    mesh: &TriangularLattice,
    candidates: &[usize],
    source: usize,
    outlet: usize,
    seed: i32,
) -> io::Result<usize> {
    let [dx, dy] = desired_direction(mesh, source, outlet);
    let (mut best, mut best_alignment, mut best_tie) = (None, -f64::MAX, -f64::MAX);
    for &candidate in candidates {
        let [x, y] = desired_direction(mesh, source, candidate);
        let alignment = x * dx + y * dy;
        let tie = coordinate_tie(mesh, source, candidate, seed);
        if alignment > best_alignment + EPSILON
            || ((alignment - best_alignment).abs() < EPSILON && tie > best_tie)
        {
            best = Some(candidate);
            best_alignment = alignment;
            best_tie = tie;
        }
    }
    best.ok_or_else(|| io::Error::other("Flow selection requires at least one candidate"))
}
