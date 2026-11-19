//! Reads a real-scale map's own ground into the cave process and records the caves it finds:
//! the underground layer (`caves`) and the entrances on the ground (`caveEntrances`).
use super::State;
use crate::{
    features::{
        chart::Chart,
        generated::put,
        publication::{RegionalPublisher, RegionalRecord},
        records::Attributes,
        Feature, Relation,
    },
    field::{poi::reads::magic_rule, shared::Scalar, Field},
    processes::caves::{
        self, settings::MOUTH_DEPTH, shape::level, Bed, Cave, Cell, Entrance, Passage, Signs,
    },
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
    settlement::removal::Facet,
    water::WaterView,
};
use atlas_map::{Geometry, Position};
use serde_json::{json, Value};
use std::io;

fn metres(native: f64) -> f64 {
    MapScale::metres(native, LengthUnit::Native)
}
fn target(value: i32) -> Option<usize> {
    usize::try_from(value).ok()
}
impl State {
    fn cave_beds(&self, cell: usize) -> io::Result<Vec<Bed>> {
        let section = self.field().ground().section(cell, Facet::Land)?;
        let Some(surface) = section.first().map(|layer| layer.top) else {
            return Ok(Vec::new());
        };
        Ok(section
            .iter()
            .map(|layer| Bed {
                kind: layer.material.kind,
                top: metres(surface - layer.top),
                thickness: metres(layer.top - layer.bottom),
                strength: layer.material.strength,
                loose: layer.loose,
            })
            .collect())
    }
    fn cave_signs(&self, field: &Field, cell: usize) -> io::Result<Signs> {
        let shared = field.shared();
        Ok(Signs {
            fracture: shared.scalar(Scalar::FractureConductance).get(cell)? / 1000.0,
            volcanic: shared
                .scalar(Scalar::VolcanicConstructionHistory)
                .get(cell)?
                > 0.0,
            fire_vein: magic_rule(self, "fire", "vein", cell)?,
            fire_basalt: magic_rule(self, "fire", "basalt", cell)?,
            greenwood_sinkhole: magic_rule(self, "greenwood", "sinkhole", cell)?,
        })
    }
    fn cave_cell(&self, water: &WaterView, cell: usize) -> io::Result<Cell> {
        let field = self.field();
        let mesh = field.mesh();
        let recharge_known = water.groundwater.interval > 0.0;
        let [x, y] = mesh.position(cell);
        let [ox, oy] = mesh.origin();
        // Lattice cells carry their own water column; the surface mask is indexed by raster sample.
        // The lattice addresses only the map's own triangles, so caves stay inside the frame.
        let land = water.column.kind.get(cell)? == 0;
        let host = if land {
            caves::host::host(&self.cave_beds(cell)?, &self.cave_signs(field, cell)?)
        } else {
            None
        };
        let shared = field.shared();
        Ok(Cell {
            position: [x + ox, y + oy],
            area: mesh.area(cell),
            neighbours: [0, 1, 2].map(|edge| mesh.neighbor(cell, edge)),
            host,
            groundwater: target(water.groundwater.targets.get(cell)?),
            downhill: target(water.routing.targets.get(cell)?),
            ground: metres(field.ground().view(GroundField::Elevation).get(cell)?),
            recharges: land && (!recharge_known || water.groundwater.recharge.get(cell)? > 0.0),
            fracture: shared.scalar(Scalar::FractureConductance).get(cell)? / 1000.0,
            opens: land && shared.scalar(Scalar::IceThickness).get(cell)? <= 0.0,
        })
    }
    /// The map's frame `[west, south, east, north]`: its own triangles' extent.
    fn cave_frame(&self) -> [f64; 4] {
        let mesh = self.field().mesh();
        let atlas_map::Bounds(w, s, e, n) = mesh.bounds();
        let [ox, oy] = mesh.origin();
        [w + ox, s + oy, e + ox, n + oy]
    }
    /// Finds the caves beneath this real-scale map and records them with their entrances.
    pub fn publish_caves(&mut self) -> io::Result<()> {
        let field = self.field();
        let water = field.water();
        let cells = (0..field.mesh().len())
            .map(|cell| self.cave_cell(&water, cell))
            .collect::<io::Result<Vec<_>>>()?;
        for cave in caves::plan(&cells) {
            for feature in self.cave_features(&cave)? {
                let contracted = self.scope.contracted.contains(&feature.id);
                put(self.records.features.as_mut(), feature, contracted)?;
            }
        }
        Ok(())
    }
    fn cave_record(
        &self,
        key: String,
        (layer, kind, label): (&str, &str, &str),
        geometry: Geometry,
        attributes: Attributes,
    ) -> io::Result<Feature> {
        let named = if kind == "cave" {
            self.naming
                .geographic(&self.scope, &key, kind, &geometry, &attributes)?
        } else {
            None
        };
        RegionalPublisher {
            world: self.scope.world,
            area: self.scope.area,
            space: Some(self.scope.space),
            chart: Chart {
                domain: &self.scope.domain,
                bounds: self.scope.domain_bounds,
                cylindrical: self.scope.cylindrical,
            },
            spatial: self.spatial.as_ref(),
        }
        .feature(RegionalRecord {
            key,
            kind: kind.into(),
            layer_id: layer.into(),
            generation_domain: self.scope.generation_domains.get(layer).cloned(),
            geometry,
            attributes,
            label: label.into(),
            named,
        })
    }
    fn cave_features(&self, cave: &Cave) -> io::Result<Vec<Feature>> {
        let start = cave.passages[0].vertices[0].position;
        let key = format!("cave:{}:{:.0}:{:.0}", cave.form.id(), start[0], start[1]);
        let mut passages = cave
            .passages
            .iter()
            .enumerate()
            .map(|(at, passage)| self.passage_feature(&key, at, passage))
            .collect::<io::Result<Vec<_>>>()?;
        let mut parts = Vec::new();
        let frame = self.cave_frame();
        for (at, chamber) in cave.chambers.iter().enumerate() {
            let outline = caves::shape::clip_ring(&chamber.outline, frame);
            if outline.is_empty() {
                continue;
            }
            let ring = outline.iter().map(|&[x, y]| Position::xy(x, y));
            let mut attributes = part(chamber.depth, cave);
            attributes.insert("nameStatus".into(), "label".into());
            let mut feature = self.cave_record(
                format!("{key}:chamber:{at}"),
                ("caves", "chamber", "Chamber"),
                Geometry::Polygon {
                    coordinates: vec![ring.collect()],
                },
                attributes,
            )?;
            relate(&mut feature, passages[chamber.passage].id, "opensFrom");
            parts.push(feature);
        }
        for (at, entrance) in cave.entrances.iter().enumerate() {
            let (opening, shaft) = self.entrance_features(&key, at, entrance, cave)?;
            let passage = &mut passages[entrance.passage];
            relate(passage, opening.id, "entrance");
            parts.push(opening);
            parts.extend(shaft);
        }
        let whole = self.whole_cave(&key, cave, &passages)?;
        for feature in passages.iter_mut().chain(parts.iter_mut()) {
            relate(feature, whole.id, "partOf");
        }
        Ok(std::iter::once(whole)
            .chain(passages)
            .chain(parts)
            .collect())
    }
    fn passage_feature(&self, key: &str, at: usize, passage: &Passage) -> io::Result<Feature> {
        let depths: Vec<f64> = passage.vertices.iter().map(|v| v.depth).collect();
        let mean = depths.iter().sum::<f64>() / depths.len().max(1) as f64;
        let mut attributes = Attributes::new();
        attributes.insert("nameStatus".into(), "label".into());
        attributes.insert("form".into(), passage.form.id().into());
        attributes.insert("magic".into(), passage.magic.map(|m| m.id()).into());
        attributes.insert(
            "widths".into(),
            json!(passage.vertices.iter().map(|v| v.width).collect::<Vec<_>>()),
        );
        attributes.insert("depths".into(), json!(depths));
        attributes.insert("level".into(), level(mean).into());
        self.cave_record(
            format!("{key}:passage:{at}"),
            (
                "caves",
                passage.form.passage_kind(),
                passage.form.passage_label(),
            ),
            Geometry::LineString {
                coordinates: line(passage),
            },
            attributes,
        )
    }
    /// The opening on the ground and, where the passage lies deeper than a mouth, the shaft
    /// that drops from it in the underground space.
    fn entrance_features(
        &self,
        key: &str,
        at: usize,
        entrance: &Entrance,
        cave: &Cave,
    ) -> io::Result<(Feature, Option<Feature>)> {
        let point = Geometry::Point {
            coordinates: Position::xy(entrance.position[0], entrance.position[1]),
        };
        let mut attributes = part(entrance.depth, cave);
        attributes.insert("nameStatus".into(), "label".into());
        let opening = entrance.opening;
        let mut feature = self.cave_record(
            format!("{key}:entrance:{at}"),
            ("caveEntrances", opening.kind(), opening.label()),
            point.clone(),
            attributes.clone(),
        )?;
        feature
            .attributes
            .insert("walkingDestination".into(), true.into());
        if entrance.depth <= MOUTH_DEPTH {
            return Ok((feature, None));
        }
        let mut shaft = self.cave_record(
            format!("{key}:shaft:{at}"),
            ("caves", "shaft", "Shaft"),
            point,
            attributes,
        )?;
        relate(&mut shaft, feature.id, "opensAt");
        relate(&mut feature, shaft.id, "shaft");
        Ok((feature, Some(shaft)))
    }
    fn whole_cave(&self, key: &str, cave: &Cave, passages: &[Feature]) -> io::Result<Feature> {
        let lines: Vec<Vec<Position>> = cave.passages.iter().map(line).collect();
        let vertices = || cave.passages.iter().flat_map(|p| &p.vertices);
        let deepest = vertices().map(|v| v.depth).fold(0.0f64, f64::max);
        let length: f64 = cave
            .passages
            .iter()
            .map(|p| {
                let points: Vec<_> = p.vertices.iter().map(|v| v.position).collect();
                caves::shape::length(&points)
            })
            .sum();
        let mut attributes = Attributes::new();
        for (name, value) in [
            ("form", json!(cave.form.id())),
            ("magic", json!(cave.magic.map(|m| m.id()))),
            ("length", json!(length.round())),
            ("deepest", json!(deepest.round())),
            ("levels", json!(level(deepest))),
            ("passages", json!(passages.len())),
            ("entrances", json!(cave.entrances.len())),
            (
                "nameTerm",
                json!({"kind":"landform", "subkind":"cave", "term":cave.form.term()}),
            ),
        ] {
            attributes.insert(name.into(), value);
        }
        self.cave_record(
            key.into(),
            ("caves", "cave", cave.form.term()),
            Geometry::MultiLineString { coordinates: lines },
            attributes,
        )
    }
}
fn line(passage: &Passage) -> Vec<Position> {
    passage
        .vertices
        .iter()
        .map(|v| Position::xy(v.position[0], v.position[1]))
        .collect()
}
fn part(depth: f64, cave: &Cave) -> Attributes {
    let mut attributes = Attributes::new();
    attributes.insert("form".into(), cave.form.id().into());
    attributes.insert("magic".into(), cave.magic.map(|m| m.id()).into());
    attributes.insert("depth".into(), Value::from(depth.round()));
    attributes.insert("level".into(), level(depth).into());
    attributes
}
fn relate(feature: &mut Feature, target: atlas_map::Id, kind: &str) {
    feature.relations.push(Relation {
        target_id: target,
        kind: kind.into(),
    });
}
