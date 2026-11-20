//! Publish each landmark identity once, with its present measured signature.
use super::State;
use crate::{
    features::{records::Attributes, Feature, FeatureSelection, State as FeatureState},
    field::{
        geographic_contours,
        landmark_ledger::LandmarkRecord,
        landmarks::{
            catalogue::{Kind, Landmark},
            lifecycle::{Operations, Work},
            magic::{Scene, System},
            publication,
        },
        poi::map_records::MapState,
    },
    hpc::BitSet,
    magic::channels::Channel,
    spatial::Predicate,
};
use atlas_map::{Geometry, Position};
use serde_json::{json, Value};
use std::{io, rc::Rc};

fn anchors(state: &State, feature: &Feature) -> io::Result<Vec<Position>> {
    if let Some(representative) = feature.attributes.get("representative") {
        if let Some(x) = representative
            .get("x")
            .and_then(Value::as_f64)
            .filter(|x| x.is_finite())
        {
            return Ok(vec![Position::xy(
                x,
                representative
                    .get("y")
                    .and_then(Value::as_f64)
                    .unwrap_or(f64::NAN),
            )]);
        }
    }
    Ok(match &feature.geometry {
        Geometry::Point { coordinates } => vec![*coordinates],
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. } => {
            let b = state
                .spatial
                .bounds(&feature.geometry)
                .map_err(io::Error::other)?;
            vec![Position::xy((b.0 + b.2) / 2.0, (b.1 + b.3) / 2.0)]
        }
        _ => {
            let mut points = Vec::new();
            line_points(&feature.geometry, &mut points);
            points
        }
    })
}
fn line_points(shape: &Geometry, points: &mut Vec<Position>) {
    match shape {
        Geometry::LineString { coordinates } => points.extend(coordinates),
        Geometry::MultiLineString { coordinates } => points.extend(coordinates.iter().flatten()),
        Geometry::GeometryCollection { geometries } => {
            for shape in geometries {
                line_points(shape, points);
            }
        }
        _ => {}
    }
}
fn round_tenth(value: f64) -> f64 {
    (value * 10.0 + 0.5).floor() / 10.0
}
impl State {
    fn landmark_pairs(&self) -> Vec<(Landmark, LandmarkRecord)> {
        self.field()
            .landmark_ledger()
            .iter()
            .filter_map(|record| {
                self.physical
                    .landmarks
                    .iter()
                    .find(|landmark| landmark.id == record.id)
                    .map(|landmark| (landmark.clone(), record.clone()))
            })
            .collect()
    }
    pub fn drop_claimed_features(&mut self) -> io::Result<()> {
        let mut claims = BitSet::new(self.field().mesh().len());
        let mut any = false;
        for (landmark, record) in self.landmark_pairs() {
            for cell in
                publication::claimed_cells(self.field(), &landmark, &record, self.spatial.as_ref())?
            {
                claims.add(cell);
                any = true;
            }
        }
        if !any {
            return Ok(());
        }
        let records = self
            .records
            .features
            .values(FeatureSelection {
                area_id: Some(self.scope.area),
                layer_id: Some("geology"),
                ..Default::default()
            })?
            .collect::<io::Result<Vec<_>>>()?;
        let [ox, oy] = self.field().mesh().origin();
        for feature in records {
            if feature.state != FeatureState::Generated
                || !["peak", "gorge", "waterfall", "valley"].contains(&feature.kind.as_str())
            {
                continue;
            }
            let points = anchors(self, &feature)?;
            let count = points
                .iter()
                .filter(|point| {
                    let [x, y, _] = point.coordinates();
                    self.field()
                        .mesh()
                        .cell_at(x - ox, y - oy)
                        .is_some_and(|cell| claims.has(cell))
                })
                .count();
            if count * 2 >= points.len() {
                self.records.features.remove(feature.id)?;
            }
        }
        Ok(())
    }
    fn name_landmark(&mut self, landmark: &mut Landmark) -> io::Result<Attributes> {
        if !landmark.name.is_empty() {
            return Ok(Attributes::new());
        }
        let named = if landmark.kind.system().is_some() {
            let bounds = self
                .spatial
                .bounds(&landmark.geometry)
                .map_err(io::Error::other)?;
            let term = match landmark.kind {
                Kind::FireWellspring => "Wellspring",
                Kind::AuroraVault => "Vault",
                Kind::PressureLocus => "Deep",
                Kind::GreenwoodHeart => "Heartwood",
                Kind::SaltPan => "Pan",
                _ => unreachable!(),
            };
            self.naming.magic_landmark(
                &self.scope,
                landmark,
                term,
                [(bounds.0 + bounds.2) / 2.0, (bounds.1 + bounds.3) / 2.0],
            )?
        } else {
            let kind = match landmark.kind {
                Kind::VolcanicMountain => "volcano",
                Kind::ResistantMountain => "peak",
                Kind::Canyon => "gorge",
                Kind::DomeRing => "dome",
                Kind::ImpactRing => "crater",
                Kind::Escarpment => "escarpment",
                Kind::Falls => "waterfall",
                _ => "peak",
            };
            self.naming.geographic(
                &self.scope,
                &landmark.id.to_string(),
                kind,
                &landmark.geometry,
                &Attributes::new(),
            )?
        };
        if let Some(named) = named {
            landmark.name = named.name;
            if let Some(stored) = self
                .physical
                .landmarks
                .iter_mut()
                .find(|l| l.id == landmark.id)
            {
                stored.name.clone_from(&landmark.name);
            }
            Ok(named.metadata)
        } else {
            Ok(Attributes::new())
        }
    }
    fn landmark_feature(
        &mut self,
        landmark: &mut Landmark,
        record: &LandmarkRecord,
    ) -> io::Result<Feature> {
        let naming = self.name_landmark(landmark)?;
        let shape = self
            .spatial
            .buffer(
                &landmark.geometry,
                publication::footprint_reach(landmark, self.field().scale()),
            )
            .map_err(io::Error::other)?;
        let footprint = geographic_contours::clip(self, shape)?;
        let generated = landmark.origin.as_deref() == Some("generated");
        let layer = if landmark.kind.system().is_some() {
            "magic"
        } else {
            "geology"
        };
        let mut attributes: Attributes = serde_json::from_value(json!({
            "sourceAlgorithm": "atlas-landmarks-1", "causeId": format!("landmark:{}", landmark.id), "nameStatus": "proper",
            "landmarkKind": landmark.kind.id(), "origin": if generated { "generated" } else { "authored" },
            "emplacedAtEpoch": record.emplaced_at_epoch, "signature": if record.realized { "realized" } else { "latent" },
            "maintenance": round_tenth(record.maintenance), "notes": record.notes.join(" "), "capture": null, "captureAccumulation": null
        }))?;
        attributes.extend(naming);
        for (key, target) in &record.target {
            attributes.insert(
                key.clone(),
                record
                    .measured
                    .get(key)
                    .filter(|v| v.is_finite())
                    .map_or(Value::Null, |&v| round_tenth(v).into()),
            );
            attributes.insert(format!("{key}Target"), (*target).into());
        }
        if let Some(system) = landmark.kind.system() {
            attributes.insert("system".into(), system.into());
            attributes.insert("sourceStrength".into(), json!(record.strength));
        }
        if let Some(capture) = &record.capture {
            let [ox, oy] = self.field().mesh().origin();
            let [x, y, _] = self
                .chart()
                .position(Position::xy(
                    (capture.x + ox + 0.5).floor(),
                    (capture.y + oy + 0.5).floor(),
                ))
                .coordinates();
            attributes.insert(
                "capture".into(),
                json!({ "x": x, "y": y, "accumulation": capture.accumulation }),
            );
            attributes.insert(
                "captureAccumulation".into(),
                (capture.accumulation + 0.5).floor().into(),
            );
        }
        Ok(Feature {
            id: landmark.id,
            name: landmark.name.clone(),
            kind: "landmark".into(),
            layer_id: layer.into(),
            area_id: self.scope.area,
            geometry: self
                .chart()
                .geometry(&landmark.geometry, self.spatial.as_ref())
                .map_err(io::Error::other)?,
            footprint,
            attributes,
            detail: Default::default(),
            relations: Vec::new(),
            state: FeatureState::Generated,
            protected: false,
            actor: "generator".into(),
            generation_id: None,
            generation_domain: self.scope.generation_domains.get(layer).cloned(),
            causes: vec![format!(
                "{} in epoch {}; its signature was held through every later epoch.",
                if generated {
                    "Sited by the generator and formed"
                } else {
                    "Formed from the authored landmark"
                },
                record.emplaced_at_epoch + 1
            )],
            map_only: None,
            place_id: None,
        })
    }
    pub(super) fn landmark_scene(&self) -> Scene {
        Scene {
            world: self.scope.world,
            area: self.scope.area,
            space: self.scope.space,
            systems: self
                .physical
                .magic
                .as_ref()
                .map(|magic| magic.borrow())
                .iter()
                .flat_map(|m| &m.fields)
                .map(|field| System {
                    id: field.definition().id.clone(),
                    enabled: field.definition().enabled,
                    activity: 1.0,
                    intensity: field.channel(Channel::Intensity),
                })
                .collect(),
        }
    }
    pub fn extract_landmarks(&mut self, operations: &Rc<Operations>) -> io::Result<()> {
        let scene = self.landmark_scene();
        operations.select_queries(&mut self.physical.executor);
        let remeasure = operations.clone().remeasure();
        for (mut landmark, _) in self.landmark_pairs() {
            let geometry = self
                .chart()
                .geometry(&landmark.geometry, self.spatial.as_ref())
                .map_err(io::Error::other)?;
            if !self
                .spatial
                .relation(&geometry, &self.scope.footprint, Predicate::Intersects)
                .map_err(io::Error::other)?
            {
                continue;
            }
            self.physical
                .executor
                .run_with(
                    &remeasure,
                    &Work {
                        landmark: landmark.clone(),
                        epoch: 0,
                        drift: Vec::new(),
                        plumes: Vec::new(),
                        scene: scene.clone(),
                    },
                )
                .map_err(|e| io::Error::other(format!("{e:?}")))?;
            let record = self
                .field()
                .landmark_ledger()
                .iter()
                .find(|r| r.id == landmark.id)
                .cloned()
                .ok_or_else(|| io::Error::other("Published landmark lost its signature record"))?;
            let feature = self.landmark_feature(&mut landmark, &record)?;
            self.write_feature(feature)?;
        }
        Ok(())
    }
}
