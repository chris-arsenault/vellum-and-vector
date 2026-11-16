//! Publish the routes people actually travelled through their neighbouring countries.
use super::{
    place_country::{KnownWay, WayKind},
    traditions::Kind,
};
use crate::{
    features::{
        generated,
        network::NetworkWorkspace,
        network_parts::line_parts,
        publication::{RegionalPublisher, RegionalRecord},
        Feature, FeatureWorkspace,
    },
    field::{
        poi::{
            land_places,
            map_records::{self, Record},
            work_records::WorkState,
        },
        Field,
    },
    hpc::{BitSet, TopK},
    water::visibility::unwrap,
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

/// Triangle centres alternate between two offset rows, so a chain of route cells
/// zigzags with a one-cell period. A [1, 2, 1] / 4 neighbour average cancels that
/// alternation exactly while keeping the route's larger bends and its two ends.
fn straightened(line: Vec<Position>) -> Vec<Position> {
    if line.len() <= 2 {
        return line;
    }
    let mut out = Vec::with_capacity(line.len());
    out.push(line[0]);
    for triple in line.windows(3) {
        let [ax, ay, _] = triple[0].coordinates();
        let [bx, by, _] = triple[1].coordinates();
        let [cx, cy, _] = triple[2].coordinates();
        out.push(Position::xy(
            (ax + 2.0 * bx + cx) / 4.0,
            (ay + 2.0 * by + cy) / 4.0,
        ));
    }
    out.push(*line.last().unwrap());
    out
}
fn course(mut line: Vec<Position>) -> Vec<Position> {
    for _ in 0..2 {
        if line.len() <= 2 {
            break;
        }
        let mut cut = Vec::with_capacity(line.len() * 2);
        cut.push(line[0]);
        for segment in line.windows(2) {
            let [ax, ay, _] = segment[0].coordinates();
            let [bx, by, _] = segment[1].coordinates();
            cut.push(Position::xy(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by));
            cut.push(Position::xy(0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by));
        }
        cut.push(*line.last().unwrap());
        line = cut;
    }
    line
}
fn stretches(field: &Field, cells: &[usize]) -> Vec<Vec<usize>> {
    let mut runs: Vec<Vec<usize>> = Vec::new();
    for (at, &cell) in cells.iter().enumerate() {
        let touching =
            at > 0 && (0..3).any(|edge| field.mesh.neighbor(cells[at - 1], edge) == Some(cell));
        if touching {
            runs.last_mut().unwrap().push(cell);
        } else {
            runs.push(vec![cell]);
        }
    }
    runs.retain(|run| run.len() > 1);
    runs
}
fn drawn(field: &Field, runs: &[Vec<usize>]) -> Geometry {
    let [ox, oy] = field.mesh.origin();
    let mut lines: Vec<_> = runs
        .iter()
        .map(|run| {
            let mut line = run
                .iter()
                .map(|&cell| {
                    let [x, y] = field.mesh.position(cell);
                    Position::xy(x + ox, y + oy)
                })
                .collect::<Vec<_>>();
            unwrap(&mut line, field.mesh.periodic_width());
            course(straightened(line))
        })
        .collect();
    if lines.len() == 1 {
        Geometry::LineString {
            coordinates: lines.remove(0),
        }
    } else {
        Geometry::MultiLineString { coordinates: lines }
    }
}
fn highways(state: &impl WorkState, shown: &[&KnownWay], each: usize) -> BitSet {
    let mut kept = BitSet::new(shown.len());
    if each == 0 {
        return kept;
    }
    for realm in &state.traditions().known {
        if realm.kind != Kind::Allegiance || realm.ended.is_some() {
            continue;
        }
        let Some(seat) = &realm.seat else {
            continue;
        };
        let mut busiest = TopK::new(each);
        for (at, known) in shown.iter().enumerate() {
            if known.kind != WayKind::Lane && (&known.from == seat || &known.to == seat) {
                busiest.consider(at as u32, known.travellers);
            }
        }
        for at in busiest.best() {
            kept.add(at as usize);
        }
    }
    kept
}
fn way(
    state: &impl WorkState,
    known: &KnownWay,
    highway: bool,
    runs: &[Vec<usize>],
    space: Option<&str>,
) -> io::Result<Feature> {
    let places = &state.known_places().known;
    let a = places
        .iter()
        .find(|p| p.id == known.from)
        .ok_or_else(|| io::Error::other("A route has no starting place"))?;
    let b = places
        .iter()
        .find(|p| p.id == known.to)
        .ok_or_else(|| io::Error::other("A route has no ending place"))?;
    let from = land_places::record_id(state, a)?;
    let to = land_places::record_id(state, b)?;
    let label = format!(
        "{}–{}",
        state
            .features()
            .get(&from)?
            .map(|f| f.name)
            .unwrap_or_default(),
        state
            .features()
            .get(&to)?
            .map(|f| f.name)
            .unwrap_or_default()
    );
    let kind = if known.kind == WayKind::Lane {
        "lane"
    } else {
        "road"
    };
    let key = format!("{kind}:{}:{}", a.id, b.id);
    let geometry = state
        .chart()
        .geometry(&drawn(state.field()?, runs), state.spatial())
        .map_err(io::Error::other)?;
    let mut attributes = crate::features::records::Attributes::new();
    for (key, value) in [
        ("fromPlace", json!(from)),
        ("toPlace", json!(to)),
        ("travelCost", json!(known.cost)),
        (
            "roadClass",
            if highway {
                json!("highway")
            } else {
                serde_json::to_value(known.kind)?
            },
        ),
        (
            "wayKind",
            json!(if known.kind == WayKind::Lane {
                "sea"
            } else {
                "land"
            }),
        ),
        ("travellers", json!((known.travellers + 0.5).floor())),
        (
            "routePopulation",
            json!((a.town_people.min(b.town_people) + 0.5).floor()),
        ),
        (
            "strategic",
            json!([a, b]
                .iter()
                .any(|p| p.town_people >= 4.0 * state.known_places().town)),
        ),
    ] {
        attributes.insert(key.into(), value);
    }
    if runs.len() > 1 {
        attributes.insert("crossings".into(), (runs.len() - 1).into());
    }
    if !state.regional() {
        return map_records::generated(
            state,
            Record {
                key: &key,
                name: &label,
                kind,
                layer: "roads",
                geometry,
                attributes,
            },
        );
    }
    RegionalPublisher {
        world: state.world_id(),
        area: state.area_id(),
        space,
        chart: state.chart(),
        spatial: state.spatial(),
    }
    .feature(RegionalRecord {
        key,
        kind: kind.into(),
        layer_id: "roads".into(),
        generation_domain: state.generation_domain("roads"),
        geometry,
        attributes,
        label,
        named: None,
    })
}
pub struct Options<'a> {
    pub highways: usize,
    pub space: Option<&'a str>,
    pub owns_map_geography: bool,
}
pub struct DrawnWay {
    pub feature: Feature,
    pub travellers: f64,
}
pub fn records(
    state: &impl WorkState,
    options: &Options<'_>,
    mut progress: impl FnMut(f64, &str),
) -> io::Result<Vec<DrawnWay>> {
    let recorded = |id: &str| -> io::Result<bool> {
        let places = state.known_places();
        let Some(place) = places.known.iter().find(|p| p.id == id) else {
            return Ok(false);
        };
        Ok(state
            .features()
            .get(&land_places::record_id(state, place)?)?
            .is_some())
    };
    let mut shown = Vec::new();
    let known_ways = state.known_ways();
    for known in known_ways.iter() {
        if known.kind != WayKind::Path && recorded(&known.from)? && recorded(&known.to)? {
            shown.push(known);
        }
    }
    let kept = highways(state, &shown, options.highways);
    let mut records = Vec::new();
    for (at, known) in shown.iter().enumerate() {
        progress(
            at as f64 / shown.len() as f64,
            "Laying the roads people made",
        );
        let runs = stretches(state.field()?, &known.cells);
        if runs.is_empty() {
            continue;
        }
        let feature = way(state, known, kept.has(at), &runs, options.space)?;
        records.push(DrawnWay {
            feature,
            travellers: (known.travellers + 0.5).floor(),
        });
    }
    Ok(records)
}
pub struct Writer<'a> {
    pub publisher: generated::Publisher<'a>,
    pub spatial: &'a dyn crate::spatial::SpatialKernel,
    pub regional: bool,
}
impl Writer<'_> {
    pub fn write(
        &self,
        features: &mut dyn FeatureWorkspace,
        networks: &mut dyn NetworkWorkspace,
        drawn: DrawnWay,
        contracted: bool,
    ) -> io::Result<()> {
        let publisher = &self.publisher;
        if !self.regional {
            return publisher.network(features, networks, drawn.feature, contracted);
        }
        features.put(drawn.feature.clone())?;
        let regional = RegionalPublisher {
            world: publisher.world,
            area: publisher.area,
            space: publisher.space,
            chart: crate::features::chart::Chart {
                domain: publisher.chart.domain,
                bounds: publisher.chart.bounds,
                cylindrical: publisher.chart.cylindrical,
            },
            spatial: self.spatial,
        };
        for line in line_parts(&drawn.feature.geometry) {
            regional.network(networks, &drawn.feature, drawn.travellers, Some(line))?;
        }
        Ok(())
    }
}
pub fn publish(
    state: &impl WorkState,
    features: &mut dyn FeatureWorkspace,
    networks: &mut dyn NetworkWorkspace,
    options: &Options<'_>,
    contracted: &impl Fn(&Feature) -> bool,
    progress: impl FnMut(f64, &str),
) -> io::Result<()> {
    let publisher = generated::Publisher {
        world: state.world_id(),
        area: state.area_id(),
        space: options.space,
        owns_map_geography: options.owns_map_geography,
        chart: state.chart(),
        precision: state.geometry_precision(),
    };
    let writer = Writer {
        publisher,
        spatial: state.spatial(),
        regional: state.regional(),
    };
    for drawn in records(state, options, progress)? {
        let protected = contracted(&drawn.feature);
        writer.write(features, networks, drawn, protected)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn straightening_removes_the_lattice_zigzag() {
        let zigzag: Vec<_> = (0..9)
            .map(|i| Position::xy(f64::from(i), if i % 2 == 0 { -0.3 } else { 0.3 }))
            .collect();
        let line = straightened(zigzag);
        for point in &line[1..line.len() - 1] {
            assert!(point.coordinates()[1].abs() < 1e-12);
        }
        assert_eq!(line[0].coordinates()[1], -0.3);
    }
}
