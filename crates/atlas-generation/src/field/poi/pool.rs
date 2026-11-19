//! Pools on a real-scale map's streams (ADR 0016): deep water where the flow slackens, where two
//! streams meet, or on the outside of a tight bend. They are found on the channels as drawn at
//! their real width, so they exist only where a map shows channels at that size and publish
//! once the map's ground detail is laid (`Moment::Ground`).
use super::{
    catalogue::CatalogueState,
    contract::*,
    kinds::{Group, Kind},
    map_records::{self, MapState, Record},
    true_sizes,
    values::*,
};
use crate::{
    features::{
        line_profile::{pieces, vertex_values},
        records::Attributes,
        Feature, FeatureSelection,
    },
    processes::ground::pools::{self, Cause, Course, Pool},
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::{io, rc::Rc};

fn junctions(feature: &Feature) -> Vec<[f64; 2]> {
    feature
        .attributes
        .get("junctions")
        .and_then(|v| v.as_array())
        .map(|points| {
            points
                .iter()
                .filter_map(|p| Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?]))
                .collect()
        })
        .unwrap_or_default()
}
/// The pools along one published channel, each with the piece of the line it sits on. A
/// junction makes a pool only on the piece it meets (`processes/ground/pools.rs`).
fn on_channel(feature: &Feature) -> Vec<(usize, Pool)> {
    let parts = pieces(&feature.geometry);
    let read = |name| vertex_values(&feature.attributes, name, &parts);
    let (Some(beds), Some(widths), Some(depths)) =
        (read("bedElevations"), read("widths"), read("depths"))
    else {
        return Vec::new();
    };
    let joins = junctions(feature);
    parts
        .iter()
        .enumerate()
        .flat_map(|(at, piece)| {
            let span = piece.offset..piece.offset + piece.points.len();
            pools::pools(&Course {
                points: &piece.points,
                beds: &beds[span.clone()],
                widths: &widths[span.clone()],
                depths: &depths[span],
                junctions: &joins,
            })
            .into_iter()
            .map(move |pool| (at, pool))
        })
        .collect()
}
/// A pool's place identity: its channel, the piece of the line and the vertex it sits at.
fn place_id(feature: &Feature, piece: usize, pool: &Pool) -> String {
    format!("pool:{}:{piece}:{}", feature.id, pool.vertex)
}
fn record<S: MapState>(state: &S, feature: &Feature, pool: &Pool) -> io::Result<Feature> {
    let ring = pools::outline(pool)
        .into_iter()
        .map(|[x, y]| Position::xy(x, y))
        .collect();
    let mut attributes = Attributes::new();
    for (name, value) in [
        ("nameStatus", json!("label")),
        ("cause", json!(pool.cause.id())),
        ("length", json!(pool.length)),
        ("breadth", json!(pool.breadth)),
        ("depth", json!(pool.depth)),
        ("river", json!(feature.id)),
    ] {
        attributes.insert(name.into(), value);
    }
    let mut record = map_records::generated(
        state,
        Record {
            key: &format!(
                "pool:{}:{:.0}:{:.0}",
                feature.id, pool.centre[0], pool.centre[1]
            ),
            name: "Pool",
            kind: "pool",
            layer: "lakes",
            geometry: Geometry::Polygon {
                coordinates: vec![ring],
            },
            attributes,
        },
    )?;
    record.relations.push(crate::features::Relation {
        target_id: feature.id.clone(),
        kind: "on".into(),
    });
    Ok(record)
}
/// Every pool on the map's drawn channels, anchored at the triangle beneath it.
fn found<S: MapState>(state: &S) -> io::Result<Vec<Place>> {
    let field = state.field()?;
    let [ox, oy] = field.mesh.origin();
    let mut places = Vec::new();
    let channels = state.features().values(FeatureSelection {
        area_id: Some(state.area_id()),
        layer_id: Some("rivers"),
        kind: None,
    })?;
    for feature in channels {
        let feature = feature?;
        for (piece, pool) in on_channel(&feature) {
            let [x, y] = pool.centre;
            let Some(anchor) = field.mesh.cell_at(x - ox, y - oy) else {
                continue;
            };
            let mut place = Place::at(Kind::Pool, anchor, vec![anchor]);
            place.id = place_id(&feature, piece, &pool);
            place.feature = Some(record(state, &feature, &pool)?);
            places.push(place);
        }
    }
    Ok(places)
}
fn number(place: &Place, name: &str) -> f64 {
    place
        .feature
        .as_ref()
        .and_then(|f| f.attributes.get(name))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0)
}
fn cause(place: &Place) -> Option<&str> {
    place.feature.as_ref()?.attributes.get("cause")?.as_str()
}
fn account<S: 'static>() -> Slot<OnPlace<S, String>> {
    Slot::Value(Rc::new(|_, place: &Place| {
        let why = match cause(place) {
            Some(c) if c == Cause::Confluence.id() => "Scoured deep where two streams meet.",
            Some(c) if c == Cause::Bend.id() => "Scoured deep on the outside of a tight bend.",
            _ => "Deep, slow water where the stream's fall slackens.",
        };
        Ok(format!(
            "{why} About {} deep.",
            true_sizes::length_text(number(place, "depth"))
        ))
    }))
}
fn roles<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Roles<S> {
    Roles {
        true_size: Slot::Value(TrueSize {
            statement: "A pool is two to three channel widths long and one and a half wide.".into(),
            size: Rc::new(|_, place| {
                Ok(Size {
                    height: None,
                    width: Some(number(place, "breadth")),
                    length: Some(number(place, "length")),
                })
            }),
            represents: Rc::new(|_, _| Ok(1)),
        }),
        variety: Slot::NotApplicable("Its cause is recorded with it; pools have no varieties."),
        appearance: Slot::Unwritten,
        account: account(),
        fields: Fields {
            statement: Must::Value("A pool is read from the channel; it changes no field.".into()),
            terrain: Slot::NotApplicable("The channel's bed already holds it."),
            water: Slot::NotApplicable("The stream's discharge passes through it unchanged."),
            climate: Slot::NotApplicable("Too small to change the air."),
            cover: Slot::NotApplicable("It lies within the channel."),
            magic: Slot::NotApplicable("No magic acts through a pool."),
        },
        movement: Movement {
            on_foot: None,
            statement: Must::Value(
                "Deep water no one wades; crossings avoid it by the stream's own depth.".into(),
            ),
            roads: Slot::NotApplicable("Crossings read the channel's depth, not the pool."),
            boats: Slot::NotApplicable("Too small for boats."),
            drainage: Slot::NotApplicable("The stream drains through it."),
            magic: Slot::NotApplicable("No carrier moves through a pool."),
            links: Slot::NotApplicable("A pool joins no two places."),
            crosses: Slot::NotApplicable("The stream itself is the barrier."),
        },
        others: Others {
            statement: Must::Value(
                "A pool lies on its stream and keeps apart from other pools.".into(),
            ),
            needs: Slot::NotApplicable("Finding reads its own stream."),
            excludes: Slot::NotApplicable("Pool spacing is part of finding."),
            contains: Slot::NotApplicable("A pool holds no other place."),
            pairs_with: Slot::Unwritten,
        },
        people: People {
            statement: Must::Value(
                "Fish hold in pools and people draw water there, as along the rest of the stream."
                    .into(),
            ),
            offers: Slot::NotApplicable("The stream's own offer covers its pools."),
            threatens: Slot::NotApplicable("A pool endangers no one on the bank."),
        },
        time: ThroughTime {
            statement: Must::Value("A pool moves as its stream's bed and bends move.".into()),
            fate: Slot::NotApplicable("Pools are read again from each drawing of the stream."),
        },
        visibility: Visibility {
            statement: Must::Value("Every pool found is shown, beneath every named place.".into()),
            magnitude: Slot::NotApplicable("Every pool found is shown."),
            local_conditions: Slot::NotApplicable("Every pool found is shown."),
            isolation: Slot::NotApplicable("Pools are spaced by finding."),
            cultural: Slot::NotApplicable("Pools carry no attachment."),
            importance: Must::Value(Rc::new(|_, _| Ok(0.0))),
        },
        naming: Naming {
            statement: Must::Value("Pools are labelled, not named.".into()),
            named_by: Slot::NotApplicable("Labelled by kind."),
            takes_name_from: Slot::NotApplicable("Labelled by kind."),
            lends_name_to: Slot::NotApplicable("Labelled by kind."),
            term: Slot::Unwritten,
        },
    }
}
pub fn entry<S: CatalogueState<Schedule> + 'static, Schedule: 'static>() -> Entry<S, Schedule> {
    Entry {
        id: Kind::Pool,
        group: Group::Water,
        name: "Pool".into(),
        recognition: Recognition {
            distinct: Must::Value("Deep water in a drawn channel: slack, confluence or bend scour.".into()),
            is_a: Must::Value(Rc::new(|_, _| Ok(false))),
            landform: Slot::NotApplicable("A pool lies in its channel, not on a landform."),
        },
        existence: Existence {
            origins: Slot::NotApplicable("The channel's own shape places every pool."),
            statement: Must::Value("Found on each channel drawn at its real width.".into()),
            way: Must::Value(ExistenceWay::Emerges),
            requires: Slot::NotApplicable("Finding reads the channel itself."),
            suitability: Slot::NotApplicable("The channel decides."),
            places: Must::Value(Rc::new(|state: &S| found(state))),
        },
        publication: Publication { delivery: Delivery::Landforms,
            statement: Must::Value("Publish each pool's outline in the water layer once the ground's channels are drawn.".into()),
            moment: Must::Value(Moment::Ground),
            record: Must::Value(Rc::new(|_: &S, place: &Place| Ok(place.feature.clone()))),
        },
        across_maps: AcrossMaps {
            statement: Must::Value("Pools are read from each real-scale map's own channels.".into()),
            stands_on: Slot::NotApplicable("A pool is part of its drawn channel."),
            carry: Slot::NotApplicable("Pools exist only at real scale and are not carried."),
            realize: Slot::NotApplicable("Not carried."),
            counterpart: Slot::NotApplicable("Not carried."),
            unrealized: Slot::NotApplicable("Not carried."),
            settle: Slot::NotApplicable("Not carried."),
            schedule: Slot::NotApplicable("Not carried."),
        },
        event: None,
        roles: roles(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// A river drawn in two pieces, each a straight even run, and a tributary joining the first.
    fn two_pieces() -> Feature {
        let piece = |y: f64| -> Vec<Position> {
            (0..=200)
                .map(|i| Position::xy(f64::from(i) * 2.0, y))
                .collect()
        };
        let n = 2 * 201;
        let beds: Vec<f64> = (0..n).map(|i| 100.0 - 0.02 * f64::from(i % 201)).collect();
        let mut attributes = Attributes::new();
        attributes.insert("bedElevations".into(), json!(beds));
        attributes.insert("widths".into(), json!(vec![4.0; n as usize]));
        attributes.insert("depths".into(), json!(vec![0.5; n as usize]));
        attributes.insert("junctions".into(), json!([[200.0, 1.0]]));
        Feature {
            map_only: None,
            place_id: None,
            footprint: None,
            id: atlas_map::Id::from_name("river"),
            name: "River".into(),
            kind: "river".into(),
            layer_id: "rivers".into(),
            area_id: atlas_map::Id::from_name("map"),
            geometry: Geometry::MultiLineString {
                coordinates: vec![piece(0.0), piece(300.0)],
            },
            detail: Default::default(),
            attributes,
            relations: Vec::new(),
            state: crate::features::State::Generated,
            protected: false,
            actor: "test".into(),
            generation_id: None,
            causes: Vec::new(),
            generation_domain: None,
        }
    }
    #[test]
    fn a_junction_makes_a_pool_only_on_the_piece_it_joins_and_ids_are_unique() {
        let feature = two_pieces();
        let found = on_channel(&feature);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, 0);
        assert_eq!(found[0].1.cause, Cause::Confluence);
        let (a, b) = (found[0].1.clone(), found[0].1.clone());
        assert_ne!(place_id(&feature, 0, &a), place_id(&feature, 1, &b));
    }
}
