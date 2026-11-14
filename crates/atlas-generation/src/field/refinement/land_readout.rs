//! Existing regional progress observations over the map's dry content area.
use crate::{
    field::{shared::Scalar as S, Field},
    lattice::Membership,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
    storage::ReadBand,
    water::{balance::MONTHS, column::Store, network::RiverSample},
};
use std::io;

impl Field {
    pub fn land_readout(&self, season: &ReadBand<f64>) -> io::Result<String> {
        let water = self.water.borrow();
        let view = water.read_only();
        let rivers = water.river_reader();
        let soil = self.ground().view(GroundField::SoilDepth);
        let mut sums = [0.0; 17];
        let mut land = 0.0;
        let mut all = 0.0;
        for cell in 0..self.mesh.len() {
            if self.mesh.membership(cell) != Membership::Content {
                continue;
            }
            let area = self.mesh.area(cell);
            all += area;
            let kind = view.column.kind.get(cell)?;
            if kind != 0 {
                continue;
            }
            land += area;
            let value = |scalar| self.shared.scalar(scalar).get(cell);
            let rain = value(S::Rainfall)? + value(S::Snowfall)?;
            let demand = value(S::AirDemand)?;
            let months = rivers.sample(cell, RiverSample::Months, 0.0);
            let values = [
                season.get(cell)?,
                soil.get(cell)?,
                value(S::Moisture)? / 1000.0,
                value(S::Slope)?,
                value(S::TreeCover)?,
                value(S::GrassCover)?,
                f64::from(rivers.order_at(cell, kind) > 0),
                rain,
                view.runoff.mean.get(cell)?,
                view.column.year[12].get(cell)?,
                f64::from(months >= MONTHS as f64),
                f64::from(months > 0.0 && months < MONTHS as f64),
                value(S::Temperature)? / 10.0 - 30.0,
                demand,
                demand.min(rain),
                MapScale::in_units(
                    view.column.store(Store::Soil).capacity(cell)?,
                    LengthUnit::Millimetre,
                ),
                f64::from(rivers.at(cell).is_some_and(|reach| reach.dry())),
            ];
            for (sum, value) in sums.iter_mut().zip(values) {
                *sum += value * area;
            }
        }
        let mean = |index: usize, digits: usize| {
            format!(
                "{:.*}",
                digits,
                if land > 0.0 { sums[index] / land } else { 0.0 }
            )
        };
        let mut running = 0;
        let mut dry = 0;
        for reach in water.rivers().reaches() {
            if reach.dry() {
                dry += 1;
            } else {
                running += 1;
            }
        }
        Ok(format!("dry land {:.1}% of the map; over it: growing season {}, soil {} m, moisture {}, slope {}, tree cover {}, grass {}, on a river {}, on an old bed {} ({running} running reaches, {dry} dry); mean warmth {} degrees, the air could take {} mm ({} mm of it where the rain falls), soil holds {} mm; water: {} mm falls, {} mm runs off, {} mm sinks in; a river's flow all year on {} of it, part of the year on {}; {}",
            if all > 0.0 { 100.0 * land / all } else { 0.0 }, mean(0,3), mean(1,3), mean(2,3), mean(3,3), mean(4,3), mean(5,3),
            mean(6,3), mean(16,3), mean(12,1), mean(13,0), mean(14,0), mean(15,0), mean(7,0), mean(8,0), mean(9,0), mean(10,3), mean(11,3), water.account_line()))
    }
}
