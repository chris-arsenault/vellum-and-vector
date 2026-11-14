use atlas_map::{
    InspectionSection, LayerSource, MapDescriptor, MapSample, Position, RasterBand, RegionGeometry,
    SampleAttribute, SampleWindow,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, io};

pub fn encode(value: &impl Serialize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    ciborium::into_writer(value, &mut bytes).map_err(io::Error::other)?;
    Ok(bytes)
}
pub fn decode<T: DeserializeOwned>(bytes: &[u8]) -> io::Result<T> {
    ciborium::from_reader(bytes).map_err(io::Error::other)
}
pub struct Samples<'a> {
    bands: Vec<(&'a str, &'a str, &'a RasterBand)>,
    ordinals: BTreeMap<(&'a str, &'a str), usize>,
}
#[derive(Serialize)]
#[serde(untagged)]
enum Attribute<'a> {
    Value((usize, &'a Option<Value>)),
    Category((usize, &'a Option<Value>, &'a Option<String>)),
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSample<'a> {
    id: &'a str,
    space_id: &'a str,
    window: &'a SampleWindow,
    cell_span: f64,
    center: Position,
    measure: f64,
    active: bool,
    attributes: Vec<Attribute<'a>>,
    sections: &'a [InspectionSection],
}
impl<'a> Samples<'a> {
    pub fn new(map: &'a MapDescriptor) -> Self {
        let mut bands = Vec::new();
        let mut ordinals = BTreeMap::new();
        for layer in &map.layers {
            let items = match &layer.source {
                LayerSource::Raster(source) => &source.bands,
                LayerSource::Attributes(source) => &source.bands,
                _ => continue,
            };
            for band in items {
                ordinals.insert((layer.id.as_str(), band.id.as_str()), bands.len());
                bands.push((layer.id.as_str(), layer.space_id.as_str(), band));
            }
        }
        Self { bands, ordinals }
    }
    pub fn encode(&self, sample: &MapSample) -> io::Result<Vec<u8>> {
        let mut attributes = Vec::with_capacity(sample.attributes.len());
        for value in &sample.attributes {
            let ordinal = *self
                .ordinals
                .get(&(value.layer_id.as_str(), value.band_id.as_str()))
                .ok_or_else(|| io::Error::other("Sample must identify a published band"))?;
            let (_, space, band) = self.bands[ordinal];
            if space != sample.space_id || band.unit != value.unit {
                return Err(io::Error::other("Sample band space or unit differs"));
            }
            let category = category(band, value.value.as_ref());
            attributes.push(if value.category == category {
                Attribute::Value((ordinal, &value.value))
            } else {
                Attribute::Category((ordinal, &value.value, &value.category))
            });
        }
        encode(&StoredSample {
            id: &sample.id,
            space_id: &sample.space_id,
            window: &sample.window,
            cell_span: sample.cell_span,
            center: sample.center,
            measure: sample.measure,
            active: sample.active,
            attributes,
            sections: &sample.sections,
        })
    }
    pub fn decode(&self, bytes: &[u8], footprint: RegionGeometry) -> io::Result<MapSample> {
        let mut record: Value = decode(bytes)?;
        let mut attributes = Vec::new();
        for attribute in record["attributes"]
            .as_array()
            .ok_or_else(|| io::Error::other("Missing stored sample attributes"))?
        {
            let ordinal = attribute[0]
                .as_u64()
                .ok_or_else(|| io::Error::other("Invalid stored band ordinal"))?
                as usize;
            let &(layer, _, band) = self
                .bands
                .get(ordinal)
                .ok_or_else(|| io::Error::other("Stored sample refers to absent band"))?;
            let value = (!attribute[1].is_null()).then(|| attribute[1].clone());
            let label = if attribute.as_array().is_some_and(|a| a.len() > 2) {
                attribute[2].as_str().map(String::from)
            } else {
                category(band, value.as_ref())
            };
            attributes.push(SampleAttribute {
                layer_id: layer.into(),
                band_id: band.id.clone(),
                value,
                unit: band.unit.clone(),
                label: band.name.clone(),
                display: band.display.clone(),
                category: label,
            });
        }
        record["attributes"] = serde_json::to_value(attributes).map_err(io::Error::other)?;
        record["footprint"] = serde_json::to_value(footprint).map_err(io::Error::other)?;
        serde_json::from_value(record).map_err(io::Error::other)
    }
}
fn category(band: &RasterBand, value: Option<&Value>) -> Option<String> {
    let number = value.and_then(Value::as_f64)?;
    band.categories
        .iter()
        .find(|c| f64::from(c.value) == number)
        .map(|c| c.label.clone())
}
