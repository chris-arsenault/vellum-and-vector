use super::{
    chart::Chart,
    network::{NetworkWorkspace, Node, Position, Reach},
    network_parts, Feature, FeatureWorkspace, State,
};
use crate::identity::semantic_id;
use atlas_map::Geometry;
use std::io;

pub fn put(
    workspace: &mut dyn FeatureWorkspace,
    feature: Feature,
    contracted: bool,
) -> io::Result<bool> {
    let previous = workspace.get(&feature.id)?;
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
    pub world: &'a str,
    pub area: &'a str,
    pub space: Option<&'a str>,
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
        let count = parts.len();
        for (at, part) in parts.into_iter().enumerate() {
            let key = if count == 1 {
                feature.id.clone()
            } else {
                format!("{}:{at}", feature.id)
            };
            self.part(networks, &feature, part, &key)?;
        }
        Ok(())
    }
    fn part(
        &self,
        networks: &mut dyn NetworkWorkspace,
        feature: &Feature,
        part: network_parts::Part,
        key: &str,
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
            let scope = if self.owns_map_geography {
                format!("generated-junction:{}", self.area)
            } else {
                "generated-junction".into()
            };
            nodes.push(Node {
                id: semantic_id(
                    self.world,
                    &scope,
                    &serde_json::to_string(&(self.space, x, y))?,
                )?,
                kind: feature.kind.clone(),
                position: Position { x, y, z: height },
                space_id: self.space.map(str::to_owned),
                water_level: None,
            });
        }
        let reach = Reach {
            id: semantic_id(self.world, "generated-reach", key)?,
            feature_id: feature.id.clone(),
            start: nodes[0].id.clone(),
            end: nodes[1].id.clone(),
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
