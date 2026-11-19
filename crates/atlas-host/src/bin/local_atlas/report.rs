//! A map's report, read from its published GIS storage through the map service: the map's
//! description, every published kind with its count, and pictures in which the land, water,
//! fields, plots, ways and buildings are drawn at their real size.
use crate::{
    client::Server,
    picture::{Canvas, Extent, Frame, Point},
    town::{roof, BACKGROUND, BUILDING_EDGE, FIELD, FOOTPATH, PLOT, STREET},
    write_json,
};
use atlas_map::{Geometry, MapFeature, MapRef};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, io, path::Path};

#[derive(Deserialize)]
struct Page {
    items: Vec<MapFeature>,
    next: Option<String>,
}
/// Visits every feature of one space, optionally only those of the given layers.
pub fn features(
    server: &Server,
    reference: &MapRef,
    space: &str,
    layers: Option<&[&str]>,
    mut visit: impl FnMut(MapFeature),
) -> io::Result<()> {
    let mut cursor: Option<String> = None;
    loop {
        let page: Page = server.call(
            "maps/read",
            &json!({"method": "features", "args": [
                reference,
                {"spaceId": space, "layerIds": layers, "cursor": cursor},
            ]}),
        )?;
        page.items.into_iter().for_each(&mut visit);
        match page.next {
            Some(next) => cursor = Some(next),
            None => return Ok(()),
        }
    }
}

const WATER: &str = "#8fb1cf";
const PICTURE: u32 = 2000;
/// Width in metres of the close-up at a town's centre.
const CENTRE: f64 = 1_500.;

/// What the map pictures draw, in drawing order.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Layer {
    Water,
    River,
    Field,
    Plot,
    Square,
    Way,
    Building,
}
struct Drawn {
    layer: Layer,
    geometry: Geometry,
    width: f64,
    colour: &'static str,
}
fn drawn(feature: &MapFeature) -> Option<Drawn> {
    let mean_width = |fallback: f64| {
        feature
            .attributes
            .get("widths")
            .and_then(Value::as_array)
            .map(|w| w.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
            .filter(|w| !w.is_empty())
            .map_or(fallback, |w| w.iter().sum::<f64>() / w.len() as f64)
    };
    let (layer, width, colour) = match feature.kind.as_str() {
        "ocean" | "sea" | "lake" | "pool" | "lagoon" | "reservoir" => (Layer::Water, 0., WATER),
        "river" | "stream" | "canal" => (Layer::River, 8., WATER),
        "field" => (Layer::Field, 0., FIELD.0),
        "yard" => (Layer::Plot, 0., PLOT.0),
        "square" => (Layer::Square, 0., "#ece5cf"),
        "street" | "lane" => (Layer::Way, mean_width(6.), STREET),
        "trail" => (Layer::Way, mean_width(2.5), "#a08f6a"),
        "footpath" => (Layer::Way, mean_width(1.5), FOOTPATH),
        "building" => (
            Layer::Building,
            0.,
            roof(
                feature
                    .attributes
                    .get("buildingFunction")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ),
        ),
        _ => return None,
    };
    Some(Drawn {
        layer,
        geometry: feature.geometry.clone(),
        width,
        colour,
    })
}
fn draw(canvas: &mut Canvas, things: &[Drawn]) {
    for thing in things {
        match thing.layer {
            Layer::Water => canvas.fill(&thing.geometry, thing.colour, None),
            Layer::River | Layer::Way => {
                canvas.outline(&thing.geometry, thing.width, 0.7, thing.colour)
            }
            Layer::Field => canvas.fill(&thing.geometry, thing.colour, Some((FIELD.1, 0.6))),
            Layer::Plot | Layer::Square => {
                canvas.fill(&thing.geometry, thing.colour, Some((PLOT.1, 0.6)))
            }
            Layer::Building => {
                canvas.fill(&thing.geometry, thing.colour, Some((BUILDING_EDGE, 0.6)))
            }
        }
    }
}

/// A town's buildings: how many, how many have a street address, and where they stand.
#[derive(Default)]
struct Town {
    buildings: usize,
    addressed: usize,
    extent: Extent,
    sum: [f64; 2],
}

/// Writes `map.json`, `summary.txt` and the map pictures into `directory`.
pub fn report(server: &Server, reference: &MapRef, directory: &Path) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    let map: Value = server.call("maps/read", &json!({"method": "open", "args": [reference]}))?;
    write_json(&directory.join("map.json"), &map)?;
    let bounds: [f64; 4] = serde_json::from_value(map["bounds"].clone())?;
    let [w, s, e, n] = bounds;
    let mut lines = vec![
        format!(
            "{}  {}",
            text(&map["name"]),
            serde_json::to_string(reference)?
        ),
        format!("{:.2} × {:.2} km", (e - w) / 1000., (n - s) / 1000.),
    ];
    let spaces = map["spaces"].as_array().cloned().unwrap_or_default();
    let primary = text(&map["primarySpaceId"]);
    // hpc-exempt: published kind counts by space and layer, each in first-seen order.
    let mut counts = BTreeMap::<(String, String), Vec<(String, usize)>>::new();
    // hpc-exempt: towns by name, in first-seen order of their buildings.
    let mut towns = Vec::<(String, Town)>::new();
    let mut things = Vec::new();
    for space in &spaces {
        let id = text(&space["id"]);
        features(server, reference, &id, None, |feature| {
            let kinds = counts
                .entry((feature.space_id.to_string(), feature.layer_id.clone()))
                .or_default();
            match kinds.iter_mut().find(|(kind, _)| *kind == feature.kind) {
                Some((_, count)) => *count += 1,
                None => kinds.push((feature.kind.clone(), 1)),
            }
            if id != primary {
                return;
            }
            let attribute = |name: &str| feature.attributes.get(name);
            if let (true, Some(settlement), true) = (
                feature.kind == "building",
                attribute("settlement").and_then(Value::as_str),
                attribute("occupation")
                    .and_then(Value::as_f64)
                    .is_some_and(|o| o > 0.),
            ) {
                let index = match towns.iter().position(|(name, _)| name == settlement) {
                    Some(index) => index,
                    None => {
                        towns.push((settlement.to_owned(), Town::default()));
                        towns.len() - 1
                    }
                };
                let town = &mut towns[index].1;
                town.buildings += 1;
                if attribute("address").is_some_and(|a| !a.is_null())
                    && attribute("streetId").is_some_and(|a| !a.is_null())
                {
                    town.addressed += 1;
                }
                let mut extent = Extent::default();
                extent.include_geometry(&feature.geometry);
                let [w, s, e, n] = extent.0;
                town.extent.include([w, s]);
                town.extent.include([e, n]);
                town.sum[0] += (w + e) / 2.;
                town.sum[1] += (s + n) / 2.;
            }
            things.extend(drawn(&feature));
        })?;
    }
    for (name, town) in &towns {
        lines.push(format!(
            "{name}: {} of {} occupied buildings have a street address",
            town.addressed, town.buildings
        ));
    }
    let layers = map["layers"].as_array().cloned().unwrap_or_default();
    for space in &spaces {
        let id = text(&space["id"]);
        let in_space: Vec<_> = layers
            .iter()
            .filter(|layer| text(&layer["spaceId"]) == id)
            .collect();
        let rasters = in_space
            .iter()
            .filter(|layer| layer["source"]["kind"] == "raster")
            .count();
        let floor = space["frame"]["floor"].as_str().unwrap_or("surface");
        lines.push(format!("\nSpace {floor} ({id}): {rasters} raster layers"));
        for layer in in_space
            .iter()
            .filter(|layer| layer["source"]["kind"] == "vector")
        {
            if let Some(kinds) = counts.get(&(id.clone(), text(&layer["id"]))) {
                let listed: Vec<_> = kinds.iter().map(|(k, c)| format!("{k} {c}")).collect();
                lines.push(format!("  {}: {}", text(&layer["name"]), listed.join(", ")));
            }
        }
    }
    let summary = lines.join("\n");
    fs::write(directory.join("summary.txt"), summary.clone() + "\n")?;
    println!("{summary}");
    things.sort_by_key(|thing| thing.layer);
    let mut written = vec![picture(
        &things,
        Frame::around(bounds, 4. / 3., 0., 0.),
        directory,
        "map.png",
    )?];
    // The town with the most occupied buildings, whole and at its centre.
    if let Some((_, town)) = towns.iter().max_by_key(|(_, town)| town.buildings) {
        let centre: Point = [
            town.sum[0] / town.buildings as f64,
            town.sum[1] / town.buildings as f64,
        ];
        written.push(picture(
            &things,
            Frame::around(town.extent.0, 4. / 3., 0.08, CENTRE),
            directory,
            "town.png",
        )?);
        written.push(picture(
            &things,
            Frame::centred(centre, CENTRE, 4. / 3.),
            directory,
            "town-centre.png",
        )?);
    }
    println!("\nWritten to {}", directory.display());
    for path in written {
        println!("picture {path}");
    }
    Ok(())
}
fn picture(things: &[Drawn], frame: Frame, directory: &Path, file: &str) -> io::Result<String> {
    let mut canvas = Canvas::new(PICTURE, frame, BACKGROUND)?;
    draw(&mut canvas, things);
    let path = directory.join(file);
    canvas.save(&path)?;
    Ok(path.display().to_string())
}
fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_owned()
}
