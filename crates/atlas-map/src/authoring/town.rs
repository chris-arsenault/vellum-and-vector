//! Town tools (ADR 0016). A street is drawn by class: its width comes from the class at the
//! settlement's size, each end that meets a way joins it at a vertex of that way, and a bridge
//! carries it over water narrow enough for the place to bridge. Buildings are placed in
//! `buildings.rs`. An unnamed street or building is named from the settlement's naming culture
//! when the store completes the change, and the store renumbers every street the change touches
//! and refuses streets and buildings standing where they cannot (`clearance.rs`).
use super::{
    clearance::water_crossings,
    family,
    frontage::{insert_junction, is_way},
    in_locked_layer,
    plan::{title, Planner},
    shapes::vertices,
    Draft,
};
use crate::{
    regions::point,
    town::{bridge_span, Size, StreetClass, BRIDGE_LANDING, BRIDGE_MARGIN},
    Bounds, Geometry, LayerSource, MapFeature, Position,
};
use serde_json::Value;
use std::collections::BTreeMap;

/// The naming work term an unnamed street or building is named with; the store removes it
/// once the name is given.
pub const NAMING_WORK: &str = "namingWork";
/// How far around a placed building the store reads streets, plots and buildings.
pub const PLACING_REACH: f64 = 80.0;

/// The settlement a street or building belongs to: its name, naming culture and size.
#[derive(Clone, Debug, PartialEq)]
pub struct Settlement {
    pub name: Option<String>,
    pub culture: Option<String>,
    pub size: Size,
    pub centre: Option<Position>,
}
/// Where the store reads around a town command: the drawn line or placed point, widened.
pub fn town_bounds(points: &[[f64; 2]], by: f64) -> Bounds {
    let fold = |pick: fn(f64, f64) -> f64, axis: usize, start: f64| {
        points.iter().map(|p| p[axis]).fold(start, pick)
    };
    Bounds(
        fold(f64::min, 0, f64::INFINITY) - by,
        fold(f64::min, 1, f64::INFINITY) - by,
        fold(f64::max, 0, f64::NEG_INFINITY) + by,
        fold(f64::max, 1, f64::NEG_INFINITY) + by,
    )
}
/// The ways a drawn street's ends joined, as changed; which ends joined; and the settlement
/// the first joined way belongs to.
struct Joined {
    hosts: Vec<MapFeature>,
    ends: [bool; 2],
    settlement: Option<String>,
}
pub(super) fn xy(position: Position) -> [f64; 2] {
    let [x, y, _] = position.coordinates();
    [x, y]
}
fn gap(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
/// A rectangle whose front edge is centred on `front`, `width` along `direction` and `depth`
/// back along `inward`.
pub(super) fn rectangle(
    front: [f64; 2],
    direction: [f64; 2],
    inward: [f64; 2],
    width: f64,
    depth: f64,
) -> Geometry {
    let at = |along: f64, back: f64| {
        Position::xy(
            front[0] + direction[0] * along + inward[0] * back,
            front[1] + direction[1] * along + inward[1] * back,
        )
    };
    let half = width / 2.0;
    let ring = vec![
        at(-half, 0.0),
        at(half, 0.0),
        at(half, depth),
        at(-half, depth),
        at(-half, 0.0),
    ];
    Geometry::Polygon {
        coordinates: vec![ring],
    }
}
pub(super) fn text<'a>(feature: &'a MapFeature, key: &str) -> Option<&'a str> {
    feature.attributes.get(key).and_then(Value::as_str)
}

impl Planner<'_> {
    /// The settlement named, else the nearest one; a map with none counts as a village.
    pub(super) fn settlement(
        &self,
        named: Option<&str>,
        near: Position,
    ) -> Result<Settlement, String> {
        let places: Vec<&MapFeature> = self
            .targets
            .iter()
            .filter(|f| family(&f.layer_id) == "settlements")
            .filter(|f| matches!(f.geometry, Geometry::Point { .. }))
            .collect();
        let found = match places
            .iter()
            .find(|f| named.is_some() && f.name.as_deref() == named)
        {
            Some(place) => Some(*place),
            None => self.nearest(&places, near)?.map(|(place, _)| place),
        };
        let people = found.and_then(|place| {
            ["settlementPopulation", "population"]
                .iter()
                .find_map(|key| place.attributes.get(*key).and_then(Value::as_f64))
        });
        Ok(Settlement {
            name: named
                .map(str::to_owned)
                .or_else(|| found.and_then(|f| f.name.clone())),
            culture: found
                .and_then(|f| text(f, "namingCulture"))
                .map(str::to_owned),
            size: people.map_or(Size::Village, Size::of),
            centre: found.and_then(|f| match f.geometry {
                Geometry::Point { coordinates } => Some(coordinates),
                _ => None,
            }),
        })
    }
    pub(super) fn nearest<'f>(
        &self,
        features: &[&'f MapFeature],
        at: Position,
    ) -> Result<Option<(&'f MapFeature, f64)>, String> {
        let mut best: Option<(&MapFeature, f64)> = None;
        for feature in features {
            let distance = self.spatial.distance(&point(at), &feature.geometry)?;
            if best.is_none_or(|(_, d)| distance < d) {
                best = Some((feature, distance));
            }
        }
        Ok(best)
    }
    pub(super) fn layer_of(&self, wanted: &str) -> Result<String, String> {
        self.map
            .layers
            .iter()
            .find(|layer| {
                family(&layer.id) == wanted && matches!(layer.source, LayerSource::Vector(_))
            })
            .map(|layer| layer.id.clone())
            .ok_or_else(|| format!("This map has no {wanted} layer"))
    }

    pub(super) fn draw_street(
        &self,
        new_id: &mut dyn FnMut() -> crate::Id,
        class: &str,
        drawn: &Geometry,
        name: Option<&str>,
        creator: Option<crate::Id>,
    ) -> Result<Draft, String> {
        let class = StreetClass::parse(class)
            .filter(|class| *class != StreetClass::Road)
            .ok_or("Choose a main street, street, lane or alley")?;
        let mut line = vertices(drawn)
            .filter(|points| points.len() >= 2)
            .ok_or("Draw a street of two or more points")?
            .to_vec();
        let Joined {
            hosts,
            ends,
            settlement,
        } = self.join_ends(&mut line)?;
        let settlement = self.settlement(settlement.as_deref(), line[0])?;
        if orient_backwards(&line, ends, settlement.centre) {
            line.reverse();
        }
        let width = class.width(settlement.size);
        let mut attributes = BTreeMap::from([
            ("widths".to_string(), Value::from(vec![width; line.len()])),
            ("roadClass".into(), class.as_str().into()),
        ]);
        town_attributes(
            &mut attributes,
            &settlement,
            name.is_none().then_some(class.work()),
        );
        let roads = self.layer_of("roads")?;
        let geometry = Geometry::LineString { coordinates: line };
        let mut draft = self.create(
            new_id(),
            &roads,
            "street",
            name.map(str::to_owned),
            &geometry,
            &attributes,
            creator,
        )?;
        let street = draft.after[0].geometry.clone();
        let span = bridge_span(settlement.size);
        draft
            .after
            .extend(self.bridges(&street, width, span, new_id, creator)?);
        for host in hosts {
            draft.before.push(self.find(host.id)?.clone());
            draft.after.push(host);
        }
        draft.label = labelled(&format!("Draw {}", class.label()), name);
        Ok(draft)
    }
    /// A bridge wherever the street crosses water the place can span, reaching onto each
    /// bank; wider water is refused when the store checks the street.
    fn bridges(
        &self,
        street: &Geometry,
        width: f64,
        span: f64,
        new_id: &mut dyn FnMut() -> crate::Id,
        creator: Option<crate::Id>,
    ) -> Result<Vec<MapFeature>, String> {
        let structures = self.layer_of("structures")?;
        let mut bridges = Vec::new();
        for (_, crossing) in water_crossings(street, self.targets, self.spatial)? {
            let (Some(points), length) = (vertices(&crossing), self.spatial.length(&crossing)?)
            else {
                continue;
            };
            if length > span || points.len() < 2 {
                continue;
            }
            let (a, b) = (xy(points[0]), xy(points[points.len() - 1]));
            let d = [
                (b[0] - a[0]) / length.max(1e-9),
                (b[1] - a[1]) / length.max(1e-9),
            ];
            let start = [a[0] - d[0] * BRIDGE_LANDING, a[1] - d[1] * BRIDGE_LANDING];
            let deck = rectangle(
                start,
                [-d[1], d[0]],
                d,
                width + BRIDGE_MARGIN,
                length + 2.0 * BRIDGE_LANDING,
            );
            let turn = (d[1].atan2(d[0]).to_degrees() * 100.0).round() / 100.0;
            let attributes = BTreeMap::from([("rotation".to_string(), Value::from(turn))]);
            let made = self.create(
                new_id(),
                &structures,
                "bridge",
                None,
                &deck,
                &attributes,
                creator,
            )?;
            bridges.extend(made.after);
        }
        Ok(bridges)
    }
    /// Each end of a drawn street within a hex of a way moves onto it, and the way gains a
    /// vertex there. Returns the ways as changed, which ends joined, and the settlement the
    /// first joined way belongs to.
    fn join_ends(&self, line: &mut [Position]) -> Result<Joined, String> {
        let reach = self.real.across_flats.max(1.0);
        let mut hosts: Vec<MapFeature> = Vec::new();
        let mut joined = [false, false];
        let mut settlement = None;
        let last = line.len() - 1;
        for (end, index) in [(0, 0), (1, last)] {
            let current: Vec<MapFeature> = self
                .targets
                .iter()
                .filter(|f| is_way(f))
                .map(|f| hosts.iter().find(|h| h.id == f.id).unwrap_or(f).clone())
                .collect();
            let ways: Vec<&MapFeature> = current.iter().collect();
            let Some((way, distance)) = self.nearest(&ways, line[index])? else {
                continue;
            };
            if distance > reach {
                continue;
            }
            if in_locked_layer(way, self.real) {
                return Err(format!("{} is on a locked layer", title(way)));
            }
            let fraction = self.spatial.line_fraction(&way.geometry, line[index])?;
            let (next, at) = insert_junction(way, fraction, self.spatial)?;
            line[index] = at;
            joined[end] = true;
            settlement = settlement.or_else(|| text(way, "settlement").map(str::to_owned));
            hosts.retain(|h| h.id != next.id);
            hosts.push(next);
        }
        Ok(Joined {
            hosts,
            ends: joined,
            settlement,
        })
    }
}
/// A side street begins where it leaves the street it branches from; a street joined at
/// both ends or neither begins at the end nearer the settlement's centre.
fn orient_backwards(line: &[Position], joined: [bool; 2], centre: Option<Position>) -> bool {
    match (joined, centre) {
        ([false, true], _) => true,
        ([true, false], _) => false,
        (_, Some(centre)) => {
            let centre = xy(centre);
            gap(xy(line[line.len() - 1]), centre) < gap(xy(line[0]), centre)
        }
        _ => false,
    }
}
pub(super) fn town_attributes(
    attributes: &mut BTreeMap<String, Value>,
    settlement: &Settlement,
    work: Option<&str>,
) {
    if let Some(name) = &settlement.name {
        attributes.insert("settlement".into(), name.clone().into());
    }
    if let Some(culture) = &settlement.culture {
        attributes.insert("namingCulture".into(), culture.clone().into());
    }
    if let Some(work) = work {
        attributes.insert(NAMING_WORK.into(), work.into());
    }
}
pub(super) fn labelled(verb: &str, name: Option<&str>) -> String {
    match name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => format!("{verb} {name}"),
        None => verb.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_side_street_begins_where_it_leaves_its_street() {
        let line = [Position::xy(0.0, 0.0), Position::xy(10.0, 0.0)];
        assert!(orient_backwards(&line, [false, true], None));
        assert!(!orient_backwards(
            &line,
            [true, false],
            Some(Position::xy(20.0, 0.0))
        ));
        assert!(orient_backwards(
            &line,
            [false, false],
            Some(Position::xy(20.0, 0.0))
        ));
        assert!(!orient_backwards(&line, [true, true], None));
        assert_eq!(
            town_bounds(&[[0.0, 1.0], [4.0, -2.0]], 1.0),
            Bounds(-1.0, -3.0, 5.0, 2.0)
        );
    }
}
