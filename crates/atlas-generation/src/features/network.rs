use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub kind: String,
    pub position: Position,
    pub space_id: Option<String>,
    pub water_level: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reach {
    pub id: String,
    pub feature_id: String,
    pub start: String,
    pub end: String,
    pub geometry: Geometry,
    pub flow: f64,
    pub end_flow: Option<f64>,
}
#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<&'a str>,
}
impl Selection<'_> {
    pub fn matches(&self, reach: &Reach) -> bool {
        self.feature_id.is_none_or(|id| reach.feature_id == id)
            && self
                .node_id
                .is_none_or(|id| reach.start == id || reach.end == id)
    }
}
pub trait NetworkReader {
    fn node(&self, id: &str) -> io::Result<Option<Node>>;
    fn reach(&self, id: &str) -> io::Result<Option<Reach>>;
    fn nodes(&self) -> io::Result<Box<dyn Iterator<Item = io::Result<Node>> + '_>>;
    fn reaches<'a>(
        &'a self,
        selection: Selection<'a>,
    ) -> io::Result<Box<dyn Iterator<Item = io::Result<Reach>> + 'a>>;
}
pub trait NetworkWorkspace: NetworkReader {
    fn put_node(&mut self, node: Node) -> io::Result<()>;
    fn put_reach(&mut self, reach: Reach) -> io::Result<()>;
    fn remove_reach(&mut self, id: &str) -> io::Result<()>;
}
