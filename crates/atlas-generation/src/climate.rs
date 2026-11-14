//! Shared latitude frame and the movement of the seasonal rain belts.
use crate::water::balance::{air_demand, day_length, monthly_warmth, sun_standing, MONTHS};

pub fn aligned_neighbor(
    mesh: &crate::lattice::TriangularLattice,
    cell: usize,
    [x, y]: [f64; 2],
) -> Option<usize> {
    let mut best = None;
    let mut score = f64::NEG_INFINITY;
    for edge in 0..3 {
        let Some(next) = mesh.neighbor(cell, edge) else {
            continue;
        };
        let [dx, dy] = mesh.edge_direction(cell, edge);
        let alignment = dx * x + dy * y;
        if alignment > score {
            score = alignment;
            best = Some(next);
        }
    }
    best
}

#[derive(Clone, Copy)]
pub enum LatitudeProjection {
    Equirectangular,
    EqualArea,
}
pub struct LatitudeFrame {
    pub south: f64,
    pub north: f64,
    pub projection: LatitudeProjection,
    pub world_extent_y: Option<[f64; 2]>,
}
impl LatitudeFrame {
    pub fn latitude_at_y(&self, y: f64) -> f64 {
        let [south, north] = self.world_extent_y.unwrap_or([0.0; 2]);
        let fraction = if north > south {
            ((y - south) / (north - south)).clamp(0.0, 1.0)
        } else {
            0.5
        };
        if matches!(self.projection, LatitudeProjection::Equirectangular)
            || self.south == self.north
        {
            return self.south + (self.north - self.south) * fraction;
        }
        let (low, high) = (self.south.to_radians().sin(), self.north.to_radians().sin());
        (low + (high - low) * fraction)
            .clamp(-1.0, 1.0)
            .asin()
            .to_degrees()
    }
    pub fn northing_at_latitude(&self, latitude: f64) -> f64 {
        let [south, north] = self.world_extent_y.unwrap_or([0.0; 2]);
        let span = self.north - self.south;
        if span == 0.0 {
            return (south + north) / 2.0;
        }
        let fraction = match self.projection {
            LatitudeProjection::EqualArea => {
                (latitude.to_radians().sin() - self.south.to_radians().sin())
                    / (self.north.to_radians().sin() - self.south.to_radians().sin())
            }
            LatitudeProjection::Equirectangular => (latitude - self.south) / span,
        };
        south + (north - south) * fraction
    }
    pub fn metres_per_degree(&self) -> f64 {
        let [south, north] = self.world_extent_y.unwrap_or([0.0; 2]);
        let span = self.north - self.south;
        if north > south && span > 0.0 {
            (north - south) / span
        } else {
            f64::INFINITY
        }
    }
}
pub struct RainBelts {
    pub axial_tilt: f64,
    pub circulation_cells_per_hemisphere: f64,
    pub equatorial_convergence: f64,
    pub equatorial_convergence_width: f64,
    pub storm_track_strength: f64,
    pub subtropical_subsidence: f64,
    pub subtropical_subsidence_width: f64,
    pub polar_subsidence: f64,
    pub minimum_rainout: f64,
}
impl RainBelts {
    pub fn rainout(&self, latitude: f64) -> f64 {
        let width = 90.0 / self.circulation_cells_per_hemisphere.max(1.0);
        let spread = width / 4.0;
        let distance = latitude.abs();
        let gradient = (2.0 * distance).to_radians().sin().abs();
        let bell = |offset: f64, width: f64| (-(offset / width).powi(2)).exp();
        self.minimum_rainout.max(
            1.0 + self.equatorial_convergence * bell(distance, self.equatorial_convergence_width)
                + self.storm_track_strength
                    * gradient
                    * bell(distance - 5.0 * width / 3.0, spread * 1.5)
                - self.subtropical_subsidence
                    * bell(distance - width, self.subtropical_subsidence_width)
                - self.polar_subsidence * bell(distance - 3.0 * width, spread),
        )
    }
    pub fn through_year(&self, latitude: f64, swing: f64) -> [f64; MONTHS] {
        let reach = self.axial_tilt * swing.clamp(0.0, 1.0);
        let poleward = if latitude < 0.0 { -1.0 } else { 1.0 };
        let mut shares = std::array::from_fn(|month| {
            self.rainout(latitude - poleward * reach * sun_standing(month))
        });
        let total: f64 = shares.iter().sum();
        for value in &mut shares {
            *value /= total;
        }
        shares
    }
}
pub fn seasonal_swing(equator: f64, polar: f64, latitude: f64, half_range: f64) -> f64 {
    let most = equator + polar * latitude.to_radians().sin().powi(2);
    if most > 0.0 {
        (half_range / most).clamp(0.0, 1.0)
    } else {
        0.0
    }
}
pub struct AirYear {
    pub warmth: [f64; MONTHS],
    pub demand: [f64; MONTHS],
}
pub fn air_year(
    latitude: f64,
    axial_tilt: f64,
    temperature: f64,
    seasonality: f64,
    warmer: f64,
) -> AirYear {
    let warmth = monthly_warmth((temperature + warmer) / 10.0 - 30.0, seasonality);
    let demand = std::array::from_fn(|month| {
        air_demand(
            warmth[month],
            day_length(latitude, axial_tilt * sun_standing(month)),
        )
    });
    AirYear { warmth, demand }
}
pub fn closed_by_aridity(rain: f64, snow: f64, demand: &[f64; MONTHS]) -> bool {
    rain + snow < 0.5 * demand.iter().sum::<f64>()
}
