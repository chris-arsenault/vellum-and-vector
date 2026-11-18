//! Trails on a real-scale map: from each place people visit that no way reaches, the cheapest
//! walk over the map's triangles to the nearest way or settlement (`processes/ground/trails.rs`).
use super::{real_scale_ground::metres, State};
use crate::{
    features::{line_profile::Piece, records::Attributes, Feature, FeatureSelection, Relation},
    field::{poi::contract::TrailRole, shared::Scalar},
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

impl State {
    fn walking_places(&self) -> io::Result<Vec<(Feature, TrailRole)>> {
        let mut places = Vec::new();
        for feature in self.records.features.values(FeatureSelection {
            area_id: Some(&self.scope.area),
            ..Default::default()
        })? {
            let feature = feature?;
            let role = self.catalogue.walking_role(&feature).or_else(|| {
                (feature
                    .attributes
                    .get("walkingDestination")
                    .and_then(|v| v.as_bool())
                    == Some(true))
                .then_some(TrailRole::Destination)
            });
            if let Some(role) = role {
                places.push((feature, role));
            }
        }
        Ok(places)
    }
    fn destination(&self, feature: &Feature) -> io::Result<[f64; 2]> {
        let [x, y, _] = self
            .spatial
            .interior_position(&feature.geometry)
            .map_err(io::Error::other)?
            .coordinates();
        Ok([x, y])
    }
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
    fn trail_ends(
        &self,
        ways: &[(Feature, Vec<Piece>)],
        places: &[(Feature, TrailRole)],
    ) -> io::Result<Vec<bool>> {
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
        for (hub, _) in places
            .iter()
            .filter(|(_, role)| *role == TrailRole::Junction)
        {
            if let Some(cell) = self.cell_under(self.destination(hub)?) {
                ends[cell] = true;
            }
        }
        Ok(ends)
    }
    /// Places people visit that no way reaches, nearest first so farther trails join them.
    fn unreached(
        &self,
        ways: &[(Feature, Vec<Piece>)],
        destinations: Vec<(Feature, TrailRole)>,
    ) -> io::Result<Vec<(Feature, usize)>> {
        let mut places = Vec::new();
        let paths: Vec<_> = ways.iter().map(|(f, _)| f.geometry.clone()).collect();
        let index = self.spatial.index(&paths).map_err(io::Error::other)?;
        for (feature, _) in destinations {
            let point = self.destination(&feature)?;
            let position = atlas_map::Position::xy(point[0], point[1]);
            let away = match index.nearest(position).map_err(io::Error::other)? {
                Some(i) => self
                    .spatial
                    .distance(&feature.geometry, &paths[i])
                    .map_err(io::Error::other)?,
                None => f64::INFINITY,
            };
            if away < REACHED_WITHIN {
                continue;
            }
            if let Some(cell) = self.cell_under(point) {
                places.push((away, feature, cell));
            }
        }
        // hpc-exempt: ordering a map's few hundred unreached places by distance.
        places.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.id.cmp(&b.1.id)));
        Ok(places.into_iter().map(|(_, f, cell)| (f, cell)).collect())
    }
    /// Lays the map's trails and records them in the roads network.
    pub fn lay_trails(&mut self) -> io::Result<()> {
        let ways = self.way_lines()?;
        let destinations = self.walking_places()?;
        let ends = self.trail_ends(&ways, &destinations)?;
        let places = self.unreached(&ways, destinations)?;
        if places.is_empty() {
            return Ok(());
        }
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
