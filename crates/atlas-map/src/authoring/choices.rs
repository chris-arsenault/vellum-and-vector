//! What a creator may choose on a real-scale map, published with the map so tools offer and
//! the edit commands accept the same choices: the hex ground and cover classes, and the
//! layers a first drawing opens (ADR 0016).
use crate::{Category, MapLayer};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One class a hex may take, with the colour or tint it shows in the fill view.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HexClass {
    pub id: String,
    pub label: String,
    pub color: Option<String>,
}
/// A real-scale map's authoring choices.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthoringChoices {
    /// Ground classes: the map's published surface legend, and the exposed rock outcrops
    /// leave. A hex's ground is one of these.
    pub ground_classes: Vec<HexClass>,
    /// Cover classes for play: how much the ground hides and slows whoever is in a hex.
    pub cover_classes: Vec<HexClass>,
    /// Layers not on the map yet that drawing into opens, such as the cave walls of a ground
    /// map without caves; the edit that draws first creates the layer and its located space.
    pub latent_layers: Vec<MapLayer>,
}
/// The colour exposed rock shows in the fill view.
const EXPOSED_ROCK_COLOUR: &str = "#8d877c";
/// Cover classes, from none to a hex nothing passes through, each a darker tint over the
/// hex's ground.
const COVER: [(&str, &str, &str); 4] = [
    ("open", "Open", "#00000000"),
    ("light", "Light cover", "#2f4a2a55"),
    ("heavy", "Heavy cover", "#1f331b99"),
    ("blocking", "Blocking", "#111111cc"),
];
pub fn cover_classes() -> Vec<HexClass> {
    COVER
        .iter()
        .map(|(id, label, color)| HexClass {
            id: (*id).into(),
            label: (*label).into(),
            color: Some((*color).into()),
        })
        .collect()
}
/// Ground classes from the classes of the map's published surface, and exposed rock.
pub fn ground_classes(surface: &[Category]) -> Vec<HexClass> {
    let mut classes: Vec<HexClass> = surface
        .iter()
        .map(|class| HexClass {
            id: class.label.clone(),
            label: class.label.clone(),
            color: class.color.clone(),
        })
        .collect();
    if !classes
        .iter()
        .any(|class| class.id == crate::hexes::EXPOSED_ROCK)
    {
        classes.push(HexClass {
            id: crate::hexes::EXPOSED_ROCK.into(),
            label: crate::hexes::EXPOSED_ROCK.into(),
            color: Some(EXPOSED_ROCK_COLOUR.into()),
        });
    }
    classes
}
