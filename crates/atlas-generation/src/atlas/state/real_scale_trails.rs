//! Trails on a real-scale map: from each place people visit that no way reaches, the cheapest
//! walk over the map's triangles to the nearest way or settlement (`processes/ground/trails.rs`).
use super::{real_scale_ground::metres, State};
use crate::{
    features::{line_profile::Piece, records::Attributes, Feature, Relation},
    field::{poi::reads, shared::Scalar},
    processes::ground::{
        distance,
        settings::{
            DENSE_COVER_COST, FORD_COST, FORD_DEPTH, REACHED_WITHIN, TRAIL_GRADE, TRAIL_NARROW,
            TRAIL_SMOOTHING, TRAIL_WIDE, WATER_COST, WET_COST,
        },
        trails::{self, Graph},
    },
};
use serde_json::json;
use std::io;

/// Kinds of place people walk to, by layer; any feature of the listed layers with no kinds.
const VISITED: &[(&str, &[&str])] = &[
    ("settlements", &["settlement"]),
    ("caveEntrances", &[]),
    ("geology", &["spring", "peak", "waterfall"]),
    ("magicPractices", &[]),
    ("landUse", &["mine"]),
    ("structures", &["building"]),
];
fn point_of(feature: &Feature) -> Option<[f64; 2]> {
    let [x, y, _] = reads::first_coordinate(&feature.geometry)?.coordinates();
    Some([x, y])
}
/// Distance from a point to the nearest way.
fn to_ways(point: [f64; 2], ways: &[(Feature, Vec<Piece>)]) -> f64 {
    let mut nearest = f64::INFINITY;
    for piece in ways.iter().flat_map(|(_, parts)| parts) {
        for pair in piece.points.windows(2) {
            let [a, b] = [pair[0], pair[1]];
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let run = dx * dx + dy * dy;
            let t = if run > 0.0 {
                (((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / run).clamp(0.0, 1.0)
            } else {
                0.0
            };
            nearest = nearest.min(distance(point, [a[0] + t * dx, a[1] + t * dy]));
        }
    }
    nearest
}
impl State {
    /// Walking cost per metre through one triangle.
    fn walking_cost(&self, cell: usize) -> io::Result<f64> {
        let field = self.field();
        let shared = field.shared();
        let grade = shared.scalar(Scalar::Slope).get(cell)? / TRAIL_GRADE;
        let mut cost = 1.0
            + grade * grade
            + DENSE_COVER_COST * shared.scalar(Scalar::TreeCover).get(cell)?
            + WET_COST * shared.scalar(Scalar::WetlandCover).get(cell)?;
        let water = field.water();
        if water.column.kind.get(cell)? != 0 {
            cost *= WATER_COST;
        } else if water.river_orders.get(cell)? > 0 {
            // The water model sized this channel at its real depth.
            cost *= if water.channels.depth.get(cell)? < FORD_DEPTH {
                FORD_COST
            } else {
                WATER_COST
            };
        }
        Ok(cost)
    }
    /// Triangles a trail can end on: those the ways cross and those settlements stand on.
    fn trail_ends(&self, ways: &[(Feature, Vec<Piece>)]) -> io::Result<Vec<bool>> {
        let mesh = self.field().mesh();
        let mut ends = vec![false; mesh.len()];
        let step = mesh.spacing() / 2.0;
        for piece in ways.iter().flat_map(|(_, parts)| parts) {
            for pair in piece.points.windows(2) {
                let samples = (distance(pair[0], pair[1]) / step).ceil().max(1.0) as usize;
                for s in 0..=samples {
                    let t = s as f64 / samples as f64;
                    let p = [
                        pair[0][0] + t * (pair[1][0] - pair[0][0]),
                        pair[0][1] + t * (pair[1][1] - pair[0][1]),
                    ];
                    if let Some(cell) = self.cell_under(p) {
                        ends[cell] = true;
                    }
                }
            }
        }
        for settlement in self.layer_features("settlements")? {
            if let Some(cell) = point_of(&settlement).and_then(|p| self.cell_under(p)) {
                ends[cell] = true;
            }
        }
        Ok(ends)
    }
    /// Places people visit that no way reaches, nearest first so farther trails join them.
    fn unreached(&self, ways: &[(Feature, Vec<Piece>)]) -> io::Result<Vec<(Feature, usize)>> {
        let mut places = Vec::new();
        for (layer, kinds) in VISITED {
            for feature in self.layer_features(layer)? {
                if !kinds.is_empty() && !kinds.contains(&feature.kind.as_str()) {
                    continue;
                }
                let Some(point) = point_of(&feature) else {
                    continue;
                };
                let away = to_ways(point, ways);
                if away < REACHED_WITHIN {
                    continue;
                }
                if let Some(cell) = self.cell_under(point) {
                    places.push((away, feature, cell));
                }
            }
        }
        // hpc-exempt: ordering a map's few hundred unreached places by distance.
        places.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.id.cmp(&b.1.id)));
        Ok(places.into_iter().map(|(_, f, cell)| (f, cell)).collect())
    }
    /// Lays the map's trails and records them in the roads network.
    pub fn lay_trails(&mut self) -> io::Result<()> {
        let ways = self.way_lines()?;
        let places = self.unreached(&ways)?;
        if places.is_empty() {
            return Ok(());
        }
        let ends = self.trail_ends(&ways)?;
        let mesh = self.field().mesh();
        let [ox, oy] = mesh.origin();
        let positions: Vec<[f64; 2]> = (0..mesh.len())
            .map(|cell| {
                let [x, y] = mesh.position(cell);
                [x + ox, y + oy]
            })
            .collect();
        let neighbours: Vec<[Option<usize>; 3]> = (0..mesh.len())
            .map(|cell| [0, 1, 2].map(|edge| mesh.neighbor(cell, edge)))
            .collect();
        let cost = (0..mesh.len())
            .map(|cell| self.walking_cost(cell))
            .collect::<io::Result<Vec<_>>>()?;
        let graph = Graph {
            positions: &positions,
            neighbours: &neighbours,
            cost: &cost,
        };
        let sources: Vec<usize> = places.iter().map(|(_, cell)| *cell).collect();
        let (laid, uses) = trails::lay(&graph, &sources, &ends);
        let mut ids: Vec<String> = Vec::new();
        for trail in &laid {
            let place = &places[trail.source].0;
            let feature = self.trail_record(
                trail,
                place,
                &positions,
                &uses,
                trail.joins.map(|t| ids[t].as_str()),
            )?;
            ids.push(feature.id.clone());
            self.write_network(feature)?;
        }
        Ok(())
    }
    fn trail_record(
        &self,
        trail: &trails::Trail,
        place: &Feature,
        positions: &[[f64; 2]],
        uses: &[u32],
        joins: Option<&str>,
    ) -> io::Result<Feature> {
        let points: Vec<[f64; 2]> = trail.cells.iter().map(|&c| positions[c]).collect();
        let widths: Vec<[f64; 2]> = trail
            .cells
            .iter()
            .map(|&c| {
                let walkers = f64::from(uses[c].max(1));
                [
                    TRAIL_NARROW + (TRAIL_WIDE - TRAIL_NARROW) * (1.0 - 1.0 / walkers),
                    0.0,
                ]
            })
            .collect();
        let line = trails::smooth(&points, TRAIL_SMOOTHING);
        let widths: Vec<f64> = trails::smooth(&widths, TRAIL_SMOOTHING)
            .iter()
            .map(|w| w[0])
            .collect();
        let field = self.field();
        let elevation = field
            .ground()
            .view(crate::rock::ground::GroundField::Elevation);
        let rise = trail
            .cells
            .windows(2)
            .map(|pair| {
                Ok((metres(elevation.get(pair[1])?) - metres(elevation.get(pair[0])?)).abs())
            })
            .sum::<io::Result<f64>>()?;
        let mut attributes = Attributes::new();
        attributes.insert("widths".into(), json!(widths));
        attributes.insert("leadsTo".into(), json!(place.name));
        attributes.insert("climb".into(), json!(rise.round()));
        let [x, y] = points[0];
        let mut feature = self.ground_record(
            format!("trail:{}:{x:.0}:{y:.0}", place.id),
            ("roads", "trail", "Trail"),
            super::real_scale_ground::line(&line),
            attributes,
        )?;
        feature.relations.push(Relation {
            target_id: place.id.clone(),
            kind: "leadsTo".into(),
        });
        if let Some(earlier) = joins {
            feature.relations.push(Relation {
                target_id: earlier.into(),
                kind: "joins".into(),
            });
        }
        Ok(feature)
    }
}
