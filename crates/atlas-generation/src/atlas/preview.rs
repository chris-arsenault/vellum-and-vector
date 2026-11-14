//! The source generator's independent 128-sample display preview, sampled from live owners.
use super::state::State;
use crate::field::{projection::channels, schema::NumericBand};
use atlas_map::Position;
use serde::Serialize;
use std::{collections::BTreeMap, io};

#[derive(Serialize)]
pub struct Channel {
    pub dtype: &'static str,
    pub unit: String,
    pub quantity: &'static str,
    // hpc-exempt: small detached display payload, never working field storage.
    pub values: Vec<f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub width: usize,
    pub height: usize,
    pub bounds: [f64; 4],
    pub periodic_width: Option<f64>,
    pub active: Vec<u8>,
    // hpc-exempt: preview planes keyed by channel name.
    pub channels: BTreeMap<String, Channel>,
}
pub fn capture(state: &State) -> io::Result<Preview> {
    let bounds = state.physical.surface.grid().bounds;
    let [w, s, e, n] = bounds;
    let longest = (e - w).max(n - s);
    let width = ((127.0 * (e - w) / longest).ceil() as usize + 1).max(2);
    let height = ((127.0 * (n - s) / longest).ceil() as usize + 1).max(2);
    let points = (0..width * height)
        .map(|cell| {
            Position::xy(
                w + (e - w) * (cell % width) as f64 / (width - 1) as f64,
                s + (n - s) * (cell / width) as f64 / (height - 1) as f64,
            )
        })
        .collect::<Vec<_>>();
    let covered = state
        .spatial
        .covers_points(&state.physical.field_footprint, &points)
        .map_err(io::Error::other)?;
    let field = state.field();
    let [ox, oy] = field.mesh().origin();
    let indexes = points
        .iter()
        .map(|point| {
            let [x, y, _] = point.coordinates();
            field.mesh().cell_at(x - ox, y - oy)
        })
        .collect::<Vec<_>>();
    let mut result = Preview {
        width,
        height,
        bounds,
        periodic_width: state.physical.surface.grid().periodic_width,
        active: covered
            .iter()
            .zip(&indexes)
            .map(|(&yes, cell)| u8::from(yes && cell.is_some()))
            .collect(),
        channels: BTreeMap::new(),
    };
    let bands = field.bands();
    for binding in channels::physical().iter().filter(|binding| {
        [
            "Elevation",
            "WaterKindCodes",
            "IceThickness",
            "finalSurface",
        ]
        .contains(&binding.name.as_str())
    }) {
        let band = bands
            .iter()
            .find(|band| band.name == binding.name)
            .ok_or_else(|| {
                io::Error::other(format!("Preview owner is missing {}", binding.name))
            })?;
        result.channels.insert(
            binding.name.clone(),
            plane(&band.values, binding.unit, &indexes)?,
        );
    }
    for (name, value) in [
        ("BaseSeaLevel", field.water().base_sea_level),
        ("EffectiveSeaLevel", field.ground().effective_sea_level()),
    ] {
        result.channels.insert(
            name.into(),
            Channel {
                dtype: "float64",
                unit: "native-length".into(),
                quantity: "intensive",
                values: vec![value; width * height],
            },
        );
    }
    Ok(result)
}
fn plane(band: &NumericBand, unit: &str, indexes: &[Option<usize>]) -> io::Result<Channel> {
    Ok(Channel {
        dtype: band.sample_type(),
        unit: unit.into(),
        quantity: if unit == "category" {
            "category"
        } else {
            "intensive"
        },
        values: indexes
            .iter()
            .map(|cell| cell.map_or(Ok(0.0), |cell| band.get(cell)))
            .collect::<io::Result<_>>()?,
    })
}
