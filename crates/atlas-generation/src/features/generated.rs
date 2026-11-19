use super::{
    chart::Chart,
    network::{NetworkWorkspace, Node, Position, Reach},
    network_parts, Feature, FeatureWorkspace, State,
};
use atlas_map::{Geometry, Id};
use std::io;

pub fn put(
    workspace: &mut dyn FeatureWorkspace,
    feature: Feature,
    contracted: bool,
) -> io::Result<bool> {
    let previous = workspace.get(feature.id)?;
    if contracted
        || previous
            .is_some_and(|p| p.protected || p.state == State::Authored || !p.detail.is_empty())
    {
        return Ok(false);
    }
    workspace.put(feature)?;
    Ok(true)
}
pub struct Publisher<'a> {
    pub world: Id,
    pub area: Id,
    pub space: Option<Id>,
    pub owns_map_geography: bool,
    pub chart: Chart<'a>,
    pub precision: f64,
}
fn number(value: Option<&serde_json::Value>, otherwise: f64) -> io::Result<f64> {
    match value {
        None => Ok(otherwise),
        Some(serde_json::Value::Null) => Ok(0.0),
        Some(serde_json::Value::Bool(v)) => Ok(f64::from(*v)),
        Some(serde_json::Value::String(v)) if v.trim().is_empty() => Ok(0.0),
        Some(serde_json::Value::String(v)) => v.trim().parse().map_err(io::Error::other),
        Some(v) => v
            .as_f64()
            .ok_or_else(|| io::Error::other("A network profile must be numeric")),
    }
}
impl Publisher<'_> {
    /// The junction at a point of a space: lines that meet there share it. A map that owns
    /// its geography keeps its own junctions.
    fn junction(&self, x: f64, y: f64) -> Id {
        let owner = if self.owns_map_geography {
            self.area
        } else {
            self.world
        };
        let mut name = self.space.unwrap_or(Id::NIL).to_bytes().to_vec();
        name.extend_from_slice(&x.to_bits().to_be_bytes());
        name.extend_from_slice(&y.to_bits().to_be_bytes());
        Id::v5(Id::v5(owner, b"generated junction"), &name)
    }
    pub fn network(
        &self,
        features: &mut dyn FeatureWorkspace,
        networks: &mut dyn NetworkWorkspace,
        feature: Feature,
        contracted: bool,
    ) -> io::Result<()> {
        if !put(features, feature.clone(), contracted)? {
            return Ok(());
        }
        let parts = network_parts::parts(&feature, &self.chart, self.precision)?;
        for (at, part) in parts.into_iter().enumerate() {
            // One reach per part of the feature's line.
            let reach = Id::v5(feature.id, &(at as u32).to_be_bytes());
            self.part(networks, &feature, part, reach)?;
        }
        Ok(())
    }
    fn part(
        &self,
        networks: &mut dyn NetworkWorkspace,
        feature: &Feature,
        part: network_parts::Part,
        reach_id: Id,
    ) -> io::Result<()> {
        let (Some(first), Some(last)) = (part.coordinates.first(), part.coordinates.last()) else {
            return Err(io::Error::other("A network part has no endpoints"));
        };
        let mut nodes = Vec::new();
        for (at, coordinate) in [first, last].into_iter().enumerate() {
            let [x, y, z] = self.chart.position(*coordinate).coordinates();
            let elevations = part.attributes.get("elevations").and_then(|v| v.as_array());
            let height = match elevations {
                Some(values) => number(
                    if at == 0 {
                        values.first()
                    } else {
                        values.last()
                    },
                    z,
                )?,
                None => z,
            };
            nodes.push(Node {
                id: self.junction(x, y),
                kind: feature.kind.clone(),
                position: Position { x, y, z: height },
                space_id: self.space,
                water_level: None,
            });
        }
        let reach = Reach {
            id: reach_id,
            feature_id: feature.id,
            start: nodes[0].id,
            end: nodes[1].id,
            geometry: Geometry::LineString {
                coordinates: part.coordinates,
            },
            flow: number(
                part.attributes.get("discharge").filter(|v| !v.is_null()),
                0.0,
            )?,
            end_flow: part
                .attributes
                .get("discharges")
                .and_then(|v| v.as_array())
                .map(|values| number(values.last(), 0.0))
                .transpose()?,
        };
        for node in nodes {
            networks.put_node(node)?;
        }
        networks.put_reach(reach)
    }
}
