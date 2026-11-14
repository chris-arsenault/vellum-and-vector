//! Capture the current water owner and map records before regional development begins.
use super::{courses::line_parts, network::Entry};
use crate::{
    execution::{Command, CommandKind, ExecutionResult},
    features::{FeatureReader, FeatureSelection},
    field::{
        fractures::Fault,
        landmarks::{
            catalogue::Landmark,
            lifecycle::{self, Work},
            magic::Scene,
        },
        shared::Scalar,
        Field,
    },
    spatial::SpatialKernel,
    water::balance::flow_through_year,
};
use atlas_map::{Geometry, Position};
use std::{io, rc::Rc};

pub fn retained_course_cells(field: &Field) -> Vec<usize> {
    super::courses::retained_cells(field.mesh.len(), field.water.borrow().rivers())
}

pub fn river_entries(field: &Field) -> Vec<Entry> {
    field
        .water
        .borrow()
        .rivers()
        .entries()
        .iter()
        .map(|entry| Entry {
            cell: entry.cell,
            discharge: flow_through_year(&entry.monthly, 0.0).mean,
            catchment: entry.catchment,
        })
        .collect()
}
pub fn faults(
    field: &mut Field,
    source: Option<&dyn FeatureReader>,
    area: &str,
    width: f64,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    let mut faults = Vec::new();
    let [ox, oy] = field.mesh.origin();
    if let Some(source) = source {
        for feature in source.values(FeatureSelection {
            area_id: Some(area),
            kind: Some("fault"),
            ..Default::default()
        })? {
            let feature = feature?;
            let local = Geometry::MultiLineString {
                coordinates: line_parts(&feature.geometry)
                    .iter()
                    .map(|line| {
                        line.iter()
                            .map(|p| {
                                let [x, y, _] = p.coordinates();
                                Position::xy(x - ox, y - oy)
                            })
                            .collect()
                    })
                    .collect(),
            };
            let Some(clipped) = spatial
                .clip_by_rect(&local, field.mesh.bounds())
                .map_err(io::Error::other)?
            else {
                continue;
            };
            let width = feature
                .attributes
                .get("width")
                .and_then(|v| {
                    v.as_f64()
                        .or_else(|| v.as_str().and_then(|v| v.parse().ok()))
                })
                .unwrap_or(f64::NAN);
            if width <= 0.0 || width.is_nan() {
                continue;
            }
            for line in line_parts(&clipped) {
                faults.push(Fault {
                    id: feature.id.clone(),
                    width,
                    coordinates: line
                        .iter()
                        .map(|p| {
                            let [x, y, _] = p.coordinates();
                            [x, y]
                        })
                        .collect(),
                });
            }
        }
    }
    field.realize_captured_faults(&faults, width, spatial)
}
pub struct LandmarkRestore {
    pub landmarks: Vec<Landmark>,
    pub scene: Scene,
}
pub fn landmark_restore(
    operations: Rc<lifecycle::Operations>,
    spatial: Rc<dyn SpatialKernel>,
) -> Command<Field, LandmarkRestore> {
    let maintain = operations.maintenance(spatial);
    Command::with_inputs(
        "regional.landmarks.restore",
        CommandKind::Work,
        vec![],
        move |context, input: &LandmarkRestore| -> ExecutionResult<()> {
            if input.landmarks.is_empty() {
                return Ok(());
            }
            let maintenance = context
                .state_mut()
                .shared
                .scalar_mut(Scalar::LandmarkMaintenance);
            for cell in 0..maintenance.len() {
                maintenance.set(cell, 0.0)?;
            }
            for landmark in &input.landmarks {
                context.run(
                    &maintain,
                    &Work {
                        landmark: landmark.clone(),
                        epoch: 0,
                        drift: Vec::new(),
                        plumes: Vec::new(),
                        scene: input.scene.clone(),
                    },
                )?;
            }
            Ok(())
        },
    )
}
