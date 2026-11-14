use super::work::km2;
use crate::{
    field::{shared::Scalar, Field},
    human::{catalogue::LayerId, HumanField},
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceLand {
    pub x: f64,
    pub y: f64,
    pub metres: f64,
    pub river: u16,
    pub coastal: bool,
    pub slope: f64,
    pub farmed_km2: f64,
    pub grazed_km2: f64,
    pub zone_km2: f64,
    pub site_kind: String,
    pub site_reason: String,
}
fn saddle(field: &Field, cell: usize) -> io::Result<bool> {
    let height = field.ground().view(GroundField::Elevation);
    let here = height.get(cell)?;
    let mut above = 0;
    let mut below = 0;
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            if height.get(next)? > here {
                above += 1;
            } else {
                below += 1;
            }
        }
    }
    Ok(above >= 2 && below >= 2 && field.shared.scalar(Scalar::Slope).get(cell)? > 0.08)
}
fn site(river: u16, coastal: bool, pass: bool, hilly: bool) -> (&'static str, &'static str) {
    if coastal && river > 0 {
        (
            "river mouth",
            "where a river meets the sea, with the going of both",
        )
    } else if coastal {
        (
            "harbour",
            "on the shore, where the sea's going reaches the land",
        )
    } else if river > 0 {
        ("river", "on a river, where its valley's going gathers")
    } else if pass {
        (
            "pass",
            "at a crossing of high ground, where the ways over it meet",
        )
    } else if hilly {
        (
            "upland",
            "in hill country, where its people's land lies around it",
        )
    } else {
        ("plain", "in open country, where the ways across it meet")
    }
}
pub fn place_land(field: &Field, anchor: usize, cells: &[usize]) -> io::Result<PlaceLand> {
    let mut river = 0;
    let mut coastal = false;
    let mut farmed_km2 = 0.0;
    let mut grazed_km2 = 0.0;
    let mut zone_km2 = 0.0;
    let water = field.water.borrow();
    let reader = water.river_reader();
    let kind = water.read_only().column.kind;
    let anchor_cell = [anchor];
    let cells = if cells.is_empty() {
        &anchor_cell
    } else {
        cells
    };
    for &cell in cells {
        river = river.max(reader.order_at(cell, kind.get(cell)?));
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                coastal |= kind.get(next)? == 1;
            }
        }
        let area = km2(field, cell);
        farmed_km2 += field
            .people
            .view(HumanField::Layer(LayerId::Farmland))
            .get(cell)?
            * area;
        grazed_km2 += field
            .people
            .view(HumanField::Layer(LayerId::Pasture))
            .get(cell)?
            * area;
        zone_km2 += area;
    }
    let slope = field.shared.scalar(Scalar::Slope).get(anchor)?;
    let (site_kind, site_reason) = site(river, coastal, saddle(field, anchor)?, slope > 0.08);
    let origin = field.mesh.origin();
    let point = field.mesh.position(anchor);
    Ok(PlaceLand {
        x: origin[0] + point[0],
        y: origin[1] + point[1],
        metres: MapScale::metres(
            field.ground().view(GroundField::Elevation).get(anchor)?
                - field.water().effective_sea_level,
            LengthUnit::Native,
        ),
        river,
        coastal,
        slope,
        farmed_km2,
        grazed_km2,
        zone_km2,
        site_kind: site_kind.into(),
        site_reason: site_reason.into(),
    })
}
