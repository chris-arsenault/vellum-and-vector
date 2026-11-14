use atlas_generation::features::FeatureWorkspace;
use atlas_host::generation_document::Document;
use atlas_map::{regions::rectangle, Bounds};
use serde_json::{json, Value};
use std::io;

pub fn install(document: &mut Document, records: &mut impl FeatureWorkspace) -> io::Result<()> {
    let area = &document.scope.located.area_id;
    let island = json!({"id":"island","placeId":"island","areaId":area,"layerId":"geology",
        "kind":"island","name":"Basalt island","attributes":{},"relations":[],"detail":{},
        "state":"generated","protected":false,"actor":"generator","generationId":"supplied",
        "causes":["Lava built the island"],"geometry":rectangle(Bounds(25.0,25.0,75.0,75.0))});
    let mut town = island.clone();
    fields(
        &mut town,
        json!({"id":"town","placeId":"town","kind":"settlement","layerId":"settlements",
        "name":"River town","geometry":{"type":"Point","coordinates":[85,85]},
        "causes":["People gathered beside the river"],"attributes":{"population":200,"communityPopulation":1000,
        "ruralPopulation":800,"history":[{"era":"First era","townsfolk":100,"people":500},
        {"era":"Second era","townsfolk":200,"people":1000}],"groups":[{"people":"residents","culture":null,
        "languages":["river","coast"],"namingLanguage":"river","languageShares":{"river":{"knowledge":1,"use":0.75},
        "coast":{"knowledge":0.4,"use":0.25}},"religions":[],"practices":[],"count":1000}]}}),
    );
    let mut neighbour = town.clone();
    fields(
        &mut neighbour,
        json!({"id":"neighbour","placeId":"neighbour","name":"Coastal town",
        "geometry":{"type":"Point","coordinates":[95,85]},"attributes":{"population":50}}),
    );
    let mut road = island.clone();
    fields(
        &mut road,
        json!({"id":"road","placeId":"road","name":"Coastal road","layerId":"roads","kind":"road",
        "geometry":{"type":"LineString","coordinates":[[85,85],[95,85]]},
        "attributes":{"fromPlace":"town","toPlace":"neighbour","travellers":120,"roadClass":"road"}}),
    );
    let mut wild = island.clone();
    fields(
        &mut wild,
        json!({"id":"wild","placeId":"wild","name":"Wandering ground","layerId":"magic","kind":"veil:wild",
        "geometry":rectangle(Bounds(80.0,5.0,95.0,15.0)),"causes":[]}),
    );
    for record in [&island, &town, &neighbour, &road, &wild] {
        records.put(serde_json::from_value(record.clone())?)?;
    }
    for (id, name) in [("river", "River speech"), ("coast", "Coast speech")] {
        document.world["entities"][id] =
            json!({"id":id,"name":name,"kind":"language","attributes":{}});
    }
    let mut history: Vec<_> = [70.0,75.0].iter().enumerate().map(|(i, west)| json!({
        "path":["history"],"ancestry":[{"id":format!("Epoch {}", i+1),"duration":100,"parentEpoch":null,"variables":{}}],
        "causes":[{"kind":"geography","process":"atlas.magic-history","featureKind":"veil:wild",
        "observations":[{"id":"wild","name":"Wandering ground","geometry":rectangle(Bounds(*west,5.0,west+15.0,15.0))}]}]})).collect();
    history.push(json!({"path":["volcanoes"],"ancestry":[],"causes":[{"kind":"geography","process":"Island formed",
        "featureKind":"island","observations":[{"id":"island","name":"Basalt island","geometry":island["geometry"]}]}]}));
    document.metadata.insert("history".into(), json!(history));
    Ok(())
}
fn fields(record: &mut Value, changes: Value) {
    record
        .as_object_mut()
        .unwrap()
        .extend(changes.as_object().unwrap().clone());
}
