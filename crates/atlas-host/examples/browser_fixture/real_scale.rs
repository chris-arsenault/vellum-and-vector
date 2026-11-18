//! A supplied real-scale ground map under the island, holding one shape of every layer kind:
//! a stream that widens into a pool, a trail pinched at a gate, a bridge where they cross, a
//! turned house, a field, a tree and scattered logs (ADR 0016). No generation process runs.
use atlas_generation::features::FeatureWorkspace;
use atlas_host::generation_document::Document;
use atlas_map::{regions::rectangle, Bounds, MapRef};
use serde_json::{json, Value};
use std::io;

pub const CHILD: &str = "4b0f6b52-6c1e-4f0b-9d5e-1f7f2f9b3a10";
pub const FRAME: Bounds = Bounds(40.0, 40.0, 70.0, 62.5);

/// Turns a copy of the island's document into its real-scale child.
pub fn child(document: &mut Document, parent: &MapRef) -> io::Result<()> {
    let root = document.scope.located.area_id.clone();
    let mut area = document.world["areas"][&root].clone();
    let footprint = json!(rectangle(FRAME));
    area["id"] = CHILD.into();
    area["name"] = "Supplied glen".into();
    area["parentId"] = root.clone().into();
    area["profile"] = "local".into();
    area["footprint"] = footprint.clone();
    area["traits"] = json!([]);
    area["layers"] = json!({});
    area["frame"]["origin"]["x"] = json!((FRAME.0 + FRAME.2) / 2.0);
    area["frame"]["origin"]["y"] = json!((FRAME.1 + FRAME.3) / 2.0);
    area["map"] = json!({"sourceAreaId":root,"sourceRevision":1,"sourceMap":parent,
        "refinementLevel":0,"extent":footprint,
        "realScale":{"kind":"ground","hexSize":"1.5m","hexesAcross":20,"trianglesPerEdge":2}});
    document.world["areas"][CHILD] = area;
    document.scope.located.area_id = CHILD.into();
    document.scope.footprint = rectangle(FRAME);
    document.coverage.clear();
    Ok(())
}
fn record(
    id: &str,
    layer: &str,
    kind: &str,
    name: &str,
    geometry: Value,
    attributes: Value,
) -> Value {
    json!({"id":id,"placeId":id,"areaId":CHILD,"layerId":layer,"kind":kind,"name":name,
        "attributes":attributes,"relations":[],"detail":{},"state":"generated","protected":false,
        "actor":"generator","generationId":"supplied","causes":[],"geometry":geometry})
}
fn turned(cx: f64, cy: f64, w: f64, h: f64, degrees: f64) -> Value {
    let (s, c) = degrees.to_radians().sin_cos();
    let corners = [(-w, -h), (w, -h), (w, h), (-w, h), (-w, -h)]
        .map(|(x, y)| [cx + (x * c - y * s) / 2.0, cy + (x * s + y * c) / 2.0]);
    json!({"type":"Polygon","coordinates":[corners]})
}
pub fn install(records: &mut impl FeatureWorkspace) -> io::Result<()> {
    let stream = record(
        "glen-stream",
        "rivers",
        "stream",
        "Glen burn",
        json!({"type":"LineString","coordinates":[[40,50],[50,51],[58,50],[70,49]]}),
        json!({"widths":[0.8,1.2,4.0,1.0]}),
    );
    let trail = record(
        "glen-trail",
        "roads",
        "trail",
        "Drovers' trail",
        json!({"type":"LineString","coordinates":[[55,40],[55.5,47],[56,56],[57,62.5]]}),
        json!({"widths":[1.6,1.6,0.6,1.6],"roadClass":"trail"}),
    );
    let house = record(
        "glen-house",
        "structures",
        "building",
        "Shepherd's cottage",
        turned(63.0, 56.0, 6.0, 4.0, 30.0),
        json!({"rotation":30,"use":"house","buildingFunction":"residential"}),
    );
    let field = record(
        "glen-field",
        "plots",
        "field",
        "Barley strip",
        json!(rectangle(Bounds(42.0, 53.0, 50.0, 60.0))),
        json!({}),
    );
    let tree = record(
        "glen-tree",
        "objects",
        "tree",
        "Old rowan",
        turned(47.0, 44.0, 2.0, 2.0, 0.0),
        json!({"rotation":0}),
    );
    // A plank bridge where the trail crosses the burn, attached to both by its junctions.
    let mut bridge = record(
        "glen-bridge",
        "structures",
        "bridge",
        "Plank bridge",
        turned(55.68, 50.29, 1.8, 3.0, -3.2),
        json!({"rotation":-3.2}),
    );
    bridge["relations"] = json!([{"targetId":"glen-stream","kind":"spans"},
        {"targetId":"glen-trail","kind":"carries"}]);
    let mut all = vec![stream, trail, house, field, tree, bridge];
    for (i, (x, y, angle)) in [(60.0, 45.0, 20.0), (61.5, 46.2, 75.0), (62.4, 44.6, 140.0)]
        .into_iter()
        .enumerate()
    {
        all.push(record(
            &format!("glen-log-{i}"),
            "objects",
            "log",
            "Fallen log",
            turned(x, y, 2.4, 0.5, angle),
            json!({"rotation":angle}),
        ));
    }
    for value in all {
        records.put(serde_json::from_value(value)?)?;
    }
    Ok(())
}
