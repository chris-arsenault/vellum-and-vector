use super::{LakeSurface, State};
use crate::{
    features::{generated, Feature},
    field::{
        geographic_contours as contours,
        geographic_regions::{self, Components},
        poi::{
            kinds::Kind,
            map_records::{self, MapState, PlaceRecord, Record},
            peak_ranges,
            publication::places_of,
        },
        significance::measure,
    },
    hpc::BitSet,
    identity::semantic_id,
    lattice::Membership,
    scale::{LengthUnit, MapScale},
    spatial::Overlay,
    water::{routing::LakeMembership, visibility::unwrap},
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

impl State {
    pub fn write_feature(&mut self, feature: Feature) -> io::Result<bool> {
        let contracted = self.scope.contracted.contains(&feature.id);
        generated::put(self.records.features.as_mut(), feature, contracted)
    }
    pub fn extract_lakes(&mut self) -> io::Result<()> {
        let water = self.field().water();
        let membership = LakeMembership::read(&water.column.kind, &water.column.body)?;
        self.physical.lakes.clear();
        self.physical.lake_outlines.clear();
        for members in membership.bodies() {
            if !members
                .iter()
                .any(|&cell| self.field().mesh().membership(cell) == Membership::Content)
            {
                continue;
            }
            let level = water.column.surface.get(members[0])?;
            let body = water.column.body.get(members[0])?;
            let contour = contours::lake_footprint(self, members, body, level)?;
            let Some(shape) = contours::clip(self, contour)? else {
                continue;
            };
            let b = self.spatial.bounds(&shape).map_err(io::Error::other)?;
            let key = format!("lake:{:.3}:{:.3}:{:.3}:{:.3}", b.0, b.1, b.2, b.3);
            self.physical.lakes.push(LakeSurface {
                id: semantic_id(
                    &self.scope.world,
                    &format!("generated:{}", self.scope.area),
                    &key,
                )?,
                geometry: shape.clone(),
                level: MapScale::metres(level, LengthUnit::Native),
            });
            self.physical.lake_outlines.insert(body, shape);
        }
        Ok(())
    }
    pub fn extract_faults(&mut self) -> io::Result<()> {
        let faults = self.field().faults().to_vec();
        let [ox, oy] = self.field().mesh().origin();
        let minimum = measure(&self.field().scale(), 0.0375, 1, 1.0)?;
        for fault in faults {
            if fault.coordinates.len() < 2 || fault.id.starts_with("landmark:") {
                continue;
            }
            let mut coordinates = fault
                .coordinates
                .iter()
                .map(|p| Position::xy(p[0] + ox, p[1] + oy))
                .collect::<Vec<_>>();
            unwrap(&mut coordinates, self.field().mesh().periodic_width());
            // Judge the physical trace before canonical precision can collapse a short fault.
            let length: f64 = coordinates
                .windows(2)
                .map(|pair| {
                    let [x, y, _] = pair[0].coordinates();
                    let [u, v, _] = pair[1].coordinates();
                    (u - x).hypot(v - y)
                })
                .sum();
            if length < minimum {
                continue;
            }
            let line = Geometry::LineString { coordinates };
            let canonical = self
                .chart()
                .geometry(&line, self.spatial.as_ref())
                .map_err(io::Error::other)?;
            let clipped = if matches!(
                canonical,
                Geometry::LineString { .. } | Geometry::MultiLineString { .. }
            ) {
                self.spatial.clip_trace(&canonical, &self.scope.footprint)
            } else {
                self.spatial
                    .overlay(&canonical, &self.scope.footprint, Overlay::Intersection)
            }
            .map_err(io::Error::other)?;
            let mut lines = Vec::new();
            if let Some(shape) = clipped {
                line_parts(shape, &mut lines);
            }
            if lines.is_empty() {
                continue;
            }
            let geometry = if lines.len() == 1 {
                Geometry::LineString {
                    coordinates: lines.remove(0),
                }
            } else {
                Geometry::MultiLineString { coordinates: lines }
            };
            let feature = map_records::generated(
                self,
                Record {
                    key: &fault.id,
                    name: &format!("Fault {}", fault.id.rsplit(':').next().unwrap_or_default()),
                    kind: "fault",
                    layer: "faults",
                    geometry,
                    attributes: serde_json::from_value(
                        json!({ "width": fault.width, "causeId": fault.id, "sourceAlgorithm": "atlas-1" }),
                    )?,
                },
            )?;
            self.write_feature(feature)?;
        }
        Ok(())
    }
    pub fn extract_ranges(&mut self) -> io::Result<()> {
        self.clear_queries();
        let mut tops = BitSet::new(self.field().mesh().len());
        for peak in places_of(self, self.catalogue.get(Kind::Peak))?.iter() {
            tops.add(peak.anchor);
        }
        let regions = geographic_regions::components(
            self,
            &|cell| peak_ranges::mountain(self, cell),
            Components {
                polygonal: true,
                splits: true,
            },
            None,
        )?;
        self.retained_continental_domains
            .set(self.retained_continental_domains.get() + regions.retained_continental_domains);
        for region in regions.regions {
            let Some(extent) = region.geometry else {
                continue;
            };
            let surface = match &self.physical.ocean {
                Some(ocean) => self
                    .spatial
                    .overlay(&extent, ocean, Overlay::Difference)
                    .map_err(io::Error::other)?,
                None => Some(extent),
            };
            let Some(surface) = surface else {
                continue;
            };
            if !peak_ranges::is_range(self, &region.members)? {
                continue;
            }
            let area = self.spatial.area(&surface).map_err(io::Error::other)?;
            let peaks = region
                .members
                .iter()
                .filter(|&&cell| tops.has(cell))
                .count();
            if let Some(feature) = map_records::place_feature(
                self,
                PlaceRecord {
                    kind: "range",
                    name: "Range",
                    members: &region.members,
                    layer: "geology",
                    attributes: serde_json::from_value(json!({ "peaks": peaks, "area": area }))?,
                    extent: Some(surface),
                    placement: None,
                    relations: Vec::new(),
                },
            )? {
                self.write_feature(feature)?;
            }
        }
        Ok(())
    }
}
fn line_parts(shape: Geometry, lines: &mut Vec<Vec<Position>>) {
    match shape {
        Geometry::LineString { coordinates } => lines.push(coordinates),
        Geometry::MultiLineString { coordinates } => lines.extend(coordinates),
        Geometry::GeometryCollection { geometries } => {
            for shape in geometries {
                line_parts(shape, lines);
            }
        }
        _ => {}
    }
}
