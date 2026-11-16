use super::{super::Field, topology::distance};
use crate::{
    lattice::TriangularLattice,
    rock::{ground::GroundField, material::MaterialLayer},
    scale::{LengthUnit, MapScale},
    settlement::stage::Pool,
};
use std::io;
pub struct Target {
    pub cell: usize,
    pub gradient: f64,
}
pub struct Edge {
    pub a: usize,
    pub b: usize,
    pub limit: f64,
}
pub fn grade_pair(
    h: &mut [f64; 2],
    movable: [bool; 2],
    limit: f64,
    areas: [f64; 2],
    tolerance: f64,
) {
    let step = h[0] - h[1];
    let excess = step.abs() - limit;
    if excess <= tolerance || (!movable[0] && !movable[1]) {
        return;
    }
    let toward = step.signum() * excess;
    let both = movable[0] && movable[1];
    let total = areas[0] + areas[1];
    if movable[0] {
        h[0] -= toward * if both { areas[1] / total } else { 1.0 };
    }
    if movable[1] {
        h[1] += toward * if both { areas[0] / total } else { 1.0 };
    }
}
pub fn grade_round(
    h: &mut [f64],
    movable: &[bool],
    areas: &[f64],
    edges: &[Edge],
    tolerance: f64,
) -> bool {
    let mut changes = vec![0.0; h.len()];
    let mut counts = vec![0u32; h.len()];
    for &Edge { a, b, limit } in edges {
        let mut pair = [h[a], h[b]];
        grade_pair(
            &mut pair,
            [movable[a], movable[b]],
            limit,
            [areas[a], areas[b]],
            tolerance,
        );
        changes[a] += pair[0] - h[a];
        changes[b] += pair[1] - h[b];
        counts[a] += 1;
        counts[b] += 1;
    }
    let mut moved = false;
    for i in 0..h.len() {
        let before = h[i];
        if counts[i] > 0 {
            h[i] += changes[i] / f64::from(counts[i]);
        }
        moved = moved || (h[i] - before).abs() > tolerance;
    }
    moved
}
fn edges(mesh: &TriangularLattice, targets: &[Target]) -> Vec<Edge> {
    let mut local = vec![-1i32; mesh.len()];
    for (at, target) in targets.iter().enumerate() {
        local[target.cell] = at as i32;
    }
    let mut result = Vec::new();
    for (a, target) in targets.iter().enumerate() {
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(target.cell, edge) else {
                continue;
            };
            let b = local[next];
            if b <= a as i32 {
                continue;
            }
            result.push(Edge {
                a,
                b: b as usize,
                limit: MapScale::native(
                    target.gradient.min(targets[b as usize].gradient)
                        * distance(mesh, target.cell, next),
                ),
            });
        }
    }
    result
}
struct Parcel {
    cell: usize,
    material: MaterialLayer,
}
impl Field {
    pub fn grade_ground(
        &mut self,
        targets: &[Target],
        channel: &[u8],
        basin: &[u8],
    ) -> io::Result<()> {
        let water = self.water().column.kind;
        let targets = targets
            .iter()
            .filter_map(|t| match water.get(t.cell) {
                Ok(0) => Some(Ok(Target {
                    cell: t.cell,
                    gradient: t.gradient,
                })),
                Err(e) => Some(Err(e)),
                _ => None,
            })
            .collect::<io::Result<Vec<_>>>()?;
        let elevation = self.ground().view(GroundField::Elevation);
        let mut h = targets
            .iter()
            .map(|t| elevation.get(t.cell))
            .collect::<io::Result<Vec<_>>>()?;
        let areas = targets
            .iter()
            .map(|t| self.mesh.area(t.cell))
            .collect::<Vec<_>>();
        let movable = targets
            .iter()
            .map(|t| channel[t.cell] == 0 && basin[t.cell] == 0)
            .collect::<Vec<_>>();
        let edges = edges(&self.mesh, &targets);
        let tolerance = edges
            .iter()
            .map(|edge| edge.limit * 0.05)
            .fold(f64::INFINITY, f64::min)
            .max(1.0);
        while grade_round(&mut h, &movable, &areas, &edges, tolerance) {}
        self.place_grade(&targets, &h)
    }
    fn place_grade(&mut self, targets: &[Target], h: &[f64]) -> io::Result<()> {
        let mut parcels = Vec::new();
        let mut ground = self.ground.borrow_mut();
        let elevation = ground.view(GroundField::Elevation);
        for (at, target) in targets.iter().enumerate() {
            let cell = target.cell;
            let cut = elevation.get(cell)? - h[at];
            if cut <= 0.0 {
                continue;
            }
            ground.erode_facets(
                cell,
                [cut, cut],
                "regional",
                Pool::Load,
                &mut |mut material| {
                    material.depth =
                        MapScale::metres(material.depth, LengthUnit::Native) * self.mesh.area(cell);
                    parcels.push(Parcel { cell, material });
                    Ok(())
                },
            )?;
        }
        let mut donor = 0;
        for (at, target) in targets.iter().enumerate() {
            let cell = target.cell;
            let area = self.mesh.area(cell);
            let mut fill = (h[at] - elevation.get(cell)?).max(0.0);
            while fill > 0.0 && donor < parcels.len() {
                let material = &mut parcels[donor].material;
                let volume = material
                    .depth
                    .min(MapScale::metres(fill, LengthUnit::Native) * area);
                let depth = MapScale::native(volume / area);
                let placed = ground.deposit_package(
                    cell,
                    &[MaterialLayer {
                        depth,
                        ..material.clone()
                    }],
                    "regional",
                    Pool::Load,
                    None,
                )?;
                material.depth -= MapScale::metres(placed, LengthUnit::Native) * area;
                fill -= placed;
                if material.depth <= 0.0 || placed <= 0.0 {
                    donor += 1;
                }
            }
        }
        for parcel in parcels {
            self.ground_load.add(parcel.cell, &parcel.material)?;
        }
        Ok(())
    }
    pub fn grade_seat(
        &mut self,
        center: usize,
        radius: f64,
        gradient: f64,
        channel: &[u8],
        basin: &[u8],
    ) -> io::Result<()> {
        let reach = (radius + 0.5) * self.scale.cells(1.0);
        let targets = (0..self.mesh.len())
            .filter(|&cell| distance(&self.mesh, center, cell) <= reach)
            .map(|cell| Target { cell, gradient })
            .collect::<Vec<_>>();
        self.grade_ground(&targets, channel, basin)
    }
}
