use atlas_host::{
    generation_document::Document, native_resources::NativeResources, numerical_output::Sink,
};
use serde_json::json;
use std::{io, path::PathBuf};

pub async fn install(document: &mut Document, root: PathBuf) -> io::Result<()> {
    let mut store = NativeResources::new(root);
    let id = "supplied-map";
    store.create(id).await?;
    let arrays = [
        ("active", "mask", "topology", "uint8"),
        ("measures", "square-metre", "topology", "float64"),
        ("Elevation", "native-length", "intensive", "float64"),
        ("finalSurface", "category", "category", "int32"),
        ("naturalSurface", "category", "category", "int32"),
        ("Temperature", "celsius", "intensive", "float64"),
        ("BiomeCodes", "category", "category", "int32"),
        ("TreeCover", "ratio", "intensive", "float64"),
        ("RockLayerDepth0", "native-length", "intensive", "float64"),
        ("RockLayerKind0", "category", "category", "int32"),
    ];
    for (name, _, _, dtype) in arrays {
        let metadata = json!({"zarr_format":3,"node_type":"array","shape":[5,5],"data_type":dtype,
            "chunk_grid":{"name":"regular","configuration":{"chunk_shape":[5,5]}},
            "chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},
            "fill_value":0,"codecs":[{"name":"bytes","configuration":{"endian":"little"}}],"attributes":{}});
        store
            .write(
                id,
                &format!("{name}/zarr.json"),
                &serde_json::to_vec(&metadata)?,
            )
            .await?;
        let bytes: Vec<u8> = (0..25)
            .flat_map(|i| {
                let value = value(name, i);
                match dtype {
                    "uint8" => vec![value as u8],
                    "int32" => (value as i32).to_le_bytes().to_vec(),
                    _ => value.to_le_bytes().to_vec(),
                }
            })
            .collect();
        store.write(id, &format!("{name}/c/0/0"), &bytes).await?;
    }
    let channels: serde_json::Map<_, _> = arrays[2..]
        .iter()
        .map(|(name, _, _, _)| ((*name).into(), json!(name)))
        .collect();
    let support = support(&mut store, id).await?;
    let mut descriptor = json!({"schemaVersion":1,"id":id,"revision":1,"scope":document.scope.located,
        "crsId":document.scope.crs_id,"bounds":[0,0,100,100],"precision":1e-6,"layout":"regular",
        "sampling":{"width":5,"height":5},"state":"ready",
        "field":{"id":id,"scope":document.scope,"layoutResourceId":id,"geographyId":id,"channels":channels},
        "arrays":arrays.iter().map(|(name,unit,quantity,dtype)| json!({"name":name,"unit":unit,"quantity":quantity,"dtype":dtype,"shape":[5,5],"chunkShape":[5,5]})).collect::<Vec<_>>()});
    descriptor["field"]["surfaceSupport"] =
        json!({"finalSurface":"surface_contributions","natural":"natural_contributions"});
    descriptor["arrays"].as_array_mut().unwrap().extend(support);
    store
        .write(id, "resource.json", &serde_json::to_vec(&descriptor)?)
        .await?;
    document.world["fields"] = json!([{"id":id,"areaId":document.scope.located.area_id,
        "layerId":"geology","algorithm":"supplied","source":{"kind":"run","id":"supplied"},
        "samples":25,"channels":channels.keys().collect::<Vec<_>>(),"resourceId":id,"state":"generated"}]);
    Ok(())
}
async fn support(store: &mut NativeResources, id: &str) -> io::Result<Vec<serde_json::Value>> {
    let mut arrays = Vec::new();
    for name in ["surface_contributions", "natural_contributions"] {
        let metadata = json!({"zarr_format":3,"node_type":"array","shape":[400],"data_type":"float64","chunk_grid":{"name":"regular","configuration":{"chunk_shape":[400]}},"chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},"fill_value":0,"codecs":[{"name":"bytes","configuration":{"endian":"little"}}],"attributes":{}});
        store
            .write(
                id,
                &format!("{name}/zarr.json"),
                &serde_json::to_vec(&metadata)?,
            )
            .await?;
        let bytes = (0..400)
            .flat_map(|i| {
                let value: f64 = match i % 16 {
                    0 => 32.0,
                    1 => 0.75,
                    2 => 31.0,
                    3 => 0.25,
                    _ => 0.0,
                };
                value.to_le_bytes()
            })
            .collect::<Vec<_>>();
        store.write(id, &format!("{name}/c/0"), &bytes).await?;
        arrays.push(json!({"name":name,"unit":"topology","quantity":"topology","dtype":"float64","shape":[400],"chunkShape":[400]}));
    }
    Ok(arrays)
}
fn value(name: &str, i: usize) -> f64 {
    match name {
        "active" => 1.0,
        "measures" => 400.0,
        "Elevation" => (100.0 + (i % 5) as f64 * 250.0 + (i / 5) as f64 * 125.0) * 1024.0,
        "finalSurface" | "naturalSurface" => 32.0,
        "Temperature" => (i % 5) as f64 * 10.0 - 20.0,
        "BiomeCodes" => {
            if i % 5 < 2 {
                3.0
            } else {
                4.0
            }
        }
        "TreeCover" => 0.8,
        "RockLayerDepth0" => 12.0 * 1024.0,
        "RockLayerKind0" => 11.0,
        _ => unreachable!(),
    }
}
