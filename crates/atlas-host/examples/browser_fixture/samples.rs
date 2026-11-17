use atlas_host::{
    generation_document::Document, native_resources::NativeResources, numerical_output::Sink,
};
use serde_json::json;
use std::{io, path::PathBuf};

/// The glen's own field; its geography carries the same id.
pub const GLEN_FIELD: &str = "supplied-glen";
/// One supplied numerical field: a regular grid of samples over `bounds`, valued by `value`.
struct Supplied<'a> {
    id: &'a str,
    bounds: [f64; 4],
    width: usize,
    height: usize,
    arrays: &'a [(&'a str, &'a str, &'a str, &'a str)],
    value: fn(&str, usize) -> f64,
    /// Whether its surface classes carry retained class contributions for boundaries.
    surface_support: bool,
}
const ARRAYS: [(&str, &str, &str, &str); 10] = [
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
/// The glen's own ground: limestone in the west, granite in the east, Aurora's cold under
/// the north-east and a Fire vein in the middle, so drawn cave walls have context to read.
const GLEN_ARRAYS: [(&str, &str, &str, &str); 7] = [
    ("active", "mask", "topology", "uint8"),
    ("measures", "square-metre", "topology", "float64"),
    ("Elevation", "native-length", "intensive", "float64"),
    ("RockLayerDepth0", "native-length", "intensive", "float64"),
    ("RockLayerKind0", "category", "category", "int32"),
    ("magic:aurora:coverage", "ratio", "intensive", "float64"),
    ("magic:fire:coverage:vein", "ratio", "intensive", "float64"),
];

pub async fn install(document: &mut Document, root: PathBuf) -> io::Result<()> {
    let island = Supplied {
        id: "supplied-map",
        bounds: [0.0, 0.0, 100.0, 100.0],
        width: 5,
        height: 5,
        arrays: &ARRAYS,
        value,
        surface_support: true,
    };
    let field = island.write(document, root).await?;
    document.world["fields"] = json!([field]);
    Ok(())
}
/// Supplies the real-scale glen's own field; the document already belongs to the glen.
pub async fn install_glen(
    document: &mut Document,
    root: PathBuf,
    frame: [f64; 4],
) -> io::Result<()> {
    let glen = Supplied {
        id: GLEN_FIELD,
        bounds: frame,
        width: 6,
        height: 5,
        arrays: &GLEN_ARRAYS,
        value: glen_value,
        surface_support: false,
    };
    let field = glen.write(document, root).await?;
    document.world["fields"] = json!([field]);
    Ok(())
}
impl Supplied<'_> {
    async fn write(&self, document: &Document, root: PathBuf) -> io::Result<serde_json::Value> {
        let mut store = NativeResources::new(root);
        let id = self.id;
        store.create(id).await?;
        let (width, height) = (self.width, self.height);
        for (name, _, _, dtype) in self.arrays {
            let metadata = json!({"zarr_format":3,"node_type":"array","shape":[height,width],"data_type":dtype,
                "chunk_grid":{"name":"regular","configuration":{"chunk_shape":[height,width]}},
                "chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},
                "fill_value":0,"codecs":[{"name":"bytes","configuration":{"endian":"little"}}],"attributes":{}});
            store
                .write(
                    id,
                    &format!("{name}/zarr.json"),
                    &serde_json::to_vec(&metadata)?,
                )
                .await?;
            let bytes: Vec<u8> = (0..width * height)
                .flat_map(|i| {
                    let value = (self.value)(name, i);
                    match *dtype {
                        "uint8" => vec![value as u8],
                        "int32" => (value as i32).to_le_bytes().to_vec(),
                        _ => value.to_le_bytes().to_vec(),
                    }
                })
                .collect();
            store.write(id, &format!("{name}/c/0/0"), &bytes).await?;
        }
        let channels: serde_json::Map<_, _> = self.arrays[2..]
            .iter()
            .map(|(name, _, _, _)| ((*name).into(), json!(name)))
            .collect();
        let mut descriptor = json!({"schemaVersion":1,"id":id,"revision":1,"scope":document.scope.located,
            "crsId":document.scope.crs_id,"bounds":self.bounds,"precision":1e-6,"layout":"regular",
            "sampling":{"width":width,"height":height},"state":"ready",
            "field":{"id":id,"scope":document.scope,"layoutResourceId":id,"geographyId":id,"channels":channels},
            "arrays":self.arrays.iter().map(|(name,unit,quantity,dtype)| json!({"name":name,"unit":unit,"quantity":quantity,"dtype":dtype,"shape":[height,width],"chunkShape":[height,width]})).collect::<Vec<_>>()});
        if self.surface_support {
            let support = support(&mut store, id, width * height).await?;
            descriptor["field"]["surfaceSupport"] =
                json!({"finalSurface":"surface_contributions","natural":"natural_contributions"});
            descriptor["arrays"].as_array_mut().unwrap().extend(support);
        }
        store
            .write(id, "resource.json", &serde_json::to_vec(&descriptor)?)
            .await?;
        Ok(json!({"id":id,"areaId":document.scope.located.area_id,
            "layerId":"geology","algorithm":"supplied","source":{"kind":"run","id":"supplied"},
            "samples":width * height,"channels":channels.keys().collect::<Vec<_>>(),"resourceId":id,"state":"generated"}))
    }
}
/// Retained class contributions behind the surface classes: eight (class, share) slots per
/// sample, every sample three parts its class and one part the next.
async fn support(
    store: &mut NativeResources,
    id: &str,
    samples: usize,
) -> io::Result<Vec<serde_json::Value>> {
    let length = samples * 16;
    let mut arrays = Vec::new();
    for name in ["surface_contributions", "natural_contributions"] {
        let metadata = json!({"zarr_format":3,"node_type":"array","shape":[length],"data_type":"float64","chunk_grid":{"name":"regular","configuration":{"chunk_shape":[length]}},"chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},"fill_value":0,"codecs":[{"name":"bytes","configuration":{"endian":"little"}}],"attributes":{}});
        store
            .write(
                id,
                &format!("{name}/zarr.json"),
                &serde_json::to_vec(&metadata)?,
            )
            .await?;
        let bytes = (0..length)
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
        arrays.push(json!({"name":name,"unit":"topology","quantity":"topology","dtype":"float64","shape":[length],"chunkShape":[length]}));
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
/// Six columns of 5 m from x 40 and five rows of 4.5 m from y 40.
fn glen_value(name: &str, i: usize) -> f64 {
    let (column, row) = (i % 6, i / 6);
    match name {
        "active" => 1.0,
        "measures" => 22.5,
        "Elevation" => (300.0 + row as f64 * 2.0) * 1024.0,
        "RockLayerDepth0" => 20.0 * 1024.0,
        // Limestone (3) west of x 55, granite (10) east of it.
        "RockLayerKind0" if column < 3 => 3.0,
        "RockLayerKind0" => 10.0,
        "magic:aurora:coverage" if column >= 4 && row <= 1 => 0.6,
        "magic:fire:coverage:vein" if column == 3 && row == 3 => 0.5,
        "magic:aurora:coverage" | "magic:fire:coverage:vein" => 0.0,
        _ => unreachable!(),
    }
}
