//! Publishes a laid settlement as GIS records: named streets on the roads network, the square,
//! yards and fields, buildings with use, occupants and address, bridges, wall and gates, and
//! wards (ADR 0016's settlement plan layers).
use super::{
    addresses::address,
    fields::Field,
    geometry::{add, angle, cut, distance, rectangle, resample, rest, scale, sub, unit, Point},
    lanes::WALL_THICKNESS,
    network::{Class, Street},
    plan::{Plan, Plot},
    story::Size,
    uses::Use,
};
use crate::{
    atlas::state::State,
    features::{
        chart::Chart,
        generated::Publisher,
        records::{Attributes, Relation},
        Feature,
    },
    field::poi::map_records::{generated, Record},
};
use atlas_map::{Geometry, Position};
use serde_json::{json, Value};
use std::io;

fn line(points: &[Point]) -> Geometry {
    Geometry::LineString {
        coordinates: points.iter().map(|p| Position::xy(p[0], p[1])).collect(),
    }
}
fn polygon(points: &[Point]) -> Geometry {
    Geometry::Polygon {
        coordinates: vec![points.iter().map(|p| Position::xy(p[0], p[1])).collect()],
    }
}
fn attributes(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Attributes {
    let mut result = pairs
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect::<Attributes>();
    result.insert("developedBy".into(), "regional".into());
    result
}
fn middle(points: &[Point]) -> Point {
    let sum = points.iter().fold([0.0, 0.0], |a, p| add(a, *p));
    scale(sum, 1.0 / points.len().max(1) as f64)
}
/// A record on the map, written unless the creator holds that identity.
fn write(state: &mut State, record: Record<'_>) -> io::Result<Feature> {
    let feature = generated(state, record)?;
    state.write_feature(feature.clone())?;
    Ok(feature)
}
struct Naming<'a> {
    seat: &'a str,
    culture: Option<&'a str>,
}
impl Naming<'_> {
    fn name(&self, state: &State, part: &str, work: &str, at: Point) -> io::Result<String> {
        let key = format!("town:{}:{part}", self.seat);
        Ok(state
            .naming
            .work(&state.scope, &key, work, at, self.culture)?
            .name)
    }
}
fn street_name(
    state: &State,
    naming: &Naming<'_>,
    index: usize,
    street: &Street,
    size: Size,
) -> io::Result<String> {
    let at = middle(&street.points);
    let part = format!("street:{index}");
    match (street.class, &street.destination) {
        (Class::Main | Class::Road, Some(place)) => Ok(format!("{place} Road")),
        (Class::Main, None) if index == 0 && size >= Size::Village => Ok("High Street".into()),
        (Class::Main | Class::Street, None) | (Class::Street, Some(_)) => {
            naming.name(state, &part, "street", at)
        }
        (Class::Road, None) => naming.name(state, &part, "road", at),
        (Class::Lane | Class::Alley, _) => naming.name(state, &part, "lane", at),
    }
}
pub fn publish(state: &mut State, plans: &[Plan], fields: &[Field]) -> io::Result<()> {
    for plan in plans {
        let naming = Naming {
            seat: &plan.seat.key,
            culture: plan.seat.culture.as_deref(),
        };
        let streets = streets(state, plan, &naming)?;
        square(state, plan, &naming)?;
        let wards = ward_names(state, plan, &naming)?;
        for (index, plot) in plan.plots.iter().enumerate() {
            buildings(state, plan, &naming, (index, plot), (&streets, &wards))?;
        }
        crossings(state, plan, &naming, &streets)?;
        wall(state, plan, &naming, &streets)?;
        publish_wards(state, plan, &wards)?;
    }
    publish_fields(state, fields)
}
/// Published streets: their record identity and name, by street index.
type Published = Vec<(String, String)>;
fn streets(state: &mut State, plan: &Plan, naming: &Naming<'_>) -> io::Result<Published> {
    let mut published = Vec::new();
    for (index, street) in plan.streets.iter().enumerate() {
        let name = street_name(state, naming, index, street, plan.size)?;
        let key = format!("town:{}:street:{index}", plan.seat.key);
        let feature = generated(
            state,
            Record {
                key: &key,
                name: &name,
                kind: "street",
                layer: "roads",
                geometry: line(&street.points),
                attributes: attributes([
                    ("widths", json!(street.widths)),
                    ("roadClass", json!(street.class.as_str())),
                    ("settlement", json!(plan.seat.name)),
                    ("settlementLayout", json!(plan.layout.as_str())),
                    ("destination", json!(street.destination)),
                    ("bridges", json!(street.bridges.len())),
                ]),
            },
        )?;
        published.push((feature.id.clone(), name));
        network(state, feature)?;
    }
    Ok(published)
}
/// Streets join the map's roads network, so streets meeting end to end share a junction.
fn network(state: &mut State, feature: Feature) -> io::Result<()> {
    let contracted = state.scope.contracted.contains(&feature.id);
    let scope = &state.scope;
    let publisher = Publisher {
        world: &scope.world,
        area: &scope.area,
        space: Some(&scope.space),
        owns_map_geography: scope.owns_map_geography,
        chart: Chart {
            domain: &scope.domain,
            bounds: scope.domain_bounds,
            cylindrical: scope.cylindrical,
        },
        precision: scope.precision,
    };
    publisher.network(
        state.records.features.as_mut(),
        state.records.networks.as_mut(),
        feature,
        contracted,
    )
}
fn square(state: &mut State, plan: &Plan, naming: &Naming<'_>) -> io::Result<()> {
    let Some(corners) = &plan.square else {
        return Ok(());
    };
    let name = naming.name(state, "square", "square", plan.seat.centre)?;
    write(
        state,
        Record {
            key: &format!("town:{}:square", plan.seat.key),
            name: &name,
            kind: "square",
            layer: "plots",
            geometry: polygon(corners),
            attributes: attributes([
                ("settlement", json!(plan.seat.name)),
                ("layout", json!(plan.layout.as_str())),
            ]),
        },
    )?;
    Ok(())
}
fn ward_names(state: &State, plan: &Plan, naming: &Naming<'_>) -> io::Result<Vec<String>> {
    let Some(wards) = &plan.wards else {
        return Ok(Vec::new());
    };
    (0..wards.count())
        .map(|ward| {
            let members = plan
                .plots
                .iter()
                .filter(|p| p.ward == ward)
                .map(|p| p.slot.front)
                .collect::<Vec<_>>();
            naming.name(state, &format!("ward:{ward}"), "ward", middle(&members))
        })
        .collect()
}
/// What every record on a plot carries: its address line, street, ward and settlement.
fn on_plot(
    plan: &Plan,
    plot: &Plot,
    streets: &Published,
    wards: &[String],
) -> (String, [(&'static str, Value); 6]) {
    let (street_id, street) = &streets[plot.slot.street];
    let line = address(plot.number, street);
    let common = [
        ("address", json!(line)),
        ("addressNumber", json!(plot.number)),
        ("street", json!(street)),
        ("streetId", json!(street_id)),
        ("ward", json!(wards.get(plot.ward))),
        ("settlement", json!(plan.seat.name)),
    ];
    (line, common)
}
fn buildings(
    state: &mut State,
    plan: &Plan,
    naming: &Naming<'_>,
    (index, plot): (usize, &Plot),
    (streets, wards): (&Published, &[String]),
) -> io::Result<()> {
    let (line, common) = on_plot(plan, plot, streets, wards);
    let street_id = streets[plot.slot.street].0.clone();
    let key = format!("town:{}:plot:{index}", plan.seat.key);
    let with = |extra: Vec<(&'static str, Value)>| attributes(common.iter().cloned().chain(extra));
    write(
        state,
        Record {
            key: &format!("{key}:yard"),
            name: &line,
            kind: "yard",
            layer: "plots",
            geometry: polygon(&plot.slot.corners),
            attributes: with(vec![("nameStatus", json!("label"))]),
        },
    )?;
    let keeper = naming.name(
        state,
        &format!("plot:{index}"),
        plot.use_.work(),
        plot.slot.front,
    )?;
    let household = matches!(plot.use_, Use::House | Use::Barn);
    let rotation = json!(angle(plot.slot.direction).to_degrees());
    let mut feature = generated(
        state,
        Record {
            key: &format!("{key}:building"),
            name: &keeper,
            kind: "building",
            layer: "structures",
            geometry: polygon(&plot.building),
            attributes: with(vec![
                ("use", json!(plot.use_.as_str())),
                ("occupants", json!(plot.occupants)),
                (
                    if household { "household" } else { "business" },
                    json!(keeper),
                ),
                ("rotation", rotation.clone()),
                ("storeys", json!(plot.use_.storeys(plan.size))),
            ]),
        },
    )?;
    feature.relations.push(Relation {
        target_id: street_id,
        kind: "fronts".into(),
    });
    state.write_feature(feature)?;
    let Some(barn) = &plot.barn else {
        return Ok(());
    };
    let barn = Record {
        key: &format!("{key}:barn"),
        name: &format!("{keeper} Barn"),
        kind: "building",
        layer: "structures",
        geometry: polygon(barn),
        attributes: with(vec![
            ("use", json!(Use::Barn.as_str())),
            ("occupants", json!(0)),
            ("rotation", rotation),
            ("storeys", json!(1)),
        ]),
    };
    write(state, barn).map(|_| ())
}
/// Bridges carry main streets over the water they cross.
fn crossings(
    state: &mut State,
    plan: &Plan,
    naming: &Naming<'_>,
    streets: &Published,
) -> io::Result<()> {
    for (index, street) in plan.streets.iter().enumerate() {
        for (n, &(start, stop)) in street.bridges.iter().enumerate() {
            let span = resample(
                &cut(
                    &rest(&street.points, (start - 2.0).max(0.0)),
                    stop - start + 4.0,
                ),
                2.0,
            );
            if span.len() < 2 {
                continue;
            }
            let name = naming.name(
                state,
                &format!("bridge:{index}:{n}"),
                "bridge",
                middle(&span),
            )?;
            write(
                state,
                Record {
                    key: &format!("town:{}:bridge:{index}:{n}", plan.seat.key),
                    name: &name,
                    kind: "bridge",
                    layer: "structures",
                    geometry: line(&span),
                    attributes: attributes([
                        ("widths", json!(vec![street.width() + 1.0; span.len()])),
                        ("street", json!(streets[index].1)),
                        ("streetId", json!(streets[index].0)),
                        ("span", json!((stop - start).round())),
                    ]),
                },
            )?;
        }
    }
    Ok(())
}
fn wall(
    state: &mut State,
    plan: &Plan,
    naming: &Naming<'_>,
    streets: &Published,
) -> io::Result<()> {
    let Some(wall) = &plan.wall else {
        return Ok(());
    };
    write(
        state,
        Record {
            key: &format!("town:{}:wall", plan.seat.key),
            name: &format!("{} wall", plan.seat.name),
            kind: "wall",
            layer: "structures",
            geometry: line(&wall.ring),
            attributes: attributes([
                ("widths", json!(vec![WALL_THICKNESS; wall.ring.len()])),
                ("gates", json!(wall.gates.len())),
                ("settlement", json!(plan.seat.name)),
            ]),
        },
    )?;
    for (n, &gate) in wall.gates.iter().enumerate() {
        let through = plan.streets.iter().position(|s| {
            s.class == Class::Main && s.points.iter().any(|p| distance(*p, gate) < 12.0)
        });
        let name = match through.and_then(|i| plan.streets[i].destination.as_ref()) {
            Some(place) => format!("{place} Gate"),
            None => naming.name(state, &format!("gate:{n}"), "gate", gate)?,
        };
        let outward = unit(sub(gate, plan.seat.centre));
        let front = sub(gate, scale(outward, WALL_THICKNESS));
        let corners = rectangle(
            front,
            super::geometry::left(outward),
            outward,
            8.0,
            2.0 * WALL_THICKNESS,
        );
        write(
            state,
            Record {
                key: &format!("town:{}:gate:{n}", plan.seat.key),
                name: &name,
                kind: "gate",
                layer: "structures",
                geometry: polygon(&corners),
                attributes: attributes([
                    ("street", json!(through.map(|i| streets[i].1.clone()))),
                    ("settlement", json!(plan.seat.name)),
                ]),
            },
        )?;
    }
    Ok(())
}
/// Each ward's outline is the ground its plots and their streets cover.
fn publish_wards(state: &mut State, plan: &Plan, names: &[String]) -> io::Result<()> {
    let Some(wards) = &plan.wards else {
        return Ok(());
    };
    for (ward, name) in names.iter().enumerate() {
        let plots = plan
            .plots
            .iter()
            .filter(|p| p.ward == ward)
            .collect::<Vec<_>>();
        if plots.is_empty() {
            continue;
        }
        let buffered = plots
            .iter()
            .map(|p| state.spatial.buffer(&polygon(&p.slot.corners), 4.0))
            .collect::<Result<Vec<_>, _>>()
            .map_err(io::Error::other)?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let Some(outline) = state
            .spatial
            .union_all(&buffered)
            .map_err(io::Error::other)?
        else {
            continue;
        };
        let mut streets = plots.iter().map(|p| p.slot.street).collect::<Vec<_>>();
        streets.sort_unstable();
        streets.dedup();
        write(
            state,
            Record {
                key: &format!("town:{}:ward:{ward}", plan.seat.key),
                name,
                kind: "ward",
                layer: "settlements",
                geometry: outline,
                attributes: attributes([
                    ("settlement", json!(plan.seat.name)),
                    ("buildings", json!(plots.len())),
                    (
                        "residents",
                        json!(plots.iter().map(|p| p.occupants).sum::<u32>()),
                    ),
                    ("streets", json!(streets.len())),
                    ("suburb", json!(wards.suburb(ward))),
                ]),
            },
        )?;
    }
    Ok(())
}
fn publish_fields(state: &mut State, fields: &[Field]) -> io::Result<()> {
    for (index, field) in fields.iter().enumerate() {
        let [x, y] = middle(&field.corners[..4]);
        write(
            state,
            Record {
                key: &format!("town:field:{x:.1}:{y:.1}:{index}"),
                name: if field.pasture { "Pasture" } else { "Field" },
                kind: "field",
                layer: "plots",
                geometry: polygon(&field.corners),
                attributes: attributes([
                    (
                        "fieldUse",
                        json!(if field.pasture { "pasture" } else { "arable" }),
                    ),
                    ("nameStatus", json!("label")),
                ]),
            },
        )?;
    }
    Ok(())
}
