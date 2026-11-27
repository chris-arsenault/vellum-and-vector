use super::{map, Harness, Results, Trial};
use atlas_generation::{
    atlas::{dispatch::experiment::Target, state::State},
    parameters::Values,
    spatial::SpatialKernel,
};
use atlas_gis::{
    geometry::NativeGeos,
    raster_values::{layer_value, Raster},
};
use atlas_map::{Bounds, Geometry, MapDescriptor, Position, RegionGeometry};
use serde::{Deserialize, Serialize};
use std::{fs, io, time::Instant};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Measure {
    pub channel: String,
    pub footprint: Option<String>,
    /// Retain the actual City partition and its measurements from the final trial state.
    #[serde(default)]
    pub districts: bool,
    #[serde(default = "samples")]
    pub samples_across: usize,
    #[serde(default)]
    pub watch: Vec<Target>,
}

fn samples() -> usize {
    256
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Metric {
    #[default]
    Mean,
    Maximum,
    AreaIntegral,
    CoveredKm2,
}
impl Metric {
    pub fn parse(name: &str) -> io::Result<Self> {
        serde_json::from_value(name.into()).map_err(io::Error::other)
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Mean => "mean",
            Self::Maximum => "maximum",
            Self::AreaIntegral => "areaIntegral",
            Self::CoveredKm2 => "coveredKm2",
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Metrics {
    pub mean: Option<f64>,
    pub maximum: Option<f64>,
    pub area_integral: Option<f64>,
    pub covered_km2: f64,
    pub sampled_km2: f64,
}
impl Metrics {
    pub fn get(&self, metric: Metric) -> Option<f64> {
        match metric {
            Metric::Mean => self.mean,
            Metric::Maximum => self.maximum,
            Metric::AreaIntegral => self.area_integral,
            Metric::CoveredKm2 => Some(self.covered_km2),
        }
    }
}

#[derive(Deserialize, Serialize)]
pub(super) struct Observation {
    pub label: String,
    pub parameters: Values,
    pub unit: String,
    pub metrics: Metrics,
    pub grid: Grid,
}

#[derive(Deserialize, Serialize)]
pub(super) struct Grid {
    pub bounds: Bounds,
    pub width: usize,
    pub height: usize,
    pub values: Vec<Option<f64>>,
}

pub(super) struct Frame {
    bounds: Bounds,
    width: usize,
    height: usize,
    positions: Vec<Position>,
    inside: Vec<bool>,
}
impl Frame {
    pub fn new(
        bounds: Bounds,
        shape: &Geometry,
        across: usize,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Self> {
        let Bounds(w, s, e, n) = bounds;
        let longest = (e - w).max(n - s);
        if across == 0 || e <= w || n <= s || !longest.is_finite() {
            return Err(io::Error::other(
                "Measurement needs a positive sample count and footprint",
            ));
        }
        let dimension = |side: f64| ((side / longest * across as f64).round() as usize).max(1);
        let width = dimension(e - w);
        let height = dimension(n - s);
        let count = width
            .checked_mul(height)
            .ok_or_else(|| io::Error::other("Measurement grid is too large"))?;
        let mut positions = Vec::new();
        positions
            .try_reserve_exact(count)
            .map_err(io::Error::other)?;
        positions.extend((0..count).map(|i| {
            Position::xy(
                w + (e - w) * ((i % width) as f64 + 0.5) / width as f64,
                n - (n - s) * ((i / width) as f64 + 0.5) / height as f64,
            )
        }));
        let inside = spatial
            .covers_points(shape, &positions)
            .map_err(io::Error::other)?;
        Ok(Self {
            bounds,
            width,
            height,
            positions,
            inside,
        })
    }
    pub fn map(
        map: &MapDescriptor,
        across: usize,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Self> {
        let shape = match &map.footprint {
            RegionGeometry::Polygon(coordinates) => Geometry::Polygon {
                coordinates: coordinates.clone(),
            },
            RegionGeometry::MultiPolygon(coordinates) => Geometry::MultiPolygon {
                coordinates: coordinates.clone(),
            },
        };
        Self::new(map.bounds, &shape, across, spatial)
    }
    fn sample(
        &self,
        label: String,
        unit: String,
        parameters: Values,
        mut read: impl FnMut(Position) -> io::Result<Option<f64>>,
    ) -> io::Result<Observation> {
        let values: Vec<_> = self
            .positions
            .iter()
            .zip(&self.inside)
            .map(|(&position, &inside)| {
                if inside {
                    Ok(read(position)?.filter(|value| value.is_finite()))
                } else {
                    Ok(None)
                }
            })
            .collect::<io::Result<_>>()?;
        let samples = values.iter().flatten();
        let count = samples.clone().count();
        let sum = samples.clone().sum::<f64>();
        let Bounds(w, s, e, n) = self.bounds;
        let pixel_km2 = (e - w) * (n - s) / values.len() as f64 / 1_000_000.;
        Ok(Observation {
            label,
            parameters,
            unit,
            metrics: Metrics {
                mean: (count > 0).then(|| sum / count as f64),
                maximum: samples.copied().reduce(f64::max),
                area_integral: (count > 0).then_some(sum * pixel_km2),
                covered_km2: count as f64 * pixel_km2,
                sampled_km2: self.inside.iter().filter(|&&inside| inside).count() as f64
                    * pixel_km2,
            },
            grid: Grid {
                bounds: self.bounds,
                width: self.width,
                height: self.height,
                values,
            },
        })
    }
    pub fn state(
        &self,
        state: &State,
        channel: &str,
        label: String,
        parameters: Values,
    ) -> io::Result<Observation> {
        let field = state.field();
        let band = field
            .bands()
            .into_iter()
            .find(|band| band.name == channel)
            .ok_or_else(|| io::Error::other(format!("No live numerical channel {channel}")))?;
        let unit = live_unit(channel);
        let values = band.values.read_values()?;
        let [ox, oy] = field.mesh().origin();
        self.sample(label, unit, parameters, |position| {
            let [x, y, _] = position.coordinates();
            field
                .mesh()
                .cell_at(x - ox, y - oy)
                .map(|cell| values.get(cell))
                .transpose()
        })
    }
}

fn live_unit(channel: &str) -> String {
    if channel == "Population" {
        return "people/square-kilometre".into();
    }
    atlas_generation::field::projection::channels::physical()
        .into_iter()
        .find(|binding| binding.name == channel)
        .map(|binding| binding.unit)
        .unwrap_or("native units")
        .into()
}

pub(super) fn inspect(
    harness: &Harness,
    names: &[String],
    measure: &Measure,
    results: &mut Results,
) -> io::Result<()> {
    let spatial = NativeGeos::new(1e-6).map_err(io::Error::other)?;
    let footprint = measure
        .footprint
        .as_ref()
        .or(names.last())
        .ok_or_else(|| io::Error::other("Select at least one saved map"))?;
    if names.is_empty() {
        return Err(io::Error::other("Select at least one saved map"));
    }
    let frame = Frame::map(&map(harness, footprint)?, measure.samples_across, &spatial)?;
    for name in names {
        let started = Instant::now();
        let mut trial = Trial {
            label: name.clone(),
            value: None,
            seconds: 0.,
            reference: None,
            changes: Vec::new(),
            observations: Vec::new(),
            error: None,
        };
        let result = (|| {
            let map = map(harness, name)?;
            trial.reference = Some(map.reference.clone());
            let observation = published(harness, name, &map, &frame, &measure.channel)?;
            if observation.metrics.covered_km2 == 0. {
                return Err(io::Error::other(
                    "The saved layer has no data on the comparison footprint",
                ));
            }
            trial.observations.push(observation);
            Ok(())
        })();
        trial.seconds = started.elapsed().as_secs_f64();
        trial.error = result.err().map(|error| error.to_string());
        results.trials.push(trial);
    }
    Ok(())
}

fn published(
    harness: &Harness,
    name: &str,
    map: &MapDescriptor,
    frame: &Frame,
    channel: &str,
) -> io::Result<Observation> {
    let layer = map
        .layers
        .iter()
        .find(|layer| layer.id == channel)
        .ok_or_else(|| io::Error::other(format!("{} has no layer {channel}", map.name)))?;
    let (atlas_map::LayerSource::Raster(source) | atlas_map::LayerSource::Attributes(source)) =
        &layer.source
    else {
        return Err(io::Error::other(
            "The observed layer must be a published raster",
        ));
    };
    let band = source
        .bands
        .iter()
        .find(|band| band.id == "value")
        .ok_or_else(|| io::Error::other("The observed layer has no value band"))?;
    let exported = harness
        .map_folder(name)
        .join(format!("{}.tif", super::slug(channel, &['.', '-'])));
    let data = match fs::read(exported) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            asset(harness, map, &source.asset_id)?
        }
        Err(error) => return Err(error),
    };
    let mut raster = Raster::new(io::Cursor::new(data))?;
    frame.sample(name.into(), band.unit.clone(), Values::new(), |position| {
        Ok(layer_value(&mut raster, layer, position)?.map(|band| band.value))
    })
}

fn asset(harness: &Harness, map: &MapDescriptor, id: &str) -> io::Result<Vec<u8>> {
    if let Ok(url) = std::env::var("ATLAS_EXPERIMENT_MAP_URL") {
        let maps = atlas_gis::postgres_maps::PostgresMaps::connect(&url)?;
        let asset = maps.asset(&map.reference, id)?;
        return atlas_gis::map_files::MapFiles::new(harness.home.join("map-assets"))
            .read(&asset.location);
    }
    harness
        .server
        .get(&atlas_gis::map_files::asset_path(&map.reference, id))
}
