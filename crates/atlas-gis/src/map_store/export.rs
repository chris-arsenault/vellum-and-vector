use super::{FeatureQuery, MapAccess};
use atlas_map::{MapFeature, MapRef};
use serde_json::json;
use std::io::{self, Write};
impl dyn MapAccess + '_ {
    pub fn export(
        &self,
        reference: &MapRef,
        format: &str,
        output: &mut impl Write,
    ) -> io::Result<()> {
        if format != "geojson" {
            return Err(io::Error::other("Choose GeoJSON for vector map export"));
        }
        let map = self.open(reference)?;
        output.write_all(b"{\"type\":\"FeatureCollection\",\"name\":")?;
        serde_json::to_writer(&mut *output, &map.name)?;
        output.write_all(b",\"atlas\":")?;
        serde_json::to_writer(&mut *output, &map)?;
        output.write_all(b",\"features\":[")?;
        let mut first = true;
        for space in &map.spaces {
            let mut query = FeatureQuery {
                space_id: space.id,
                ..Default::default()
            };
            loop {
                let page = self.features(reference, &query)?;
                for feature in page.items {
                    if !first {
                        output.write_all(b",")?;
                    }
                    first = false;
                    serde_json::to_writer(&mut *output, &geojson(feature))?;
                }
                query.cursor = page.next;
                if query.cursor.is_none() {
                    break;
                }
            }
        }
        output.write_all(b"]}")
    }
}
fn geojson(feature: MapFeature) -> serde_json::Value {
    let mut properties = serde_json::Map::from_iter(feature.attributes);
    let resolved = json!({"name":feature.name,"layerId":feature.layer_id,"spaceId":feature.space_id,"entityId":feature.entity_id,"kind":feature.kind,"typeId":feature.type_id,"catalog":feature.catalog,"footprint":feature.footprint,"relations":feature.relations,"causes":feature.causes});
    properties.extend(resolved.as_object().unwrap().clone());
    json!({"type":"Feature","id":feature.id,"geometry":feature.geometry,"properties":properties})
}
