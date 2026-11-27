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
    Park,
    Water,
    River,
    Field,
    /// A city block, coloured by its use.
    Block,
    CityGround,
    Plot,
    Square,
    Footpath,
    Way,
    Wall,
    District,
    /// Major routes often follow district edges. Keep their carriageways visible.
    Avenue,
    CityDistrict,
    Building,
    /// A point place: a landmark or major work, marked at a fixed size in pixels.
    Mark,
}
/// A city block's colour by its use; the rest of a city map's kinds are drawn by kind.
fn block_colour(use_: &str) -> &'static str {
    match use_ {
        "residential" => "#d9a77f",
        "business" => "#c2553f",
        "civic" => "#7a68b0",
        _ => "#c8c08a",
    }
}
struct Drawn {
    initial_city: bool,
    arterial_strength: Option<f64>,
    layer: Layer,
    geometry: Geometry,
    footprint: Option<Geometry>,
    symbol_width: f64,
    width: f64,
    footpath_wear: Option<f64>,
    colour: &'static str,
}
type Symbol = (Layer, f64, &'static str);

fn course_symbol(feature: &MapFeature, real_scale: bool) -> Option<Symbol> {
    let mean_width = |fallback: f64| {
        feature
            .attributes
            .get("widths")
            .and_then(Value::as_array)
            .map(|w| w.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
            .filter(|w| !w.is_empty())
            .map_or(fallback, |w| w.iter().sum::<f64>() / w.len() as f64)
    };
    Some(match feature.kind.as_str() {
        "river" | "stream" | "canal" if real_scale => (Layer::River, mean_width(8.), WATER),
        "river" | "stream" | "canal" => (Layer::River, 8., WATER),
        "street"
            if feature.attributes.get("roadClass").and_then(Value::as_str)
                == Some("mainStreet") =>
        {
            (Layer::Avenue, mean_width(8.), "#f4d69b")
        }
        "street" | "lane" if real_scale => (Layer::Way, mean_width(6.), "#e8ddc5"),
        "street" | "lane" => (Layer::Way, mean_width(6.), STREET),
        "trail" => (Layer::Way, mean_width(2.5), "#a08f6a"),
        "footpath" => (Layer::Footpath, mean_width(1.5), FOOTPATH),
        "road" => (Layer::Way, 8., "#8a7350"),
        "thoroughfare" if real_scale => (Layer::Avenue, mean_width(10.), "#f4d69b"),
        "thoroughfare" => match feature.attributes.get("class").and_then(Value::as_str) {
            Some("Avenue" | "Approach" | "Civic approach") => {
                (Layer::Avenue, mean_width(12.), "#fff1cf")
            }
            _ => (Layer::Way, mean_width(6.), "#f4e5c9"),
        },
        _ => return None,
    })
}

fn urban_ground_colour(feature: &MapFeature, real_scale: bool) -> &'static str {
    let ground_use = feature.attributes.get("groundUse").and_then(Value::as_str);
    let (city, street) = match ground_use {
        Some("Crowded housing") => ("#aa7557", "#d9c6b3"),
        Some("Garden housing") => ("#b9c69b", "#dce0c6"),
        Some("Trade frontage") => ("#c8915d", "#e1ceb3"),
        Some("Working ground") => ("#aaa394", "#d7d2c4"),
        Some("Civic precinct") => ("#ad9cb4", "#d9d0cc"),
        Some("Common ground") => ("#c4d1b7", "#c4d1b7"),
        _ => ("#debf9c", "#e3d8c5"),
    };
    if real_scale {
        street
    } else {
        city
    }
}

fn feature_symbol(feature: &MapFeature, real_scale: bool) -> Option<Symbol> {
    Some(match feature.kind.as_str() {
        "park" => (Layer::Park, 0., "#a8bd90"),
        "square" if feature.name.as_deref() == Some("Common green") => (Layer::Park, 0., "#b4c39a"),
        "ocean" | "sea" | "lake" | "pool" | "lagoon" | "reservoir" => (Layer::Water, 0., WATER),
        "field" => (Layer::Field, 0., FIELD.0),
        "yard" => (Layer::Plot, 0., PLOT.0),
        "square" => (Layer::Square, 0., "#ece5cf"),
        "urbanGround" => (
            Layer::CityGround,
            0.,
            urban_ground_colour(feature, real_scale),
        ),
        "cityBlock" if real_scale => (Layer::Block, 0., "#ddd7be"),
        "cityBlock" => (
            Layer::Block,
            0.,
            block_colour(
                feature
                    .attributes
                    .get("use")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ),
        ),
        "cityWall" => (Layer::Wall, 8., "#3b2f28"),
        "district" if real_scale => (Layer::District, 1., "#627679"),
        "district" => (Layer::CityDistrict, 1., "#334f64"),
        "cityGate" => (Layer::Mark, 3., "#584335"),
        "majorWork" => (Layer::Mark, 14., "#1d1d1d"),
        "cityPlace" => (Layer::Mark, 4., "#853c55"),
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
        _ => return course_symbol(feature, real_scale),
    })
}

fn drawn(feature: &MapFeature, real_scale: bool) -> Option<Drawn> {
    let (layer, width, colour) = feature_symbol(feature, real_scale)?;
    Some(Drawn {
        footprint: if real_scale && matches!(layer, Layer::River | Layer::Way | Layer::Avenue) {
            feature
                .footprint
                .as_ref()
                .map(atlas_map::regions::as_geometry)
        } else {
            None
        },
        symbol_width: match feature.attributes.get("roadClass").and_then(Value::as_str) {
            Some("mainStreet") => 2.2,
            Some("road" | "street") => 1.5,
            Some("lane") => 0.9,
            Some("alley") => 0.55,
            _ => 0.7,
        },
        arterial_strength: feature
            .attributes
            .get("arterialStrength")
            .and_then(Value::as_f64),
        initial_city: matches!(
            feature.kind.as_str(),
            "majorWork" | "road" | "river" | "lake"
        ) || feature.kind == "thoroughfare"
            && (feature.attributes.get("class").and_then(Value::as_str) == Some("Approach")
                || feature
                    .attributes
                    .get("layoutRound")
                    .and_then(Value::as_u64)
                    .is_some_and(|r| r <= 1)),
        layer,
        geometry: feature.geometry.clone(),
        footpath_wear: feature.attributes.get("wear").and_then(Value::as_f64),
        width,
        colour,
    })
}
fn draw(canvas: &mut Canvas, things: &[Drawn]) {
    for thing in things {
        draw_feature(canvas, thing);
    }
}
fn draw_feature(canvas: &mut Canvas, thing: &Drawn) {
    match thing.layer {
        Layer::Park | Layer::Water => canvas.fill(&thing.geometry, thing.colour, None),
        Layer::Footpath => canvas.footpath(
            &crate::picture::parts(&thing.geometry),
            thing.width,
            thing.footpath_wear,
        ),
        Layer::River | Layer::Way => draw_course(canvas, thing, thing.symbol_width),
        Layer::Wall => canvas.outline(&thing.geometry, thing.width, 2., thing.colour),
        Layer::District => canvas.outline(&thing.geometry, thing.width, 1.2, thing.colour),
        Layer::CityDistrict => canvas.outline(&thing.geometry, thing.width, 1.2, thing.colour),
        Layer::Avenue => {
            let face = thing
                .arterial_strength
                .map_or(thing.symbol_width.max(1.6), |s| 0.8 + 2.8 * s);
            if thing.footprint.is_none() {
                canvas.outline(&thing.geometry, thing.width + 2., face + 1.2, "#80694e");
            }
            draw_course(canvas, thing, face);
        }
        Layer::CityGround => canvas.fill(&thing.geometry, thing.colour, None),
        Layer::Block => canvas.fill(&thing.geometry, thing.colour, Some((PLOT.1, 0.6))),
        Layer::Mark => canvas.mark(&thing.geometry, thing.width, thing.colour),
        Layer::Field => canvas.fill(&thing.geometry, thing.colour, Some((FIELD.1, 0.6))),
        Layer::Plot | Layer::Square => {
            canvas.fill(&thing.geometry, thing.colour, Some((PLOT.1, 0.6)))
        }
        Layer::Building => canvas.fill(&thing.geometry, thing.colour, Some((BUILDING_EDGE, 0.6))),
    }
}

fn draw_course(canvas: &mut Canvas, thing: &Drawn, symbol_width: f64) {
    if let Some(area) = &thing.footprint {
        let road = matches!(thing.layer, Layer::Way | Layer::Avenue);
        canvas.fill(area, thing.colour, road.then_some(("#897454", 0.6)));
        if canvas.pixels(thing.width) < symbol_width {
            if road {
                canvas.outline(&thing.geometry, 0., symbol_width + 0.8, "#897454");
            }
            canvas.outline(&thing.geometry, 0., symbol_width, thing.colour);
        }
    } else {
        canvas.outline(&thing.geometry, thing.width, symbol_width, thing.colour);
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
/// A realm or an event the people suffered, as one line for reading a world's history at a
/// glance.
fn annal(feature: &MapFeature) -> Option<String> {
    let attribute = |name: &str| feature.attributes.get(name);
    let text = |name: &str| attribute(name).and_then(Value::as_str);
    let number = |name: &str| attribute(name).and_then(Value::as_f64).unwrap_or(0.);
    match feature.kind.as_str() {
        "sovereignty" => Some(format!(
            "  realm {}{}",
            feature.name.as_deref().unwrap_or("unnamed"),
            text("status").map_or_else(String::new, |s| format!(" ({s})"))
        )),
        "settlement" if number("goodsTradedPerYear") > 0.0 => Some(format!(
            "  town {} trades {} goods a year",
            feature.name.as_deref().unwrap_or("unnamed"),
            number("goodsTradedPerYear")
        )),
        "societyEvent" => Some(format!(
            "  {} at {}: {} died, {} fled{}",
            text("eventKind").unwrap_or("event"),
            text("era").unwrap_or("?"),
            number("casualties"),
            number("displaced"),
            if attribute("refugeAt").is_some_and(|r| !r.is_null()) {
                " to a town"
            } else {
                ""
            }
        )),
        _ => None,
    }
}
type KindCounts = BTreeMap<(String, String), Vec<(String, usize)>>;

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
    let real_scale = !map["realScale"].is_null();
    // hpc-exempt: published kind counts by space and layer, each in first-seen order.
    let mut counts = KindCounts::new();
    // hpc-exempt: towns by name, in first-seen order of their buildings.
    let mut towns = Vec::<(String, Town)>::new();
    let mut things = Vec::new();
    let mut annals = Vec::new();
    // A city map's blocks and districts, for a picture framed on the city.
    let mut city: Option<Extent> = None;
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
            if matches!(feature.kind.as_str(), "cityBlock" | "district") {
                city.get_or_insert_with(Extent::default)
                    .include_geometry(&feature.geometry);
            }
            let attribute = |name: &str| feature.attributes.get(name);
            annals.extend(annal(&feature));
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
                    && atlas_map::authoring::street_of(&feature).is_some()
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
            things.extend(drawn(&feature, real_scale));
        })?;
    }
    for (name, town) in &towns {
        lines.push(format!(
            "{name}: {} of {} occupied buildings have a street address",
            town.addressed, town.buildings
        ));
    }
    list_layers(&map, &spaces, &counts, &mut lines);
    if !annals.is_empty() {
        lines.push("\nRealms and events:".into());
        lines.extend(annals);
    }
    let summary = lines.join("\n");
    fs::write(directory.join("summary.txt"), summary.clone() + "\n")?;
    println!("{summary}");
    things.sort_by_key(|thing| thing.layer);
    let mut written = vec![picture(
        &things,
        Frame::around(bounds, 4. / 3., if real_scale { 0.04 } else { 0. }, 0.),
        directory,
        "map.png",
    )?];
    if let Some(city) = city {
        written.extend(city_pictures(
            server, reference, &map, city, &things, directory,
        )?);
    }
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
fn list_layers(map: &Value, spaces: &[Value], counts: &KindCounts, lines: &mut Vec<String>) {
    let layers = map["layers"].as_array().cloned().unwrap_or_default();
    for space in spaces {
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
}

fn city_pictures(
    server: &Server,
    reference: &MapRef,
    map: &Value,
    city: Extent,
    things: &[Drawn],
    directory: &Path,
) -> io::Result<Vec<String>> {
    let mut written = Vec::new();
    let mut layers = map["layers"].as_array().into_iter().flatten();
    let primary = text(&map["primarySpaceId"]);
    let real_scale = !map["realScale"].is_null();
    let bounds = serde_json::from_value(map["bounds"].clone())?;
    if let Some(layer) =
        layers.find(|l| !real_scale && l["id"] == "raster:finalSurface" && l["spaceId"] == primary)
    {
        let mut canvas = Canvas::new(
            PICTURE,
            Frame::around(bounds, 4. / 3., 0.04, CENTRE),
            "#f3f1e9",
        )?;
        let layer: atlas_map::MapLayer = serde_json::from_value(layer.clone())?;
        let footprint = serde_json::from_value(map["footprint"].clone())?;
        let image = surface_image(server, reference, &layer)?;
        canvas.surface(&image, layer.bounds, &footprint);
        for thing in things.iter().filter(|t| t.initial_city) {
            draw_feature(&mut canvas, thing);
        }
        let early = directory.join("early-works-and-roads.png");
        canvas.save(&early)?;
        written.push(early.display().to_string());
        canvas.surface(&image, layer.bounds, &footprint);
        draw(&mut canvas, things);
        let path = directory.join("city.png");
        canvas.save(&path)?;
        written.push(path.display().to_string());
    } else {
        written.push(picture(
            things,
            Frame::around(city.0, 4. / 3., 0.05, CENTRE),
            directory,
            "city.png",
        )?);
    }
    if real_scale && things.iter().any(|thing| thing.layer == Layer::Building) {
        let [centre]: [atlas_map::GeometryResult; 1] = server.call(
            "maps/read",
            &json!({"method":"geometries", "args":[reference, primary, [
                {"operation":"interior", "geometry":map["footprint"]}
            ]]}),
        )?;
        if let atlas_map::GeometryResult::Position(centre) = centre {
            let [x, y, _] = centre.coordinates();
            written.push(picture(
                things,
                Frame::centred([x, y], 500., 4. / 3.),
                directory,
                "district-detail.png",
            )?);
        }
    }
    Ok(written)
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

fn surface_image(
    server: &Server,
    reference: &MapRef,
    layer: &atlas_map::MapLayer,
) -> io::Result<tiny_skia::Pixmap> {
    use atlas_gis::raster_values::Raster;
    let atlas_map::LayerSource::Raster(source) = &layer.source else {
        return Err(io::Error::other("Land cover needs a raster"));
    };
    let band = |name| {
        source
            .bands
            .iter()
            .zip(&source.band_indices)
            .find(|(b, _)| b.id == name)
    };
    let (classes, value) =
        band("value").ok_or_else(|| io::Error::other("Land cover needs a value band"))?;
    let coverage = band("coverage").map(|(_, index)| *index);
    let colors: BTreeMap<_, _> = classes
        .categories
        .iter()
        .filter_map(|class| {
            Some((
                class.value,
                crate::picture::colour(class.color.as_deref()?)
                    .to_color_u8()
                    .premultiply(),
            ))
        })
        .collect();
    let bytes = server.get(&format!(
        "/api/maps/{}/{}/assets/{}",
        reference.map_id, reference.revision, source.asset_id
    ))?;
    let mut raster = Raster::new(io::Cursor::new(bytes))?;
    let mut image = tiny_skia::Pixmap::new(source.width, source.height)
        .ok_or_else(|| io::Error::other("Empty land cover image"))?;
    for (index, pixel) in image.pixels_mut().iter_mut().enumerate() {
        let at = (
            (index % source.width as usize) as u32,
            (index / source.width as usize) as u32,
        );
        if let Some(band) = coverage {
            if raster.sample(band, at)? <= 0. {
                continue;
            }
        }
        if let Some(color) = colors.get(&(raster.sample(*value, at)? as i32)) {
            *pixel = *color;
        }
    }
    Ok(image)
}
