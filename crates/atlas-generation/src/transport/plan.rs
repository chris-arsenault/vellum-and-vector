//! Source-indexed plate overlap and donor deformation from world/transportPlan.ts.
use super::{
    overlap::triangle_overlap, DeformationBands, HistoryTransport, TransportShares,
    TRANSPORT_WEIGHT_SCALE as SCALE,
};
use crate::{
    field::shared::SharedFields,
    lattice::TriangularLattice,
    storage::{Band, BandList, Coverage},
    tectonics::{
        state::State,
        transport::{source_motion, SourceMotion},
    },
};
use std::io;

pub struct TransportPlan {
    offsets: Band<u32>,
    targets: Band<i32>,
    weights: Band<f64>,
    arrivals: Band<f64>,
    dominant: Band<i32>,
    deformation: [Band<f64>; 4],
}
impl TransportPlan {
    pub fn history(&self) -> HistoryTransport {
        HistoryTransport {
            shares: TransportShares {
                offsets: self.offsets.read_only(),
                targets: self.targets.read_only(),
                weights: self.weights.read_only(),
                dominant: self.dominant.read_only(),
            },
            arrivals: self.arrivals.read_only(),
        }
    }
    pub fn deformation(&self) -> DeformationBands {
        DeformationBands {
            xx: self.deformation[0].read_only(),
            xy: self.deformation[1].read_only(),
            yx: self.deformation[2].read_only(),
            yy: self.deformation[3].read_only(),
        }
    }
}
struct Builder<'a> {
    mesh: &'a TriangularLattice,
    coverage: &'a mut Coverage,
    targets: BandList<i32>,
    weights: BandList<f64>,
    arrivals: Band<f64>,
    dominant: Band<i32>,
    dominant_weight: Band<f64>,
}
impl Builder<'_> {
    fn add(&mut self, source: usize, target: usize, weight: f64) -> io::Result<()> {
        if weight <= 0.0 {
            return Ok(());
        }
        self.targets.push(
            i32::try_from(target).map_err(io::Error::other)?,
            self.coverage,
        )?;
        self.weights.push(weight, self.coverage)?;
        let contribution = weight * self.mesh.area(source) / self.mesh.area(target);
        self.arrivals
            .set(target, self.arrivals.get(target)? + contribution)?;
        let previous = self.dominant_weight.get(target)?;
        let source = i32::try_from(source).map_err(io::Error::other)?;
        if contribution > previous
            || (contribution == previous && source < self.dominant.get(target)?)
        {
            self.dominant.set(target, source)?;
            self.dominant_weight.set(target, contribution)?;
        }
        Ok(())
    }
    fn scatter(
        &mut self,
        source: usize,
        center: [f64; 2],
        motion: &SourceMotion<'_>,
    ) -> io::Result<()> {
        if let Some(overlaps) = triangle_overlap(self.mesh, source, center, motion) {
            for (target, share) in overlaps {
                self.add(source, target, share * SCALE)?;
            }
            return Ok(());
        }
        let [x, y] = self.mesh.point(center[0], center[1]);
        let Some(nearest) = self.mesh.cell_at(x, y) else {
            return Ok(());
        };
        let distance = |cell| {
            let p = self.mesh.position(cell);
            self.mesh.delta_x(p[0] - x).powi(2) + (p[1] - y).powi(2)
        };
        if distance(nearest) < 0.00000001 {
            return self.add(source, nearest, SCALE);
        }
        let mut candidates = vec![nearest];
        for edge in 0..3 {
            if let Some(cell) = self.mesh.neighbor(nearest, edge) {
                candidates.push(cell);
            }
        }
        let scores: Vec<_> = candidates
            .iter()
            .map(|&cell| 1.0 / distance(cell).max(0.0025).powi(2))
            .collect();
        let total: f64 = scores.iter().sum();
        let mut remaining = SCALE;
        for (n, &cell) in candidates.iter().enumerate() {
            let weight = if n == candidates.len() - 1 {
                remaining
            } else {
                (SCALE * scores[n] / total).round().clamp(0.0, remaining)
            };
            remaining -= weight;
            self.add(source, cell, weight)?;
        }
        Ok(())
    }
}
pub fn build(
    mesh: &TriangularLattice,
    fields: &SharedFields,
    state: Option<&State>,
    coverage: &mut Coverage,
    distance: f64,
) -> io::Result<TransportPlan> {
    let mut offsets = coverage.scratch(mesh.len() + 1, 0u32);
    let mut deformation = std::array::from_fn(|_| coverage.allocate(0.0));
    let mut builder = Builder {
        mesh,
        targets: BandList::default(),
        weights: BandList::default(),
        arrivals: coverage.allocate(0.0),
        dominant: coverage.allocate(-1),
        dominant_weight: coverage.allocate(0.0),
        coverage,
    };
    for cell in 0..mesh.len() {
        offsets.set(
            cell,
            u32::try_from(builder.targets.len()).map_err(io::Error::other)?,
        )?;
        let motion = source_motion(state, fields, cell, distance)?;
        let center = motion.move_point(mesh, mesh.position(cell));
        for (band, value) in deformation.iter_mut().zip(motion.deformation()) {
            band.set(cell, value)?;
        }
        builder.scatter(cell, center, &motion)?;
    }
    offsets.set(
        mesh.len(),
        u32::try_from(builder.targets.len()).map_err(io::Error::other)?,
    )?;
    let targets = builder.targets.finish(builder.coverage)?;
    let weights = builder.weights.finish(builder.coverage)?;
    let mut plan = TransportPlan {
        offsets,
        targets,
        weights,
        arrivals: builder.arrivals,
        dominant: builder.dominant,
        deformation,
    };
    plan.offsets.retain();
    plan.targets.retain();
    plan.weights.retain();
    plan.arrivals.retain();
    plan.dominant.retain();
    for band in &mut plan.deformation {
        band.retain();
    }
    Ok(plan)
}
