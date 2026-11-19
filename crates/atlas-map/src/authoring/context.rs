//! What a drawn cave wall cuts, read from the map's published raster bands at points along
//! it (ADR 0016: tools read published GIS, never private generation resources). The rock is
//! the bed at the wall's depth below the ground (beneath the loose cover, beds stacked by
//! their published thickness); its published class says whether water dissolves it. Magic
//! coverage comes from the published coverage bands of the systems that leave marks in rock.
use crate::{BandValue, Category, LayerSource, MapDescriptor};
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

/// Read the band values found at points along a wall standing `depth` metres below the
/// ground; with no depth known the wall cuts the first rock bed under the loose cover.
pub fn wall_context(
    map: &MapDescriptor,
    readings: &[Vec<BandValue>],
    depth: Option<f64>,
) -> WallContext {
    let mut context = WallContext::default();
    let (mut soluble, mut seams, mut rime) = (false, false, false);
    for reading in readings {
        let read: BTreeMap<&str, &BandValue> = reading
            .iter()
            .filter_map(|value| Some((channel(&value.layer_id, &value.band_id)?, value)))
            .collect();
        let positive = |name: &str| read.get(name).is_some_and(|v| v.value > 0.0);
        seams |= positive(FIRE_VEIN_BAND);
        rime |= positive(AURORA_BAND);
        let bed = format!("RockLayerKind{}", bed_at(&read, depth));
        let Some(value) = read.get(bed.as_str()) else {
            continue;
        };
        let class = category(map, &value.layer_id, &value.band_id, value.value);
        let name = value
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
/// A thickness in metres: published lengths carry the factor that shows them in metres.
fn metres(value: &BandValue) -> f64 {
    if value.display.unit.as_ref() == "m" {
        value.value * value.display.factor
    } else {
        value.value
    }
}
/// The rock bed a depth below the ground falls in: beds stack under the loose cover by their
/// published thickness; a wall in the loose cover cuts the first bed, one below the column
/// the deepest bed.
fn bed_at(read: &BTreeMap<&str, &BandValue>, depth: Option<f64>) -> usize {
    let Some(depth) = depth else {
        return 0;
    };
    let thickness = |name: String| read.get(name.as_str()).map(|v| metres(v));
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
/// The channel a band value publishes: every channel has its own layer
/// (`raster:<channel>`), whose `value` band holds it.
fn channel<'a>(layer_id: &'a str, band_id: &str) -> Option<&'a str> {
    layer_id
        .strip_prefix("raster:")
        .filter(|_| band_id == "value")
}
/// The published class of a code in the value's own layer and band.
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
            LayerSource::Raster(raster) | LayerSource::Attributes(raster) => {
                raster.bands.as_slice()
            }
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

    fn glen() -> crate::Id {
        crate::Id::from_name("glen")
    }
    fn rock_layer(channel: &str) -> Value {
        json!({"id":format!("raster:{channel}"),"name":"Rock","spaceId":glen(),"bounds":[0,0,10,10],
            "attribution":[],
            "source":{"kind":"attributes","data":{"assetId":"a","mediaType":"image/tiff","width":1,
                "height":1,"cellSpan":10,"overviews":[],"bandIndices":[1],"bands":[{"id":"value",
                "name":"Rock","unit":"category","display":{"unit":"","factor":1},"nodata":null,
                "range":null,"categories":[
                {"value":3,"label":"Limestone","color":null,"surface":null,"present":true,"soluble":true},
                {"value":10,"label":"Granite","color":null,"surface":null,"present":true,"soluble":false}]}]}},
            "catalog":{"path":[],"common":false,"featureTypes":[],"defaultStyle":null,"presets":[],
                "properties":{},"examples":[],"geometries":[]}})
    }
    fn map() -> MapDescriptor {
        let (glen, revision, world) =
            (glen(), crate::Id::from_name("1"), crate::Id::from_name("w"));
        serde_json::from_value(json!({
            "reference":{"mapId":glen,"revision":revision},"worldId":world,"name":"Glen","primarySpaceId":glen,
            "profile":"local","regionScale":{"level":0,"nextArea":1,"subdivision":7,"minimumWidth":1,"enabled":false},
            "footprint":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,0]]]},"bounds":[0,0,10,10],
            "spaces":[],"parent":null,"state":"complete",
            "layers":[rock_layer(ROCK_BAND), rock_layer("RockLayerKind1")]
        }))
        .unwrap()
    }
    /// The values a reader finds at one point, each channel's `value` band.
    fn reading(values: &[(&str, f64)]) -> Vec<BandValue> {
        values
            .iter()
            .map(|(channel, value)| BandValue {
                layer_id: format!("raster:{channel}"),
                band_id: "value".into(),
                value: *value,
                unit: String::new(),
                label: String::new(),
                display: crate::DisplayUnit {
                    unit: "".into(),
                    factor: 1.0,
                },
                category: None,
            })
            .collect()
    }
    #[test]
    fn a_wall_through_limestone_gains_flowstone_and_names_each_rock_once() {
        let readings = [
            reading(&[(ROCK_BAND, 3.0)]),
            reading(&[(ROCK_BAND, 10.0)]),
            reading(&[(ROCK_BAND, 3.0)]),
        ];
        let context = wall_context(&map(), &readings, None);
        assert_eq!(context.rock, ["Limestone", "Granite"]);
        assert_eq!(context.features, ["flowstone"]);
    }
    #[test]
    fn granite_under_fire_veins_and_aurora_ground_shows_seams_and_rime() {
        let readings = [reading(&[
            (ROCK_BAND, 10.0),
            (FIRE_VEIN_BAND, 0.4),
            (AURORA_BAND, 0.2),
        ])];
        let context = wall_context(&map(), &readings, None);
        assert_eq!(context.rock, ["Granite"]);
        assert_eq!(context.features, ["seams", "rime"]);
        let plain = wall_context(
            &map(),
            &[reading(&[(ROCK_BAND, 10.0), (FIRE_VEIN_BAND, 0.0)])],
            None,
        );
        assert!(plain.features.is_empty());
    }
    /// Granite over limestone: 4 m of soil, then 10 m of granite, then limestone.
    #[test]
    fn a_wall_cuts_the_bed_at_its_depth_beneath_the_loose_cover() {
        let column = reading(&[
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
