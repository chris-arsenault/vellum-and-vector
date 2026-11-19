//! An inn on the supplied glen with a cave passage in the glen's underground under it, so
//! UI tests can open the inn's floors, draw its cellar and connect a trapdoor to the cave
//! (ADR 0016). No generation process runs.
use super::real_scale::CHILD;
use atlas_generation::features::FeatureWorkspace;
use atlas_map::Id;
use serde_json::{json, Value};
use std::io;

pub const INN: &str = "glen-inn";
pub const PASSAGE: &str = "glen-passage";

fn record(
    id: &str,
    layer: &str,
    kind: &str,
    name: &str,
    geometry: Value,
    attributes: Value,
) -> Value {
    json!({"id":Id::from_name(id),"placeId":Id::from_name(id),"areaId":CHILD,"layerId":layer,"kind":kind,
        "name":name,"attributes":attributes,"relations":[],"detail":{},"state":"generated","protected":false,
        "actor":"generator","generationId":Id::from_name("supplied"),"causes":[],"geometry":geometry})
}
pub fn install(records: &mut impl FeatureWorkspace) -> io::Result<()> {
    // Two storeys facing the drovers' trail to the west, under Aurora's coverage.
    let mut inn = record(
        INN,
        "structures",
        "building",
        "The Rowan Inn",
        json!({"type":"Polygon","coordinates":[[[64,42],[69,42],[69,47],[64,47],[64,42]]]}),
        json!({"use":"inn","buildingFunction":"economic","storeys":2,"occupants":6,"business":"Ailsa Rowan",
            "address":"1 Drovers' Trail","addressNumber":1,"street":"Drovers' trail",
            "ward":"Glenfoot","settlement":"Glenhead","rotation":0}),
    );
    inn["relations"] = json!([{"targetId":Id::from_name("glen-trail"),"kind":"fronts"}]);
    let passage = record(
        PASSAGE,
        "caves",
        "dissolvedPassage",
        "Rowan passage",
        json!({"type":"LineString","coordinates":[[58,45],[66,44.5],[69.5,43]]}),
        json!({"widths":[1.2,1.8,1.2]}),
    );
    for value in [inn, passage] {
        records.put(serde_json::from_value(value)?)?;
    }
    Ok(())
}
