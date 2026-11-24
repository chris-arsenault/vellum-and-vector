use super::{Regional, Settings, State};
use crate::{
    execution::ExecutionResult,
    features::Feature,
    field::refinement::initialization,
    scale_settings::ResolvedSettings,
    water::{
        captured::{DrainageNetwork, RiverIdentity},
        import_geometry::Bend,
    },
};
use atlas_map::Geometry;
// hpc-exempt: captured river identities, not per-cell data.
use std::collections::BTreeMap;

pub struct CapturedRegion<'a> {
    pub domains: Vec<String>,
    pub parent_span: f64,
    pub epochs: usize,
    pub rivers: Option<&'a DrainageNetwork>,
}
/// Attribute naming the map a captured record was last bent onto. It is published, so a record
/// a region carried from its world arrives at a child of that region already naming the region.
const CARRIED: &str = "carriedOnto";
/// Bends one captured record onto the map `area`: its geometry, its footprint and the
/// representative point a place is located from. A record already bent onto this map is left
/// as it is; one bent onto another map (its parent's) bends again here. Returns whether it bent.
pub(crate) fn bend_record(feature: &mut Feature, bend: &Bend, area: atlas_map::Id) -> bool {
    let carried = feature.attributes.get(CARRIED).cloned();
    if carried.and_then(|v| serde_json::from_value(v).ok()) == Some(area) {
        return false;
    }
    feature.geometry = bend.geometry(&feature.geometry);
    feature.footprint = feature.footprint.as_ref().map(|f| bend.geometry(f));
    if let Some(stated) = feature.attributes.get_mut("representative") {
        let x = stated.get("x").and_then(serde_json::Value::as_f64);
        let y = stated.get("y").and_then(serde_json::Value::as_f64);
        if let (Some(x), Some(y)) = (x, y) {
            let [x, y] = bend.at([x, y]);
            stated["x"] = x.into();
            stated["y"] = y.into();
        }
    }
    feature
        .attributes
        .insert(CARRIED.into(), serde_json::json!(area));
    true
}
/// The parts of a clipped shape of the same kind as the shape it came from: a polygon keeps
/// its areas and a line its lines, never the slivers where the frame only touches them.
fn same_kind(original: &Geometry, clipped: Geometry) -> Option<Geometry> {
    let area = |g: &Geometry| matches!(g, Geometry::Polygon { .. } | Geometry::MultiPolygon { .. });
    let line = |g: &Geometry| {
        matches!(
            g,
            Geometry::LineString { .. } | Geometry::MultiLineString { .. }
        )
    };
    let point = |g: &Geometry| matches!(g, Geometry::Point { .. } | Geometry::MultiPoint { .. });
    let wanted = |g: &Geometry| {
        (area(original) && area(g)) || (line(original) && line(g)) || (point(original) && point(g))
    };
    match clipped {
        Geometry::GeometryCollection { geometries } => {
            let mut kept: Vec<_> = geometries.into_iter().filter(|g| wanted(g)).collect();
            match kept.len() {
                0 => None,
                1 => kept.pop(),
                _ => Some(Geometry::GeometryCollection { geometries: kept }),
            }
        }
        shape => wanted(&shape).then_some(shape),
    }
}
impl State {
    /// A bent record cut to the map's frame; none when the bend took it outside.
    fn clip_to_frame(&self, geometry: &Geometry) -> std::io::Result<Option<Geometry>> {
        let clipped = self
            .spatial
            .overlay(
                geometry,
                &self.scope.footprint,
                crate::spatial::Overlay::Intersection,
            )
            .map_err(std::io::Error::other)?;
        Ok(clipped.and_then(|shape| same_kind(geometry, shape)))
    }
    /// The parent drew its places, ways, waters and outlines at its own cell span; the child
    /// sees each captured record through the same bend as the rivers it carries
    /// (`water::import_geometry::Bend`), so a town stays on its river and its roads still
    /// meet it. Each record is bent once per map, then cut to the frame as the rivers are: a
    /// record the bend takes wholly outside is no longer on this map.
    fn bend_captured_records(&mut self, span: f64) -> std::io::Result<()> {
        use crate::features::FeatureSelection;
        let bend = Bend::new(span, self.field().mesh());
        let records = self
            .records
            .features
            .values(FeatureSelection {
                area_id: Some(self.scope.area),
                ..Default::default()
            })?
            .collect::<std::io::Result<Vec<_>>>()?;
        let district =
            self.scope.real_scale.is_some() && records.iter().any(|f| f.kind == "district");
        for mut feature in records {
            // The Street map inherits the City's street plan. Bending neighboring blocks
            // or their approach roads can pull them across the selected district boundary.
            if district
                && (crate::processes::town::urban::fixed_geography(&feature.kind)
                    || matches!(feature.kind.as_str(), "road" | "trail"))
            {
                continue;
            }
            if !bend_record(&mut feature, &bend, self.scope.area) {
                continue;
            }
            // A feature contracted across the map's boundary keeps its whole shape.
            if self.scope.contracted.contains(&feature.id) {
                self.records.features.put(feature)?;
                continue;
            }
            let Some(shape) = self.clip_to_frame(&feature.geometry)? else {
                self.records.features.remove(feature.id)?;
                continue;
            };
            feature.geometry = shape;
            if let Some(footprint) = &feature.footprint {
                feature.footprint = self.clip_to_frame(footprint)?;
            }
            self.records.features.put(feature)?;
        }
        Ok(())
    }
    /// Apply captured context before constructing regional physical operation settings.
    pub fn begin_regional(
        &mut self,
        input: CapturedRegion<'_>,
        profile: &ResolvedSettings,
    ) -> ExecutionResult<ResolvedSettings> {
        let regional = Regional::new(self.field(), input.domains, input.parent_span)?;
        self.bend_captured_records(input.parent_span)?;
        let profile = profile
            .regional_profile(input.parent_span, self.field().scale())
            .map_err(std::io::Error::other)?;
        self.physical.settings = Settings::new(&profile, &profile)?;
        // hpc-exempt: names attached to captured published reaches.
        let mut identities = BTreeMap::new();
        for reach in input
            .rivers
            .into_iter()
            .flat_map(|network| &network.reaches)
        {
            for &id in &reach.feature_ids {
                let captured = self
                    .records
                    .source_features
                    .as_ref()
                    .map(|source| source.get(id))
                    .transpose()?
                    .flatten();
                if let Some(feature) = captured.or(self.records.features.get(id)?) {
                    let river = crate::field::refinement::river_lineage::river_id(&feature);
                    identities.insert(id, (river, feature.name));
                }
            }
        }
        let identity = |id: atlas_map::Id| {
            identities.get(&id).map(|(river, name)| RiverIdentity {
                river: Some(river.clone()),
                name: Some(name.clone()),
            })
        };
        self.physical.executor.run_with(
            &initialization::initialize(),
            &initialization::Capture {
                epochs: input.epochs,
                parent_span: input.parent_span,
                rivers: input.rivers,
                spatial: self.spatial.as_ref(),
                identity: &identity,
            },
        )?;
        self.regional = Some(regional);
        self.clear_queries();
        Ok(profile)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        field::{poi::carry::located, refinement::courses::course_cells},
        lattice::{TriangularLattice, WorldLatticeOptions},
        water::import_geometry::{content_cell, network_cell},
    };
    use atlas_map::{Bounds, Position};
    use serde_json::json;
    /// A 5 by 3.75 km real-scale frame, opened inside a parent of 14 km cells.
    const SPAN: f64 = 14_000.0;
    fn lattice() -> TriangularLattice {
        let bounds = Bounds(597_500.0, 128_125.0, 602_500.0, 131_875.0);
        WorldLatticeOptions::default()
            .build(bounds, 20_000.0, 120.0, |_, _| true)
            .unwrap()
    }
    fn place(point: [f64; 2], area: atlas_map::Id) -> Feature {
        let mut attributes = crate::features::records::Attributes::new();
        attributes.insert(
            "representative".into(),
            json!({"x": point[0], "y": point[1]}),
        );
        attributes.insert(CARRIED.into(), json!(area));
        Feature {
            map_only: None,
            place_id: None,
            footprint: None,
            id: atlas_map::Id::from_name("place"),
            name: "Place".into(),
            kind: "settlement".into(),
            layer_id: "settlements".into(),
            area_id: atlas_map::Id::from_name("child"),
            geometry: Geometry::Point {
                coordinates: Position::xy(point[0], point[1]),
            },
            detail: Default::default(),
            attributes,
            relations: Vec::new(),
            state: crate::features::State::Generated,
            protected: false,
            actor: "test".into(),
            generation_id: None,
            causes: Vec::new(),
            generation_domain: None,
        }
    }
    fn point_of(geometry: &Geometry) -> [f64; 2] {
        let Geometry::Point { coordinates } = geometry else {
            panic!("a place stays a point");
        };
        let [x, y, _] = coordinates.coordinates();
        [x, y]
    }
    fn representative(feature: &Feature) -> [f64; 2] {
        let stated = &feature.attributes["representative"];
        [stated["x"].as_f64().unwrap(), stated["y"].as_f64().unwrap()]
    }
    #[test]
    fn a_parent_point_lands_on_one_child_cell_for_river_course_record_and_place() {
        let mesh = lattice();
        let bend = Bend::new(SPAN, &mesh);
        let mut checked = 0;
        for i in 0..9 {
            for j in 0..7 {
                let p = [
                    598_000.0 + 500.0 * f64::from(i),
                    128_600.0 + 450.0 * f64::from(j),
                ];
                let Some(cell) = bend.cell(&mesh, p) else {
                    continue;
                };
                checked += 1;
                // The carried river network bends a parent position, then looks it up.
                assert_eq!(network_cell(&mesh, bend.at(p)), Some(cell));
                // A captured course through the point.
                let course = Geometry::LineString {
                    coordinates: vec![Position::xy(p[0], p[1]), Position::xy(p[0] + 1.0, p[1])],
                };
                assert_eq!(course_cells(&mesh, &course, 2.0, SPAN).first(), Some(&cell));
                // The captured record, carried from the region the child was opened from.
                let source = place(p, atlas_map::Id::from_name("region"));
                let mut working = source.clone();
                assert!(bend_record(
                    &mut working,
                    &bend,
                    atlas_map::Id::from_name("child")
                ));
                assert_eq!(content_cell(&mesh, point_of(&working.geometry)), Some(cell));
                // The carried place is located from the bent record, geometry and representative.
                let carried = located(source, &working);
                assert_eq!(content_cell(&mesh, point_of(&carried.geometry)), Some(cell));
                assert_eq!(content_cell(&mesh, representative(&carried)), Some(cell));
            }
        }
        assert!(checked > 40, "only {checked} points landed on the map");
    }
    #[test]
    fn a_record_is_bent_once_onto_each_map() {
        let mesh = lattice();
        let bend = Bend::new(SPAN, &mesh);
        let p = [599_000.0, 129_000.0];
        let (child, region) = (
            atlas_map::Id::from_name("child"),
            atlas_map::Id::from_name("region"),
        );
        let mut onto_child = place(p, child);
        assert!(!bend_record(&mut onto_child, &bend, child));
        assert_eq!(point_of(&onto_child.geometry), p);
        let mut from_region = place(p, region);
        assert!(bend_record(&mut from_region, &bend, child));
        assert_ne!(point_of(&from_region.geometry), p);
        assert_eq!(representative(&from_region), bend.at(p));
        assert_eq!(from_region.attributes[CARRIED], json!(child));
    }
    #[test]
    fn a_course_that_bends_out_of_the_frame_is_clipped_not_held_at_the_edge() {
        let mesh = lattice();
        // Far beyond the east edge whatever the bend does.
        let outside = Geometry::LineString {
            coordinates: vec![
                Position::xy(606_000.0, 130_000.0),
                Position::xy(607_000.0, 130_000.0),
            ],
        };
        assert!(course_cells(&mesh, &outside, 200.0, SPAN).is_empty());
        assert_eq!(
            Bend::new(SPAN, &mesh).cell(&mesh, [606_000.0, 130_000.0]),
            None
        );
    }
    #[test]
    fn a_clipped_shape_keeps_only_parts_of_its_own_kind() {
        let line = Geometry::LineString {
            coordinates: vec![Position::xy(0.0, 0.0), Position::xy(1.0, 0.0)],
        };
        let touch = Geometry::GeometryCollection {
            geometries: vec![
                line.clone(),
                Geometry::Point {
                    coordinates: Position::xy(2.0, 0.0),
                },
            ],
        };
        assert_eq!(same_kind(&line, touch), Some(line.clone()));
        let area = Geometry::Polygon {
            coordinates: vec![],
        };
        assert_eq!(same_kind(&area, line), None);
    }
}
