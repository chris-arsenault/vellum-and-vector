use super::seats::{Seat, Situation};
use crate::{
    features::{FeatureReader, FeatureSelection, FeatureWorkspace},
    field::Field,
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

impl Field {
    pub fn known_seats(
        &self,
        features: &dyn FeatureReader,
        area: atlas_map::Id,
        parent_span: f64,
    ) -> io::Result<Vec<Seat>> {
        let mut seats = Vec::new();
        for feature in features.values(FeatureSelection {
            area_id: Some(area),
            kind: Some("settlement"),
            ..Default::default()
        })? {
            let feature = feature?;
            let Geometry::Point { coordinates } = feature.geometry else {
                continue;
            };
            let [x, y, _] = coordinates.coordinates();
            let river_side = feature.attributes.get("situation").and_then(|v| v.as_str())
                == Some("river")
                || feature
                    .attributes
                    .get("hostedBy")
                    .and_then(|v| v.get("host"))
                    .and_then(|v| v.as_str())
                    == Some("river");
            if let Some(seat) = self.known_seat(feature.id, [x, y], river_side, parent_span)? {
                seats.push(seat);
            }
        }
        Ok(seats)
    }
    pub fn draw_channels_to_seats(
        &mut self,
        features: &dyn FeatureReader,
        seats: &[Seat],
        receiver: &[i32],
    ) -> io::Result<()> {
        for seat in seats {
            if seat.situation != Situation::River {
                continue;
            }
            let Some(feature) = features.get(seat.feature_id)? else {
                continue;
            };
            let hosted = feature.attributes.get("hostedBy");
            let river = hosted
                .filter(|v| v.get("host").and_then(|v| v.as_str()) == Some("river"))
                .and_then(|v| v.get("hostId"))
                .and_then(|v| v.as_str());
            let identity = river.map(str::to_owned).unwrap_or_else(|| {
                format!("seat-stream:{}", feature.place_id.unwrap_or(feature.id))
            });
            self.retain_seat_stream(seat, river, &identity, receiver)?;
        }
        Ok(())
    }
    pub fn settle_seats(
        &mut self,
        features: &mut dyn FeatureWorkspace,
        seats: &mut [Seat],
        parent_span: f64,
        channel: &[u8],
        basin: &[u8],
    ) -> io::Result<()> {
        for seat in seats {
            let Some(mut feature) = features.get(seat.feature_id)? else {
                continue;
            };
            let Geometry::Point { coordinates } = feature.geometry else {
                continue;
            };
            let [x, y, _] = coordinates.coordinates();
            let previous = seat.cell;
            let result = self.settle_seat(seat, parent_span, channel, basin)?;
            if result.cell != previous {
                let origin = self.mesh.origin();
                let point = self.mesh.position(result.cell);
                feature.geometry = Geometry::Point {
                    coordinates: Position::XYZ([origin[0] + point[0], origin[1] + point[1], 0.0]),
                };
            }
            if feature
                .attributes
                .get("sitedFrom")
                .is_none_or(serde_json::Value::is_null)
            {
                feature.attributes.insert("sitedFrom".into(), json!([x, y]));
            }
            feature
                .attributes
                .insert("support".into(), result.support.as_str().into());
            feature
                .attributes
                .insert("situation".into(), result.situation.as_str().into());
            features.put(feature)?;
        }
        Ok(())
    }
}
