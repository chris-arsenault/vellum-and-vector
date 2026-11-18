use super::{geometry::Point, network::Arm, story::Story};

/// A settlement as its record and the ways around it tell it.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Seat {
    pub key: String,
    pub name: String,
    pub centre: Point,
    pub story: Story,
    pub arms: Vec<Arm>,
    pub culture: Option<String>,
}
