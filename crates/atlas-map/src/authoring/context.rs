//! What a drawn cave wall cuts, read from the map's published samples of its raster layers
//! (ADR 0016: tools read published GIS, never private generation resources). The rock is the
//! bed at the wall's depth below the ground (beneath the loose cover, beds stacked by their
//! published thickness); its published class says whether water dissolves it. Magic coverage
//! comes from the published coverage bands of the systems that leave marks in rock.
use crate::{Category, LayerSource, MapDescriptor, MapSample, SampleAttribute};
use serde_json::Value;
use std::collections::BTreeMap;

/// The top rock bed's kind, beneath any loose ground.
pub const ROCK_BAND: &str = "RockLayerKind0";
/// Rock beds and loose beds the published column holds, top first.
const ROCK_BEDS: usize = 8;
const LOOSE_BEDS: usize = 4;
/// Fire's veins: heat running through the fracture network leaves mineral seams.
pub const FIRE_VEIN_BAND: &str = "magic:fire:coverage:vein";
/// Aurora's ground: cold held in the rock leaves rime on a cut face.
pub const AURORA_BAND: &str = "magic:aurora:coverage";

/// A cave wall's reading of the ground it cuts.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WallContext {
    /// Rock kinds along the wall, in the order the wall meets them.
    pub rock: Vec<String>,
    /// Special features of the cut face: flowstone, seams, rime.
    pub features: Vec<&'static str>,
}
impl WallContext {
    /// The attributes a cave wall records, replacing what it recorded before.
    pub fn attributes(&self) -> BTreeMap<String, Value> {
        BTreeMap::from([
            ("rock".into(), self.rock.clone().into()),
            ("wallFeatures".into(), self.features.clone().into()),
        ])
    }
}

/// Read the samples found at points along a wall standing `depth` metres below the ground;
/// with no depth known the wall cuts the first rock bed under the loose cover.
pub fn wall_context(map: &MapDescriptor, samples: &[MapSample], depth: Option<f64>) -> WallContext {
    let mut context = WallContext::default();
    let (mut soluble, mut seams, mut rime) = (false, false, false);
    for sample in samples.iter().filter(|sample| sample.active) {
        let read: BTreeMap<&str, &SampleAttribute> = sample
            .attributes
            .iter()
            .map(|attribute| (channel(&attribute.layer_id, &attribute.band_id), attribute))
            .collect();
        let positive = |name: &str| {
            read.get(name)
                .and_then(|a| number(a))
                .is_some_and(|v| v > 0.0)
        };
        seams |= positive(FIRE_VEIN_BAND);
        rime |= positive(AURORA_BAND);
        let bed = format!("RockLayerKind{}", bed_at(&read, depth));
        let Some(attribute) = read.get(bed.as_str()) else {
            continue;
        };
        let class = number(attribute)
            .and_then(|code| category(map, &attribute.layer_id, &attribute.band_id, code));
        let name = attribute
            .category
            .clone()
            .or_else(|| class.map(|c| c.label.clone()));
        soluble |= class.and_then(|c| c.soluble) == Some(true);
        if let Some(name) = name.filter(|name| !context.rock.contains(name)) {
            context.rock.push(name);
        }
    }
    for (present, feature) in [(soluble, "flowstone"), (seams, "seams"), (rime, "rime")] {
        if present {
            context.features.push(feature);
        }
    }
    context
}
fn number(attribute: &SampleAttribute) -> Option<f64> {
    attribute.value.as_ref().and_then(Value::as_f64)
}
/// A thickness in metres: published lengths carry the factor that shows them in metres.
fn metres(attribute: &SampleAttribute) -> Option<f64> {
    let value = number(attribute)?;
    Some(if attribute.display.unit == "m" {
        value * attribute.display.factor
    } else {
        value
    })
}
/// The rock bed a depth below the ground falls in: beds stack under the loose cover by their
/// published thickness; a wall in the loose cover cuts the first bed, one below the column
/// the deepest bed.
fn bed_at(read: &BTreeMap<&str, &SampleAttribute>, depth: Option<f64>) -> usize {
    let Some(depth) = depth else {
        return 0;
    };
    let thickness = |name: String| read.get(name.as_str()).and_then(|a| metres(a));
    let mut top: f64 = (0..LOOSE_BEDS)
        .filter_map(|i| thickness(format!("LooseLayerDepth{i}")))
        .sum();
    let mut deepest = 0;
    for bed in 0..ROCK_BEDS {
        let Some(thick) = thickness(format!("RockLayerDepth{bed}")).filter(|t| *t > 0.0) else {
            break;
        };
        if depth < top + thick {
            return bed;
        }
        top += thick;
        deepest = bed;
    }
    deepest
}
/// The channel a sample attribute publishes: a channel drawn as a raster has its own layer
/// (`raster:<channel>`, band `value`); one kept only for inspection is a band named by it.
fn channel<'a>(layer_id: &'a str, band_id: &'a str) -> &'a str {
    match layer_id.strip_prefix("raster:") {
        Some(channel) if band_id == "value" => channel,
        _ => band_id,
    }
}
/// The published class of a code in the attribute's own layer and band.
fn category<'a>(
    map: &'a MapDescriptor,
    layer_id: &str,
    band_id: &str,
    code: f64,
) -> Option<&'a Category> {
    map.layers
        .iter()
        .filter(|layer| layer.id == layer_id)
        .flat_map(|layer| match &layer.source {
            LayerSource::Raster(raster) => raster.bands.as_slice(),
            LayerSource::Attributes(source) => source.bands.as_slice(),
            LayerSource::Vector(_) => &[],
        })
        .filter(|band| band.id == band_id)
        .flat_map(|band| &band.categories)
        .find(|class| f64::from(class.value) == code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map() -> MapDescriptor {
        let band = |id: &str| {
            json!({"id":id,"name":"Rock","unit":"category","display":{"unit":"","factor":1},
            "nodata":null,"range":null,"categories":[
                {"value":3,"label":"Limestone","color":null,"surface":null,"present":true,"soluble":true},
                {"value":10,"label":"Granite","color":null,"surface":null,"present":true,"soluble":false}]})
        };
        let band = [band(ROCK_BAND), band("RockLayerKind1")];
        serde_json::from_value(json!({
            "reference":{"mapId":"glen","revision":"1"},"worldId":"w","name":"Glen","primarySpaceId":"glen",
            "profile":"local","regionScale":{"level":0,"nextArea":1,"subdivision":7,"minimumWidth":1,"enabled":false},
            "footprint":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,0]]]},"bounds":[0,0,10,10],
            "spaces":[],"parent":null,"state":"complete",
            "layers":[{"id":"inspection","name":"Facts","spaceId":"glen","bounds":[0,0,10,10],"attribution":[],
                "source":{"kind":"attributes","data":{"bands":band}},
                "catalog":{"path":[],"common":false,"featureTypes":[],"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]}}]
        }))
        .unwrap()
    }
    fn sample(values: &[(&str, f64)]) -> MapSample {
        let attributes: Vec<Value> = values
            .iter()
            .map(|(band, value)| {
                json!({"layerId":"inspection","bandId":band,"value":value,"unit":"","label":"",
                "display":{"unit":"","factor":1},"category":null})
            })
            .collect();
        serde_json::from_value(json!({"id":"s","spaceId":"glen",
            "footprint":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,0]]]},
            "window":{"bounds":[0,0,10,10],"closedEast":true,"closedNorth":true},"cellSpan":10,"center":[5,5],
            "measure":100,"active":true,"attributes":attributes,"sections":[]}))
        .unwrap()
    }

    #[test]
    fn a_wall_through_limestone_gains_flowstone_and_names_each_rock_once() {
        let samples = [
            sample(&[(ROCK_BAND, 3.0)]),
            sample(&[(ROCK_BAND, 10.0)]),
            sample(&[(ROCK_BAND, 3.0)]),
        ];
        let context = wall_context(&map(), &samples, None);
        assert_eq!(context.rock, ["Limestone", "Granite"]);
        assert_eq!(context.features, ["flowstone"]);
    }
    #[test]
    fn granite_under_fire_veins_and_aurora_ground_shows_seams_and_rime() {
        let samples = [sample(&[
            (ROCK_BAND, 10.0),
            (FIRE_VEIN_BAND, 0.4),
            (AURORA_BAND, 0.2),
        ])];
        let context = wall_context(&map(), &samples, None);
        assert_eq!(context.rock, ["Granite"]);
        assert_eq!(context.features, ["seams", "rime"]);
        let plain = wall_context(
            &map(),
            &[sample(&[(ROCK_BAND, 10.0), (FIRE_VEIN_BAND, 0.0)])],
            None,
        );
        assert!(plain.features.is_empty());
    }
    /// A channel drawn as a raster publishes its samples under its own layer's `value` band.
    #[test]
    fn rock_drawn_as_a_raster_layer_is_read_by_its_value_band() {
        let mut map = map();
        let mut layer = map.layers[0].clone();
        let LayerSource::Attributes(source) = &layer.source else {
            unreachable!()
        };
        let mut band = source.bands[0].clone();
        band.id = "value".into();
        layer.id = format!("raster:{ROCK_BAND}");
        layer.source = serde_json::from_value(json!({"kind":"raster","data":{"assetId":"a",
            "mediaType":"image/tiff","width":1,"height":1,"cellSpan":1,"bands":[band],
            "overviews":[],"bandIndices":[1]}}))
        .unwrap();
        map.layers = vec![layer];
        let mut cell = sample(&[("value", 3.0)]);
        cell.attributes[0].layer_id = format!("raster:{ROCK_BAND}");
        let context = wall_context(&map, &[cell], None);
        assert_eq!(context.rock, ["Limestone"]);
        assert_eq!(context.features, ["flowstone"]);
    }
    /// Granite over limestone: 4 m of soil, then 10 m of granite, then limestone.
    #[test]
    fn a_wall_cuts_the_bed_at_its_depth_beneath_the_loose_cover() {
        let column = sample(&[
            ("LooseLayerDepth0", 4.0),
            ("RockLayerDepth0", 10.0),
            (ROCK_BAND, 10.0),
            ("RockLayerDepth1", 30.0),
            ("RockLayerKind1", 3.0),
        ]);
        let at = |depth| wall_context(&map(), std::slice::from_ref(&column), depth).rock;
        assert_eq!(at(None), ["Granite"]);
        assert_eq!(at(Some(2.0)), ["Granite"]);
        assert_eq!(at(Some(12.0)), ["Granite"]);
        assert_eq!(at(Some(20.0)), ["Limestone"]);
        assert_eq!(at(Some(500.0)), ["Limestone"]);
    }
}
