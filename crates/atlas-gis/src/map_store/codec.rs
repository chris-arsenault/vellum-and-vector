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
/// Stored samples name each band by its ordinal among the map's bands. Every sample of a map
/// lists its bands in the same order, so the ordinal at each position is remembered from the
/// sample before and only checked. It owns what it reads from the map, so a publisher can
/// keep one for the whole publication.
pub struct Samples {
    bands: Vec<Band>,
    ordinals: BTreeMap<(String, String), usize>,
    remembered: std::cell::RefCell<Vec<usize>>,
}
struct Band {
    space: atlas_map::Id,
    band: RasterBand,
    /// The band's attribute without a value, its names shared by every sample.
    attribute: SampleAttribute,
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
    space_id: atlas_map::Id,
    window: &'a SampleWindow,
    cell_span: f64,
    center: Position,
    measure: f64,
    active: bool,
    attributes: Vec<Attribute<'a>>,
    sections: &'a [InspectionSection],
}
impl Samples {
    pub fn new(map: &MapDescriptor) -> Self {
        let mut bands = Vec::new();
        let mut ordinals = BTreeMap::new();
        for layer in &map.layers {
            let items = match &layer.source {
                LayerSource::Raster(source) => &source.bands,
                LayerSource::Attributes(source) => &source.bands,
                _ => continue,
            };
            let layer_id: std::sync::Arc<str> = layer.id.as_str().into();
            for band in items {
                ordinals.insert((layer.id.clone(), band.id.clone()), bands.len());
                bands.push(Band {
                    space: layer.space_id,
                    band: band.clone(),
                    attribute: SampleAttribute {
                        layer_id: layer_id.clone(),
                        band_id: band.id.as_str().into(),
                        value: None,
                        unit: band.unit.as_str().into(),
                        label: band.name.as_str().into(),
                        display: band.display.clone(),
                        category: None,
                    },
                });
            }
        }
        Self {
            bands,
            ordinals,
            remembered: Default::default(),
        }
    }
    fn ordinal(&self, position: usize, value: &SampleAttribute) -> io::Result<usize> {
        let mut remembered = self.remembered.borrow_mut();
        let named = |ordinal: usize| {
            let attribute = &self.bands[ordinal].attribute;
            attribute.layer_id == value.layer_id && attribute.band_id == value.band_id
        };
        if let Some(&ordinal) = remembered.get(position).filter(|&&o| named(o)) {
            return Ok(ordinal);
        }
        let ordinal = *self
            .ordinals
            .get(&(value.layer_id.to_string(), value.band_id.to_string()))
            .ok_or_else(|| io::Error::other("Sample must identify a published band"))?;
        if remembered.len() <= position {
            remembered.resize(position + 1, ordinal);
        }
        remembered[position] = ordinal;
        Ok(ordinal)
    }
    pub fn encode(&self, sample: &MapSample) -> io::Result<Vec<u8>> {
        let mut attributes = Vec::with_capacity(sample.attributes.len());
        for (position, value) in sample.attributes.iter().enumerate() {
            let ordinal = self.ordinal(position, value)?;
            let Band { space, band, .. } = &self.bands[ordinal];
            if *space != sample.space_id || *band.unit != *value.unit {
                return Err(io::Error::other("Sample band space or unit differs"));
            }
            let category = category(band, value.value.as_ref());
            attributes.push(if value.category.as_deref() == category {
                Attribute::Value((ordinal, &value.value))
            } else {
                Attribute::Category((ordinal, &value.value, &value.category))
            });
        }
        encode(&StoredSample {
            id: &sample.id,
            space_id: sample.space_id,
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
            let stored = self
                .bands
                .get(ordinal)
                .ok_or_else(|| io::Error::other("Stored sample refers to absent band"))?;
            let value = (!attribute[1].is_null()).then(|| attribute[1].clone());
            let label = if attribute.as_array().is_some_and(|a| a.len() > 2) {
                attribute[2].as_str().map(String::from)
            } else {
                category(&stored.band, value.as_ref()).map(String::from)
            };
            attributes.push(SampleAttribute {
                value,
                category: label,
                ..stored.attribute.clone()
            });
        }
        record["attributes"] = serde_json::to_value(attributes).map_err(io::Error::other)?;
        record["footprint"] = serde_json::to_value(footprint).map_err(io::Error::other)?;
        serde_json::from_value(record).map_err(io::Error::other)
    }
}
fn category<'a>(band: &'a RasterBand, value: Option<&Value>) -> Option<&'a str> {
    let number = value.and_then(Value::as_f64)?;
    band.categories
        .iter()
        .find(|c| f64::from(c.value) == number)
        .map(|c| c.label.as_str())
}
