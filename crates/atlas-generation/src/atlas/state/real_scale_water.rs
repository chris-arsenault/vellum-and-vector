//! A real-scale map's water at its real size. The water model sizes its channels at their
//! real width and depth (`water/channel_geometry.rs`), so the drawn rivers carry them; pools
//! are published on those channels, and every way that meets a channel fords it or, for a
//! road or street over deep water, bridges it.
use super::{real_scale_ground::line, State};
use crate::{
    features::{
        line_profile::{pieces, vertex_values, Piece},
        records::Attributes,
        Feature, Relation,
    },
    field::poi::{
        kinds::Kind,
        publication::Publication,
        true_sizes::{
            self, crossing_size, length_text, long_tail, roll, BRIDGE_DECK, FORD_BREADTH,
        },
        values::Moment,
    },
    processes::ground::{
        crossings::{self, Crossing, Form, Water, Way},
        settings::DECK_MARGIN,
    },
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

/// A drawn channel with the widths and discharges it states at every vertex.
pub(crate) struct Drawn {
    feature: Feature,
    parts: Vec<Piece>,
    widths: Vec<f64>,
    discharges: Vec<f64>,
}
impl State {
    fn drawn_channels(&self) -> io::Result<Vec<Drawn>> {
        Ok(self
            .layer_features("rivers")?
            .into_iter()
            .filter_map(|feature| {
                let parts = pieces(&feature.geometry);
                let widths = vertex_values(&feature.attributes, "widths", &parts)?;
                let discharges = vertex_values(&feature.attributes, "discharges", &parts)?;
                Some(Drawn {
                    feature,
                    parts,
                    widths,
                    discharges,
                })
            })
            .collect())
    }
    /// Pools on the drawn channels, published through the place catalogue.
    pub fn publish_pools(&mut self) -> io::Result<()> {
        for mut river in self.layer_features("rivers")? {
            if self.size_carried_channel(&mut river)? {
                self.records.features.put(river)?;
            }
        }
        self.publish_places(&mut Publication::default(), Moment::Ground)
    }
    /// An inherited course can have a known discharge but no located cross-sections.
    /// Survey the drawn stations on the local bed with the water owner's real-scale relation.
    fn size_carried_channel(&self, river: &mut Feature) -> io::Result<bool> {
        let parts = pieces(&river.geometry);
        let widths = vertex_values(&river.attributes, "widths", &parts);
        let flows = vertex_values(&river.attributes, "discharges", &parts);
        if parts.is_empty() || (widths.is_some() && flows.is_some()) {
            return Ok(false);
        }
        let captured = river.attributes.get("discharge").and_then(|v| v.as_f64());
        let field = self.field();
        let water = field.water();
        let mut station_widths = Vec::new();
        let mut station_flows = Vec::new();
        let mut station_depths = Vec::new();
        for part in &parts {
            for (i, &point) in part.points.iter().enumerate() {
                let Some(cell) = self.cell_under(point) else {
                    return Ok(false);
                };
                let local_width = water.channels.width.get(cell)?;
                let local_flow = water.flow.mean.get(cell)?;
                let at = part.offset + i;
                let Some(flow) = flows
                    .as_ref()
                    .map(|v| v[at])
                    .or((local_width > 0. && local_flow > 0.).then_some(local_flow))
                    .or(captured)
                else {
                    return Ok(false);
                };
                let width = if let Some(values) = &widths {
                    values[at]
                } else {
                    let bed = field
                        .ground()
                        .section(cell, crate::settlement::removal::Facet::Land)?;
                    let family = crate::rock::ground::queries::bed_family(&bed);
                    crate::processes::ground::channels::channel(flow, family).width
                };
                station_widths.push(width);
                station_flows.push(flow);
                station_depths.push(crate::processes::ground::channels::depth(flow, width));
            }
        }
        river
            .attributes
            .insert("widths".into(), json!(station_widths));
        river
            .attributes
            .insert("discharges".into(), json!(station_flows));
        river
            .attributes
            .insert("depths".into(), json!(station_depths));
        Ok(true)
    }
    /// Points where the map already crosses water: bridges and fords, wherever they came from.
    fn existing_crossings(&self) -> io::Result<Vec<[f64; 2]>> {
        let mut points = Vec::new();
        for layer in ["structures", "transportSites"] {
            for feature in self.layer_features(layer)? {
                if feature.kind != "bridge" && feature.kind != "ford" {
                    continue;
                }
                let parts = pieces(&feature.geometry);
                let middle = parts
                    .first()
                    .and_then(|p| p.points.get(p.points.len() / 2).copied());
                let point = match (&feature.geometry, middle) {
                    (Geometry::Point { coordinates }, _) => {
                        let [x, y, _] = coordinates.coordinates();
                        Some([x, y])
                    }
                    (_, middle) => middle,
                };
                points.extend(point);
            }
        }
        Ok(points)
    }
    /// Fords where ways wade shallow water and bridges where roads and streets cross deeper
    /// water, beside none already there.
    pub(crate) fn publish_crossings(
        &mut self,
        strategy: &crate::atlas::dispatch::registration::ground::RouteStrategy<
            crate::atlas::dispatch::registration::ground::Channels,
        >,
    ) -> io::Result<()> {
        let ways = strategy
            .boundary
            .bind(|_| self.way_lines().map(Some))?
            .unwrap_or_default();
        let channels = strategy
            .initial
            .bind(|_| self.drawn_channels().map(Some))?
            .unwrap_or_default();
        let existing = self.existing_crossings()?;
        // Each piece of a line is its own way or channel; `owners` maps a piece back to its line.
        let mut way_pieces = Vec::new();
        let mut way_widths = Vec::new();
        let mut bridge_spans = Vec::new();
        for (index, (feature, parts)) in ways.iter().enumerate() {
            let widths = vertex_values(&feature.attributes, "widths", parts);
            let spans: Option<Vec<(f64, f64)>> = if feature.kind == "road" {
                None
            } else {
                Some(
                    feature
                        .attributes
                        .get("bridgeSpans")
                        .map(|value| serde_json::from_value(value.clone()))
                        .transpose()?
                        .unwrap_or_default(),
                )
            };
            bridge_spans.push(spans);
            for piece in parts {
                let span = widths
                    .as_ref()
                    .map(|w| w[piece.offset..piece.offset + piece.points.len()].to_vec());
                way_pieces.push((index, piece));
                way_widths.push(span);
            }
        }
        let mut water_pieces = Vec::new();
        for (index, drawn) in channels.iter().enumerate() {
            for piece in &drawn.parts {
                water_pieces.push((index, piece));
            }
        }
        let found = crossings::crossings(
            &way_pieces
                .iter()
                .zip(&way_widths)
                .map(|((index, piece), widths)| Way {
                    points: &piece.points,
                    widths: widths.as_deref(),
                    bridge_spans: bridge_spans[*index].as_deref(),
                })
                .collect::<Vec<_>>(),
            &water_pieces
                .iter()
                .map(|(index, piece)| {
                    let span = piece.offset..piece.offset + piece.points.len();
                    Water {
                        points: &piece.points,
                        widths: &channels[*index].widths[span.clone()],
                        discharges: &channels[*index].discharges[span],
                    }
                })
                .collect::<Vec<_>>(),
            &existing,
        );
        let mut features = Vec::new();
        for crossing in &found {
            let way = &ways[way_pieces[crossing.way].0].0;
            let water = &channels[water_pieces[crossing.water].0].feature;
            features.push(self.crossing_record(crossing, way, water)?);
        }
        for feature in features {
            self.put_ground(feature)?;
        }
        Ok(())
    }
    fn crossing_record(
        &self,
        crossing: &Crossing,
        way: &Feature,
        water: &Feature,
    ) -> io::Result<Feature> {
        let [x, y] = crossing.at;
        let key = format!("crossing:{x:.1}:{y:.1}");
        let bridged = crossing.form == Form::Bridge;
        let breadth = match (bridged, crossing.way_width) {
            (true, Some(width)) => width + DECK_MARGIN,
            (true, None) => long_tail(roll(&key, 1), &BRIDGE_DECK),
            (false, _) => long_tail(roll(&key, 1), &FORD_BREADTH),
        };
        let kind = if bridged { Kind::Bridge } else { Kind::Ford };
        let mut attributes = Attributes::new();
        for (name, value) in [
            ("riverWidth", json!(crossing.width)),
            ("depth", json!(crossing.depth)),
            ("way", json!(way.name)),
            ("river", json!(water.name)),
            (
                "trueSize",
                serde_json::to_value(crossing_size(crossing.width, breadth, bridged))?,
            ),
            (
                "account",
                json!(format!(
                    "{} The water runs about {} wide and {} deep here.",
                    true_sizes::reason(kind),
                    length_text(crossing.width),
                    length_text(crossing.depth)
                )),
            ),
        ] {
            attributes.insert(name.into(), value);
        }
        let mut feature = if bridged {
            let span = crossings::span(crossing);
            attributes.insert("widths".into(), json!([breadth, breadth]));
            attributes.insert("span".into(), json!(crossing.width.round()));
            self.ground_record(
                key,
                ("structures", "bridge", "Bridge"),
                line(&span),
                attributes,
            )?
        } else {
            self.ground_record(
                key,
                ("transportSites", "ford", "Ford"),
                Geometry::Point {
                    coordinates: Position::xy(x, y),
                },
                attributes,
            )?
        };
        for (target, relation) in [(&water.id, "crosses"), (&way.id, "carries")] {
            feature.relations.push(Relation {
                target_id: *target,
                kind: relation.into(),
            });
        }
        Ok(feature)
    }
}
