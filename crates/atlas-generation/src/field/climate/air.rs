use super::{height, latitude, ocean, read, thermal, wrap, write, Field, Settings};
use crate::{
    field::shared::{CellCode as C, Scalar as S},
    flow_graph::source_order,
    metric::smoothing::smooth,
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage},
};
use std::io;

struct Columns {
    moisture: Band<f64>,
    precipitation: Band<f64>,
    air_heat: Band<f64>,
    marine: Band<f64>,
    maritime: Band<f64>,
    magic: Band<f64>,
    carried: Band<f64>,
    storm: Band<f64>,
}
impl Columns {
    fn new(coverage: &mut Coverage) -> Self {
        Self {
            moisture: coverage.allocate(0.0),
            precipitation: coverage.allocate(0.0),
            air_heat: coverage.allocate(0.0),
            marine: coverage.allocate(0.0),
            maritime: coverage.allocate(0.0),
            magic: coverage.allocate(0.0),
            carried: coverage.allocate(0.0),
            storm: coverage.allocate(0.0),
        }
    }
}
struct Air {
    q: f64,
    heat: f64,
    sea: f64,
    orographic: f64,
}
struct March<'a> {
    field: &'a Field,
    p: &'a Settings,
    edges: Option<[f64; 2]>,
}
fn saturation(p: &Settings, temperature: f64) -> f64 {
    p.column_saturation * (p.column_saturation_growth * ((temperature - 300.0) / 10.0 - 20.0)).exp()
}
impl March<'_> {
    fn over_sea(&self, cell: usize, air: Air, d: f64, target: f64) -> io::Result<Air> {
        let p = self.p;
        let exchange = 1.0 - (-d / p.sea_exchange_length).exp();
        Ok(Air {
            q: air.q + (target - air.q) * (1.0 - (-d / p.sea_evaporation_length).exp()),
            heat: air.heat + (read(self.field, S::SeaSurfaceAnomaly, cell)? - air.heat) * exchange,
            sea: air.sea + (1.0 - air.sea) * exchange,
            orographic: 0.0,
        })
    }
    fn over_land(
        &self,
        cell: usize,
        upwind: Option<usize>,
        air: Air,
        d: f64,
        rainout: f64,
    ) -> io::Result<Air> {
        let p = self.p;
        let field = self.field;
        let rise = match upwind {
            None => 0.0,
            Some(u) => (height(field, cell)? - height(field, u)?).max(0.0),
        };
        let lifted = air.q * (1.0 - (-rise / p.orographic_lift_height).exp());
        let depletion = 1.0 - (-d * rainout / p.column_rain_length).exp();
        Ok(Air {
            q: (air.q - lifted) * (1.0 - depletion)
                + MapScale::in_units(
                    read(field, S::Evapotranspiration, cell)?,
                    LengthUnit::Millimetre,
                ) * depletion,
            heat: air.heat * (-d / p.air_heat_length).exp(),
            sea: air.sea * (-d / p.maritime_length).exp(),
            orographic: lifted * (p.column_rain_length / d.max(field.mesh.area(cell).sqrt())),
        })
    }
    fn wring(&self, cell: usize, d: f64, air: &mut Air, share: f64) {
        let lifted = air.q * share;
        air.q -= lifted;
        air.orographic +=
            lifted * (self.p.column_rain_length / d.max(self.field.mesh.area(cell).sqrt()));
    }
    fn steam(&self, cell: usize, d: f64, air: &mut Air, target: f64) -> io::Result<()> {
        let forcing = read(self.field, S::ExternalHeatForcing, cell)?;
        if forcing <= 0.0 || ocean(self.field, cell)? {
            return Ok(());
        }
        air.q += (target - air.q).max(0.0) * self.p.magic_steam_share * (forcing / 200.0).min(1.0);
        self.wring(
            cell,
            d,
            air,
            1.0 - (-forcing / self.p.magic_lift_heat).exp(),
        );
        Ok(())
    }
    fn storm(
        &self,
        cell: usize,
        upwind: Option<usize>,
        d: f64,
        air: &mut Air,
        columns: &mut Columns,
    ) -> io::Result<()> {
        let p = self.p;
        let field = self.field;
        let pinned = (1.0
            - (read(field, S::Stillness, cell)? * p.storm_pinning)
                .max(read(field, S::Warding, cell)? * p.storm_deflection))
        .max(0.0);
        let keep = (-if upwind.is_none() { 0.0 } else { d } / p.storm_length).exp() * pinned;
        let arriving = match upwind {
            None => 0.0,
            Some(u) => columns.storm.get(u)? * keep,
        };
        let pulse = (arriving + read(field, S::StormForcing, cell)? / 1000.0).min(1.0);
        columns.storm.set(cell, pulse)?;
        if pulse <= 0.0 {
            return Ok(());
        }
        let target = saturation(p, read(field, S::Temperature, cell)?) * p.ocean_column_humidity;
        air.q += (target - air.q).max(0.0) * p.storm_moisture_share * pulse;
        if !ocean(field, cell)? {
            self.wring(cell, d, air, 1.0 - (-pulse / p.storm_lift).exp());
        }
        Ok(())
    }
    fn advance(&self, cell: usize, upwind: Option<usize>, columns: &mut Columns) -> io::Result<()> {
        let p = self.p;
        let field = self.field;
        let target = saturation(p, read(field, S::Temperature, cell)?) * p.ocean_column_humidity;
        let d = upwind.map_or(0.0, |u| wrap::distance(field, self.edges, u, cell));
        let sea = ocean(field, cell)?;
        let arriving = match upwind {
            None => Air {
                q: target * if sea { 1.0 } else { p.boundary_column_humidity },
                heat: 0.0,
                sea: if sea { 1.0 } else { 0.0 },
                orographic: 0.0,
            },
            Some(u) => Air {
                q: columns.moisture.get(u)?,
                heat: columns.marine.get(u)?,
                sea: columns.maritime.get(u)?,
                orographic: 0.0,
            },
        };
        let rainout = p.belts().rainout(latitude(field, p, cell));
        let mut air = if sea {
            self.over_sea(cell, arriving, d, target)?
        } else {
            self.over_land(cell, upwind, arriving, d, rainout)?
        };
        self.steam(cell, d, &mut air, target)?;
        self.storm(cell, upwind, d, &mut air, columns)?;
        let keep = (-if upwind.is_none() {
            field.mesh.area(cell).sqrt()
        } else {
            d
        } / p.magic_heat_air_length)
            .exp();
        let carried = match upwind {
            None => 0.0,
            Some(u) => columns.magic.get(u)? * keep,
        };
        columns.carried.set(cell, carried)?;
        let q = air.q.max(0.0);
        columns.moisture.set(cell, q)?;
        columns.precipitation.set(
            cell,
            p.column_rain_efficiency * (rainout * q + air.orographic),
        )?;
        columns.marine.set(cell, air.heat)?;
        columns.air_heat.set(cell, air.heat)?;
        columns.maritime.set(cell, air.sea)?;
        columns.magic.set(
            cell,
            carried
                + read(field, S::ExternalHeatForcing, cell)?
                    * p.magic_heat_air_share
                    * (1.0 - keep),
        )?;
        Ok(())
    }
}
fn march(field: &Field, p: &Settings) -> io::Result<Columns> {
    let mut coverage = field.coverage.borrow_mut();
    let mut columns = Columns::new(&mut coverage);
    let upwind = field.shared.code(C::UpwindTargets);
    let sorted = source_order(&mut coverage, &upwind)?;
    let march = March {
        field,
        p,
        edges: wrap::edges(field, p),
    };
    for pass in 0..if march.edges.is_some() { 2 } else { 1 } {
        for at in 0..sorted.order.len() {
            let cell = sorted.order.get(at)? as usize;
            let source = if sorted.boundary.get(cell)? != 0 && pass == 0 {
                None
            } else {
                usize::try_from(upwind.get(cell)?).ok()
            };
            march.advance(cell, source, &mut columns)?;
        }
    }
    let mut any = false;
    for cell in 0..columns.carried.len() {
        if columns.carried.get(cell)? != 0.0 {
            any = true;
            break;
        }
    }
    if any {
        let spread = smooth(
            &field.mesh,
            &mut coverage,
            &columns.carried.read_only(),
            p.magic_heat_air_spread,
            None,
        )?;
        for cell in 0..field.mesh.len() {
            columns
                .air_heat
                .set(cell, columns.air_heat.get(cell)? + spread.get(cell)?)?;
        }
    }
    Ok(columns)
}
pub(super) fn moisture(field: &Field, p: &Settings) -> io::Result<()> {
    let columns = march(field, p)?;
    for cell in 0..field.mesh.len() {
        write(
            field,
            S::ColumnPrecipitation,
            cell,
            columns.precipitation.get(cell)?,
        )?;
        write(
            field,
            S::StormTrack,
            cell,
            (1000.0 * columns.storm.get(cell)?).round(),
        )?;
        if field.water().column.kind.get(cell)? != 0 {
            write(field, S::Moisture, cell, 1000.0)?;
            continue;
        }
        let temperature =
            (read(field, S::Temperature, cell)? + columns.air_heat.get(cell)?).round();
        write(field, S::Temperature, cell, temperature)?;
        write(
            field,
            S::Seasonality,
            cell,
            thermal::seasonality(
                p,
                latitude(field, p, cell),
                1.0 - columns.maritime.get(cell)?,
            ),
        )?;
        write(
            field,
            S::Moisture,
            cell,
            (1000.0 * columns.moisture.get(cell)? / saturation(p, temperature))
                .round()
                .clamp(0.0, 1000.0),
        )?;
    }
    Ok(())
}
