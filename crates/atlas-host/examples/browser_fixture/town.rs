//! A supplied real-scale village under the island, laid out as the settlement step publishes
//! one: named streets with widths and classes, houses on addressed plots numbered odd on the
//! left and even on the right from the street's first point, and one empty plot where an inn
//! can go (ADR 0016). No generation process runs.
use atlas_generation::features::FeatureWorkspace;
use atlas_host::generation_document::Document;
use atlas_map::{regions::rectangle, Bounds, MapRef};
use serde_json::{json, Value};
use std::io;

pub const VILLAGE: &str = "6d2c1e7a-3b84-4f5e-9a61-0c2b7e4d5f88";
const FRAME: Bounds = Bounds(5.0, 15.0, 95.0, 82.5);
const SETTLEMENT: &str = "Elder Cross";

/// Turns a copy of the island's document into its real-scale village.
pub fn child(document: &mut Document, parent: &MapRef) -> io::Result<()> {
    let root = document.scope.located.area_id.clone();
    let mut area = document.world["areas"][&root].clone();
    let footprint = json!(rectangle(FRAME));
    area["id"] = VILLAGE.into();
    area["name"] = "Supplied village".into();
    area["parentId"] = root.clone().into();
    area["profile"] = "local".into();
    area["footprint"] = footprint.clone();
    area["traits"] = json!([]);
    area["layers"] = json!({});
    area["frame"]["origin"]["x"] = json!((FRAME.0 + FRAME.2) / 2.0);
    area["frame"]["origin"]["y"] = json!((FRAME.1 + FRAME.3) / 2.0);
    area["map"] = json!({"sourceAreaId":root,"sourceRevision":1,"sourceMap":parent,
        "refinementLevel":0,"extent":footprint,
        "realScale":{"kind":"ground","hexSize":"3m","hexesAcross":30,"trianglesPerEdge":2}});
    document.world["areas"][VILLAGE] = area;
    document.scope.located.area_id = VILLAGE.into();
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
    json!({"id":id,"placeId":id,"areaId":VILLAGE,"layerId":layer,"kind":kind,"name":name,
        "attributes":attributes,"relations":[],"detail":{},"state":"generated","protected":false,
        "actor":"generator","generationId":"supplied","causes":[],"geometry":geometry})
}
fn street(id: &str, name: &str, class: &str, points: Value, width: f64) -> Value {
    let count = points.as_array().map_or(0, Vec::len);
    record(
        id,
        "roads",
        "street",
        name,
        json!({"type":"LineString","coordinates":points}),
        json!({"widths":vec![width; count],"roadClass":class,"settlement":SETTLEMENT,"developedBy":"regional"}),
    )
}
fn address(number: u32) -> Value {
    json!({"address":format!("{number} High Street"),"addressNumber":number,"street":"High Street",
        "streetId":"village-high-street","settlement":SETTLEMENT,"developedBy":"regional"})
}
/// A house on a 12 m plot of High Street, north (left) or south (right) of the street.
fn house(id: &str, x: f64, north: bool, number: u32, keeper: &str) -> [Value; 2] {
    let ([plot_s, plot_n], [house_s, house_n]) = if north {
        ([48.5, 68.5], [50.5, 57.5])
    } else {
        ([21.5, 41.5], [32.5, 39.5])
    };
    let mut yard = address(number);
    yard["nameStatus"] = "label".into();
    let yard = record(
        &format!("{id}-yard"),
        "plots",
        "yard",
        &format!("{number} High Street"),
        json!(rectangle(Bounds(x - 6.0, plot_s, x + 6.0, plot_n))),
        yard,
    );
    let mut attributes = address(number);
    for (key, value) in [
        ("use", json!("house")),
        ("occupants", json!(5)),
        ("storeys", json!(1)),
        ("household", json!(keeper)),
        ("rotation", json!(0)),
    ] {
        attributes[key] = value;
    }
    let mut building = record(
        id,
        "structures",
        "building",
        keeper,
        json!(rectangle(Bounds(x - 4.2, house_s, x + 4.2, house_n))),
        attributes,
    );
    building["relations"] = json!([{"targetId":"village-high-street","kind":"fronts"}]);
    [yard, building]
}
pub fn install(records: &mut impl FeatureWorkspace) -> io::Result<()> {
    let place = record(
        "village-elder-cross",
        "settlements",
        "settlement",
        SETTLEMENT,
        json!({"type":"Point","coordinates":[20,45]}),
        json!({"settlementPopulation":300,"namingCulture":"marches"}),
    );
    let mut all = vec![
        place,
        street(
            "village-high-street",
            "High Street",
            "mainStreet",
            json!([[20, 45], [50, 45], [90, 45]]),
            6.0,
        ),
        street(
            "village-mill-lane",
            "Mill Lane",
            "lane",
            json!([[20, 45], [20, 78]]),
            3.5,
        ),
        record(
            "village-inn-site",
            "plots",
            "yard",
            "Inn site",
            json!(rectangle(Bounds(39.0, 21.5, 51.0, 41.5))),
            json!({"settlement":SETTLEMENT}),
        ),
    ];
    for (id, x, north, number, keeper) in [
        ("village-house-1", 30.0, true, 1, "Brook Household"),
        ("village-house-3", 45.0, true, 3, "Ashby Household"),
        ("village-house-2", 30.0, false, 2, "Wren Household"),
        ("village-house-4", 60.0, false, 4, "Hale Household"),
    ] {
        all.extend(house(id, x, north, number, keeper));
    }
    for value in all {
        records.put(serde_json::from_value(value)?)?;
    }
    Ok(())
}
