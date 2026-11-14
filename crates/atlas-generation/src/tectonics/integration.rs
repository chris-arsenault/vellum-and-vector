use super::{
    controls,
    fracture::{self, Plume},
    motion,
    state::{Plate, Site, State},
};
use crate::{
    lattice::TriangularLattice,
    scale::MapScale,
    spatial::{SpatialIndex, SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Position};

pub fn interval(scale: MapScale, state: &State, remaining: f64, rate: f64) -> SpatialResult<f64> {
    let speed = state
        .sites
        .iter()
        .map(|s| s.province.motion[0].hypot(s.province.motion[1]))
        .fold(0.001, f64::max);
    Ok(remaining
        .min(controls::STEP_MYR)
        .min(controls::step_travel(scale)? / (speed * rate)))
}
pub fn prepare(
    mesh: &TriangularLattice,
    scale: MapScale,
    kernel: &dyn SpatialKernel,
    state: &mut State,
    myr: f64,
) -> SpatialResult<()> {
    state.refresh_contacts(mesh, kernel)?;
    motion::update_plate_motion(mesh, scale, state, myr).map_err(str::to_owned)
}
pub struct Interval {
    pub myr: f64,
    pub distance: f64,
}
pub fn complete(
    mesh: &TriangularLattice,
    scale: MapScale,
    state: &mut State,
    interval: Interval,
    plumes: &[Plume],
    moved: impl FnOnce(&State),
) -> SpatialResult<()> {
    let Interval { myr, distance } = interval;
    state.move_sites(mesh, distance);
    moved(state);
    fracture::deform_bonds(mesh, scale, state, myr, plumes)?;
    state.elapsed_myr += myr;
    Ok(())
}
pub struct MotionFrame {
    pub plates: Vec<Plate>,
    pub sites: Vec<Site>,
    pub distance: f64,
}
fn affine(plate: &Plate, site: &Site, distance: f64) -> (f64, f64, [f64; 2]) {
    let angle = plate.spin * distance;
    let share = site.compliance;
    (
        angle.cos(),
        angle.sin() - share * angle,
        [
            plate.motion[0] * (1.0 - share) + site.drive[0] * share,
            plate.motion[1] * (1.0 - share) + site.drive[1] * share,
        ],
    )
}
pub fn forward_point(
    mesh: &TriangularLattice,
    point: [f64; 2],
    plate: &Plate,
    site: &Site,
    distance: f64,
) -> [f64; 2] {
    let (a, b, velocity) = affine(plate, site, distance);
    let dx = mesh.delta_x(point[0] - plate.position[0]);
    let dy = point[1] - plate.position[1];
    mesh.point(
        plate.position[0] + a * dx - b * dy + velocity[0] * distance,
        plate.position[1] + b * dx + a * dy + velocity[1] * distance,
    )
}
pub fn inverse_point(
    mesh: &TriangularLattice,
    point: [f64; 2],
    plate: &Plate,
    site: &Site,
    distance: f64,
) -> [f64; 2] {
    let (a, b, velocity) = affine(plate, site, distance);
    let dx = mesh.delta_x(point[0] - plate.position[0] - velocity[0] * distance);
    let dy = point[1] - plate.position[1] - velocity[1] * distance;
    let determinant = a * a + b * b;
    mesh.point(
        plate.position[0] + (a * dx + b * dy) / determinant,
        plate.position[1] + (-b * dx + a * dy) / determinant,
    )
}
pub fn forecast_frames(
    mesh: &TriangularLattice,
    scale: MapScale,
    kernel: &dyn SpatialKernel,
    state: &State,
    distances: &[f64],
    plumes: &[Plume],
) -> SpatialResult<Vec<MotionFrame>> {
    let mut forecast = state.clone();
    let mut frames = Vec::new();
    let rate = forecast.rate;
    if rate == 0.0 && distances.iter().all(|distance| *distance == 0.0) {
        return Ok(frames);
    }
    if !rate.is_finite() || rate <= 0.0 {
        return Err("Tectonic forecast requires a positive finite drift rate".into());
    }
    for distance in distances {
        let mut remaining = distance / rate;
        while remaining > 1e-9 {
            let myr = interval(scale, &forecast, remaining, rate)?;
            let step = myr * rate;
            prepare(mesh, scale, kernel, &mut forecast, myr)?;
            let plates = forecast.plates.clone();
            complete(
                mesh,
                scale,
                &mut forecast,
                Interval {
                    myr,
                    distance: step,
                },
                plumes,
                |moved| {
                    frames.push(MotionFrame {
                        plates,
                        sites: moved.sites.clone(),
                        distance: step,
                    })
                },
            )?;
            remaining -= myr;
        }
    }
    Ok(frames)
}
pub struct IndexedFrame<'a> {
    frame: &'a MotionFrame,
    index: Box<dyn SpatialIndex + 'a>,
}
impl MotionFrame {
    pub fn indexed<'a>(
        &'a self,
        mesh: &TriangularLattice,
        kernel: &'a dyn SpatialKernel,
    ) -> SpatialResult<IndexedFrame<'a>> {
        let width = mesh.coordinate_width().unwrap_or(0.0);
        let offsets: &[f64] = if width == 0.0 {
            &[0.0]
        } else {
            &[-width, 0.0, width]
        };
        let mut points = Vec::new();
        for offset in offsets {
            for site in &self.sites {
                points.push(Geometry::Point {
                    coordinates: Position::xy(
                        site.province.position[0] + offset,
                        site.province.position[1],
                    ),
                });
            }
        }
        Ok(IndexedFrame {
            frame: self,
            index: kernel.index(&points)?,
        })
    }
}
impl IndexedFrame<'_> {
    fn owners(&self, point: [f64; 2]) -> SpatialResult<(&Plate, &Site)> {
        let index = self
            .index
            .nearest(Position::xy(point[0], point[1]))?
            .ok_or("Mechanical frame has no provinces")?;
        let site = &self.frame.sites[index % self.frame.sites.len()];
        let plate = self
            .frame
            .plates
            .iter()
            .find(|p| p.id == site.plate)
            .ok_or("Mechanical frame has no province plate")?;
        Ok((plate, site))
    }
    pub fn forward(&self, mesh: &TriangularLattice, point: [f64; 2]) -> SpatialResult<[f64; 2]> {
        let (plate, site) = self.owners(point)?;
        Ok(forward_point(mesh, point, plate, site, self.frame.distance))
    }
    pub fn inverse(&self, mesh: &TriangularLattice, point: [f64; 2]) -> SpatialResult<[f64; 2]> {
        let (plate, site) = self.owners(point)?;
        Ok(inverse_point(mesh, point, plate, site, self.frame.distance))
    }
}
