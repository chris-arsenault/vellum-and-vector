//! Tool names, descriptions and input schemas. The text is what an agent reads to author
//! maps, so it states shapes and units, not intent.
use serde_json::{json, Value};

const MAP_NOTE: &str = "Map reference object {\"mapId\":\"<uuid>\",\"revision\":\"<uuid>\"} exactly as returned by create_map or list_maps.";

fn map_property() -> Value {
    json!({
        "type": "object",
        "description": MAP_NOTE,
        "properties": {"mapId": {"type": "string"}, "revision": {"type": "string"}},
        "required": ["mapId", "revision"],
    })
}
fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {"type": "object", "properties": properties, "required": required},
    })
}
fn map_only(name: &str, description: &str) -> Value {
    tool(name, description, json!({"map": map_property()}), &["map"])
}

const EDIT_DESCRIPTION: &str = r#"Apply one vector edit to a map. All coordinates are map metres [x, y] inside the bounds that describe_map reports. `command` is an object with a `command` tag:
- create: {"command":"create","layerId":"vector:landmasses","kind":"landmass","name":"Isle","geometry":{...},"attributes":{},"creatorLayer":null}. layerId and kind come from list_kinds; geometry must match the kind's suggested geometry. All of layerId, kind, geometry, attributes and creatorLayer are required (name may be null).
- reshape: {"command":"reshape","id":"<feature id>","geometry":{...}} new vertices for one feature.
- transform: {"command":"transform","ids":[...],"transform":{"translate":[dx,dy],"rotate":degrees_ccw,"scale":1.0,"about":[x,y]}}.
- duplicate: {"command":"duplicate","ids":[...],"offset":[dx,dy]}.
- delete: {"command":"delete","ids":[...]}.
- setAttributes: {"command":"setAttributes","ids":[...],"name":"New name","attributes":{"key":value}} (a null value removes the attribute).
Geometry is GeoJSON: Point {"type":"Point","coordinates":[x,y]}; LineString {"type":"LineString","coordinates":[[x,y],...]}; Polygon {"type":"Polygon","coordinates":[[[x,y],...]]} with the first ring closed (first point repeated last).
Worked examples (create):
1. Landmass polygon: {"command":"create","layerId":"vector:landmasses","kind":"landmass","name":"Isle","geometry":{"type":"Polygon","coordinates":[[[300,150],[700,150],[700,350],[300,350],[300,150]]]},"attributes":{},"creatorLayer":null}. Land polygons are the authority for land and sea: terrain follows them.
2. River line: {"command":"create","layerId":"vector:rivers","kind":"river","name":"Glen burn","geometry":{"type":"LineString","coordinates":[[500,300],[480,250],[450,200]]},"attributes":{},"creatorLayer":null}.
3. Point place (a peak): {"command":"create","layerId":"vector:geology","kind":"peak","name":"Mount Test","geometry":{"type":"Point","coordinates":[500,250]},"attributes":{},"creatorLayer":null}.
Other commands (pasteStyle, addLayer, renameLayer, lockLayer, moveToLayer, mergeDown, deleteLayer) are accepted in the same tagged form. Returns the map reference, the ids of changed and created features and the undo history. Landmass edits re-conform terrain automatically."#;

const TERRAIN_DESCRIPTION: &str = r#"Sculpt the height grid of an authored map. Heights are metres, sea level is 0, positions and distances are map metres. Land polygons (landmass features) keep ocean below 0 and land above it; use these edits to shape relief within them. `edit` is {"type":..., "value":{...}}:
- stroke: brush path. {"type":"stroke","value":{"points":[[x,y],...],"radius":60,"strength":1.0,"mode":"raise|lower|smooth|flatten|set","target":0,"stepHeight":400}}. strength is 0..1; stepHeight is metres a full-strength dab adds (raise) or removes (lower); target is the height flatten/set blend toward.
- line: guide line with a height per vertex. {"type":"line","value":{"points":[[x,y],...],"heights":[h,...],"halfWidth":2000}} (heights has one entry per point).
- area: polygon raised or lowered to one height. {"type":"area","value":{"rings":[[[x,y],...]],"height":1200,"feather":5000}} (outer ring first, then holes; feather is the soft skirt width, 0 for a hard edge).
- peak: smooth summit. {"type":"peak","value":{"at":[x,y],"height":2500,"radius":30000}}.
- conform: {"type":"conform"} brings heights back in line with the coasts.
Returns the changed pixel rectangle, terrain version and whether undo/redo remain."#;

pub fn tool_definitions() -> Vec<Value> {
    vec![
        tool(
            "list_maps",
            "List saved maps on the atlas server with their map references. Pass `cursor` from a previous `next` to continue.",
            json!({"cursor": {"type": "string", "description": "Paging cursor from a previous result's `next`."}}),
            &[],
        ),
        tool(
            "create_map",
            "Create a new authored map that starts as open ocean with every layer of its profile and a terrain raster. Returns the map reference to pass to the other tools.",
            json!({
                "name": {"type": "string"},
                "profile": {"type": "string", "enum": ["world", "region", "city"], "description": "The level of the atlas the map represents."},
                "width": {"type": "number", "description": "Frame width in metres; the profile's default when omitted."},
                "height": {"type": "number", "description": "Frame height in metres; the profile's default when omitted."},
            }),
            &["name", "profile"],
        ),
        map_only(
            "describe_map",
            "Describe a map: name, profile, bounds in metres [minX,minY,maxX,maxY], layers (id, name, source, geometry hints, feature counts) and the terrain raster size.",
        ),
        tool(
            "list_kinds",
            "List every feature kind that can be placed, per layer: layer id, kind id, label, catalogue path and suggested geometry. Use the layer id and kind with apply_edit create. Results are capped at 200; pass `layer` to narrow.",
            json!({"map": map_property(), "layer": {"type": "string", "description": "Layer id such as vector:geology (the vector: prefix is optional)."}}),
            &["map"],
        ),
        tool(
            "query_features",
            "Read features on a map: id, layer, kind, name, geometry, attributes. Filters combine. Results are capped by `limit` (max 200); when `next` is returned pass it as `cursor` for the following page.",
            json!({
                "map": map_property(),
                "layer": {"type": "string", "description": "Layer id such as vector:landmasses."},
                "bounds": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4, "description": "[minX,minY,maxX,maxY] in metres."},
                "text": {"type": "string", "description": "Name text to match."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "description": "Default 50."},
                "cursor": {"type": "string"},
            }),
            &["map"],
        ),
        tool(
            "apply_edit",
            EDIT_DESCRIPTION,
            json!({"map": map_property(), "command": {"type": "object", "description": "An EditCommand with a `command` tag.", "properties": {"command": {"type": "string"}}, "required": ["command"]}}),
            &["map", "command"],
        ),
        tool(
            "edit_terrain",
            TERRAIN_DESCRIPTION,
            json!({"map": map_property(), "edit": {"type": "object", "description": "A TerrainEdit: {type, value}.", "properties": {"type": {"type": "string", "enum": ["stroke", "line", "area", "peak", "conform"]}, "value": {"type": "object"}}, "required": ["type"]}}),
            &["map", "edit"],
        ),
        tool(
            "undo",
            "Undo the last step. target `features` undoes the last vector edit; `terrain` the last terrain edit.",
            json!({"map": map_property(), "target": {"type": "string", "enum": ["features", "terrain"]}}),
            &["map", "target"],
        ),
        tool(
            "redo",
            "Redo the last undone step. target `features` redoes a vector edit; `terrain` a terrain edit.",
            json!({"map": map_property(), "target": {"type": "string", "enum": ["features", "terrain"]}}),
            &["map", "target"],
        ),
        map_only(
            "edit_history",
            "List the vector edit steps (sequence, label, undone) of a map. Terrain edits are not listed; undo/redo report whether more remain.",
        ),
    ]
}
