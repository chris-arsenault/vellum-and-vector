//! Reads a real-scale map's own ground into the ground-detail processes (`processes/ground`) and
//! records what they find: exposed rock and cliffs in the geology layer, and single plants and
//! stones in the objects layer on maps fine enough to show them. Shared readers for the other
//! real-scale adapters live here too.
use super::State;
use crate::{
    features::{
        chart::Chart,
        generated::put,
        line_profile::{pieces, Piece},
        publication::{RegionalPublisher, RegionalRecord},
        records::Attributes,
        Feature, FeatureSelection,
    },
    field::shared::Scalar,
    lattice::hexes::triangle_corners,
    processes::ground::{
        cover::{self, Patch},
        exposure::{self, Ground},
        settings::{COVER_HEX, SCREE_SURFACES, SCRUB_SURFACES},
    },
    rock::{
        catalogue::{kind_of_code, KIND_COUNT},
        ground::GroundField,
    },
    scale::{LengthUnit, MapScale},
    settlement::removal::Facet,
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

pub(super) fn metres(native: f64) -> f64 {
    MapScale::metres(native, LengthUnit::Native)
}
fn ring(points: &[[f64; 2]]) -> Vec<Position> {
    points.iter().map(|&[x, y]| Position::xy(x, y)).collect()
}
pub(super) fn line(points: &[[f64; 2]]) -> Geometry {
    Geometry::LineString {
        coordinates: ring(points),
    }
}
impl State {
    /// A record of the map's own ground detail, labelled by kind rather than named.
    pub(super) fn ground_record(
        &self,
        key: String,
        (layer, kind, label): (&str, &str, &str),
        geometry: Geometry,
        mut attributes: Attributes,
    ) -> io::Result<Feature> {
        attributes.insert("nameStatus".into(), "label".into());
        RegionalPublisher {
            world: &self.scope.world,
            area: &self.scope.area,
            space: Some(&self.scope.space),
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
            named: None,
        })
    }
    pub(super) fn put_ground(&mut self, feature: Feature) -> io::Result<()> {
        let contracted = self.scope.contracted.contains(&feature.id);
        put(self.records.features.as_mut(), feature, contracted).map(|_| ())
    }
    /// The map's own features in one layer.
    pub(super) fn layer_features(&self, layer: &str) -> io::Result<Vec<Feature>> {
        self.records
            .features
            .values(FeatureSelection {
                area_id: Some(&self.scope.area),
                layer_id: Some(layer),
                kind: None,
            })?
            .collect()
    }
    /// The map's ways as drawn: every line in the roads layer except shipping lanes.
    pub(super) fn way_lines(&self) -> io::Result<Vec<(Feature, Vec<Piece>)>> {
        Ok(self
            .layer_features("roads")?
            .into_iter()
            .filter(|f| f.kind != "lane")
            .map(|f| {
                let parts = pieces(&f.geometry);
                (f, parts)
            })
            .filter(|(_, parts)| parts.iter().any(|p| p.points.len() >= 2))
            .collect())
    }
    /// The lattice triangle under a point in the map's coordinates.
    pub(super) fn cell_under(&self, [x, y]: [f64; 2]) -> Option<usize> {
        let mesh = self.field().mesh();
        let [ox, oy] = mesh.origin();
        mesh.cell_at(x - ox, y - oy)
    }
    /// Dry, ice-free land inside the map.
    pub(super) fn dry_land(&self, cell: usize) -> io::Result<bool> {
        let field = self.field();
        Ok(field.water().column.kind.get(cell)? == 0
            && field.shared().scalar(Scalar::IceThickness).get(cell)? <= 0.0)
    }
    fn exposure_cell(&self, cell: usize) -> io::Result<Ground> {
        let field = self.field();
        let mesh = field.mesh();
        let land = self.dry_land(cell)?;
        let cover = if land {
            let section = field.ground().section(cell, Facet::Land)?;
            section
                .iter()
                .filter(|layer| layer.loose)
                .map(|layer| metres(layer.top - layer.bottom))
                .sum()
        } else {
            0.0
        };
        let [x, y] = mesh.position(cell);
        let [ox, oy] = mesh.origin();
        Ok(Ground {
            position: [x + ox, y + oy],
            area: mesh.area(cell),
            neighbours: [0, 1, 2].map(|edge| mesh.neighbor(cell, edge)),
            land,
            cover,
            slope: field.shared().scalar(Scalar::Slope).get(cell)?,
            elevation: metres(field.ground().view(GroundField::Elevation).get(cell)?),
        })
    }
    pub(super) fn exposure_cells(&self) -> io::Result<Vec<Ground>> {
        (0..self.field().mesh().len())
            .map(|cell| self.exposure_cell(cell))
            .collect()
    }
    /// The rock most of an outcrop shows: the commonest top rock bed among its triangles.
    fn outcrop_rock(&self, cells: &[usize]) -> io::Result<&'static str> {
        let mut counts = [0usize; KIND_COUNT];
        for &cell in cells {
            let section = self.field().ground().section(cell, Facet::Land)?;
            if let Some(rock) = section.iter().find(|layer| !layer.loose) {
                if let Some(count) = counts.get_mut(rock.material.kind) {
                    *count += 1;
                }
            }
        }
        let commonest = (0..KIND_COUNT).max_by_key(|&k| counts[k]).unwrap_or(0);
        Ok(kind_of_code(commonest).name)
    }
    fn outcrop(&self, at: usize, cells: &[usize]) -> io::Result<Option<Feature>> {
        let mesh = self.field().mesh();
        let triangles: Vec<Geometry> = cells
            .iter()
            .map(|&cell| {
                let mut corners = ring(&triangle_corners(mesh, cell));
                corners.push(corners[0]);
                Geometry::Polygon {
                    coordinates: vec![corners],
                }
            })
            .collect();
        let Some(shape) = self
            .spatial
            .union_all(&triangles)
            .map_err(io::Error::other)?
        else {
            return Ok(None);
        };
        let area: f64 = cells.iter().map(|&cell| mesh.area(cell)).sum();
        let mut attributes = Attributes::new();
        attributes.insert("rock".into(), self.outcrop_rock(cells)?.into());
        attributes.insert("area".into(), json!(area.round()));
        let [x, y] = mesh.position(cells[0]);
        self.ground_record(
            format!("outcrop:{at}:{x:.0}:{y:.0}"),
            ("geology", "outcrop", "Outcrop"),
            shape,
            attributes,
        )
        .map(Some)
    }
    /// Exposed rock and cliffs on this real-scale map.
    pub fn publish_exposed_rock(&mut self) -> io::Result<()> {
        let cells = self.exposure_cells()?;
        let mut features = Vec::new();
        for (at, group) in exposure::outcrops(&cells).iter().enumerate() {
            features.extend(self.outcrop(at, group)?);
        }
        for (at, cliff) in exposure::cliffs(&cells).iter().enumerate() {
            let mut attributes = Attributes::new();
            attributes.insert("height".into(), json!(cliff.height.round()));
            attributes.insert("length".into(), json!(cliff.length.round()));
            let [x, y] = cliff.line[0];
            features.push(self.ground_record(
                format!("cliff:{at}:{x:.0}:{y:.0}"),
                ("geology", "cliff", "Cliff"),
                line(&cliff.line),
                attributes,
            )?);
        }
        for feature in features {
            self.put_ground(feature)?;
        }
        Ok(())
    }
    fn surface_is(
        &self,
        cell: usize,
        surfaces: &[crate::magic::surface::Surface],
    ) -> io::Result<bool> {
        let Some(magic) = &self.physical.magic else {
            return Ok(false);
        };
        let code = magic.borrow().surfaces.final_surface.get(cell)?;
        Ok(surfaces.iter().any(|&s| s as i32 == code))
    }
    /// A triangle's share of each cover that holds single objects, in `Cover::ALL` order.
    fn cover_shares(&self, cell: usize, ground: &Ground) -> io::Result<[f64; 4]> {
        let shared = self.field().shared();
        let trees = shared.scalar(Scalar::TreeCover).get(cell)?;
        let wet = shared.scalar(Scalar::WetlandCover).get(cell)?;
        let scrub = if self.surface_is(cell, &SCRUB_SURFACES)? {
            (1.0 - trees - wet).max(0.0)
        } else {
            0.0
        };
        let stone = if exposure::exposed(ground) || self.surface_is(cell, &SCREE_SURFACES)? {
            1.0
        } else {
            0.0
        };
        Ok([trees, scrub, stone, wet])
    }
    /// Ground no plant or stone stands on: ways, buildings and water as drawn.
    fn occupied(&self) -> io::Result<Option<Geometry>> {
        let spatial = self.spatial.as_ref();
        let mut shapes = Vec::new();
        for layer in ["roads", "rivers", "lakes", "structures"] {
            for feature in self.layer_features(layer)? {
                let widened = atlas_map::hexes::widened_footprint(
                    &feature.geometry,
                    feature.attributes.get("widths"),
                    spatial,
                )
                .map_err(io::Error::other)?;
                match (widened, &feature.geometry) {
                    (Some(shape), _) => shapes.push(shape),
                    (None, g @ (Geometry::Polygon { .. } | Geometry::MultiPolygon { .. })) => {
                        shapes.push(g.clone());
                    }
                    _ => {}
                }
            }
        }
        spatial.union_all(&shapes).map_err(io::Error::other)
    }
    /// Single trees, shrubs, boulders and reeds on a map whose hexes are small enough to show
    /// them; coarser maps show cover by its share.
    pub fn scatter_cover(&mut self) -> io::Result<()> {
        if !self
            .scope
            .real_scale
            .is_some_and(|real| real.hex_size.across_flats() <= COVER_HEX)
        {
            return Ok(());
        }
        let cells = self.exposure_cells()?;
        let mesh = self.field().mesh();
        let mut patches = Vec::new();
        for (cell, ground) in cells.iter().enumerate() {
            if ground.land {
                patches.push(Patch {
                    cell,
                    corners: triangle_corners(mesh, cell),
                    shares: self.cover_shares(cell, ground)?,
                });
            }
        }
        // Each map scatters from its own identity, so a map keeps its trees when published again.
        let seed = self
            .scope
            .area
            .bytes()
            .fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| {
                (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
            });
        let objects = cover::scatter(&patches, seed)?;
        let points: Vec<Position> = objects
            .iter()
            .map(|o| Position::xy(o.position[0], o.position[1]))
            .collect();
        let taken = match self.occupied()? {
            Some(mask) => self
                .spatial
                .covers_points(&mask, &points)
                .map_err(io::Error::other)?,
            None => vec![false; points.len()],
        };
        let mut features = Vec::new();
        for (object, taken) in objects.iter().zip(taken) {
            if taken {
                continue;
            }
            features.push(self.object_record(object)?);
        }
        for feature in features {
            self.put_ground(feature)?;
        }
        Ok(())
    }
    fn object_record(&self, object: &cover::Object) -> io::Result<Feature> {
        let kind = object.cover.kind();
        let [x, y] = object.position;
        let mut attributes = Attributes::new();
        attributes.insert(
            "trueSize".into(),
            json!({"width": object.across, "length": object.across}),
        );
        self.ground_record(
            format!("object:{}:{x:.1}:{y:.1}", kind.kind),
            ("objects", kind.kind, kind.label),
            Geometry::Point {
                coordinates: Position::xy(x, y),
            },
            attributes,
        )
    }
}
