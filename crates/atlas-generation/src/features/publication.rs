use super::{
    chart::Chart,
    network::{NetworkWorkspace, Node, Position, Reach},
    records::Attributes,
    Feature, State,
};
use crate::{identity::semantic_id, spatial::SpatialKernel};
use atlas_map::{Geometry, Id};
use std::io;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Named {
    pub name: String,
    pub metadata: Attributes,
}
pub struct RegionalRecord {
    pub key: String,
    pub kind: String,
    pub layer_id: String,
    pub generation_domain: Option<String>,
    pub geometry: Geometry,
    pub attributes: Attributes,
    pub label: String,
    pub named: Option<Named>,
}
pub struct RegionalPublisher<'a> {
    pub world: Id,
    pub area: Id,
    pub space: Option<Id>,
    pub chart: Chart<'a>,
    pub spatial: &'a dyn SpatialKernel,
}
impl RegionalPublisher<'_> {
    /// The independent naming provider supplies its name and metadata before publication.
    pub fn feature(&self, record: RegionalRecord) -> io::Result<Feature> {
        let mut attributes = Attributes::new();
        attributes.insert("nameStatus".into(), "proper".into());
        attributes.extend(record.attributes);
        let name = if let Some(named) = record.named {
            attributes.extend(named.metadata);
            named.name
        } else {
            record.label
        };
        attributes.insert("developedBy".into(), "regional".into());
        Ok(Feature {
            // Regional records are the area's own: its identity names them.
            id: semantic_id(self.area, "regional", &record.key),
            place_id: None,
            map_only: None,
            footprint: None,
            area_id: self.area,
            layer_id: record.layer_id,
            kind: record.kind,
            name,
            geometry: self
                .chart
                .geometry(&record.geometry, self.spatial)
                .map_err(io::Error::other)?,
            attributes,
            relations: Vec::new(),
            causes: vec!["Developed from captured present geography at regional scale.".into()],
            detail: Default::default(),
            state: State::Generated,
            protected: false,
            actor: "generator".into(),
            generation_id: None,
            generation_domain: record.generation_domain,
        })
    }
    pub fn network(
        &self,
        workspace: &mut dyn NetworkWorkspace,
        feature: &Feature,
        flow: f64,
        coordinates: Option<&[atlas_map::Position]>,
    ) -> io::Result<()> {
        let coordinates = coordinates.or(match &feature.geometry {
            Geometry::LineString { coordinates } => Some(coordinates.as_slice()),
            _ => None,
        });
        let Some(coordinates) = coordinates else {
            return Ok(());
        };
        let (Some(first), Some(last)) = (coordinates.first(), coordinates.last()) else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "A network line has no endpoints",
            ));
        };
        let mut nodes = Vec::with_capacity(2);
        for coordinate in [first, last] {
            let [x, y, _] = coordinate.coordinates();
            // Lines of one layer that end at the same point of the area share its node.
            let mut name = feature.layer_id.as_bytes().to_vec();
            name.push(0);
            name.extend_from_slice(&x.to_bits().to_be_bytes());
            name.extend_from_slice(&y.to_bits().to_be_bytes());
            let id = Id::v5(Id::v5(self.area, b"regional node"), &name);
            let [x, y, z] = self.chart.position(*coordinate).coordinates();
            nodes.push(Node {
                id,
                kind: format!("network:{}", feature.layer_id),
                position: Position { x, y, z },
                space_id: self.space.map(|space| space.to_string()),
                water_level: None,
            });
        }
        let reach = Reach {
            id: Id::v5(feature.id, b"regional reach"),
            feature_id: feature.id,
            start: nodes[0].id,
            end: nodes[1].id,
            geometry: Geometry::LineString {
                coordinates: coordinates.to_vec(),
            },
            flow,
            end_flow: None,
        };
        for node in nodes {
            workspace.put_node(node)?;
        }
        workspace.put_reach(reach)
    }
}
