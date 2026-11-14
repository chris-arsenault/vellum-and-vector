//! Explicit captured-resource import; storage writers remain inside the water owner.
use super::{
    column::{CapturedColumn, NO_WATER_SURFACE},
    Water,
};
use std::io;

impl Water {
    pub(crate) fn restore_authored(
        &mut self,
        name: &str,
        cell: usize,
        value: f64,
    ) -> io::Result<bool> {
        {
            let mut column = self.column.borrow_mut();
            let mut captured = column.capture(cell)?;
            let is_column = match name {
                "SnowPack" => {
                    captured.snow = value;
                    true
                }
                "SoilWater" => {
                    captured.soil = value;
                    true
                }
                "GroundwaterStorage" => {
                    captured.ground = value;
                    true
                }
                "WaterDepths" => {
                    captured.standing = value;
                    true
                }
                "WaterSurfaceElevations" => {
                    captured.surface = value;
                    true
                }
                "WaterKindCodes" => {
                    captured.kind = value as u8;
                    true
                }
                "WaterBodyIds" => {
                    captured.body = (value + 0.5).floor() as i32;
                    true
                }
                _ => false,
            };
            if is_column {
                column.inherit(cell, captured)?;
                return Ok(true);
            }
            let month = match name {
                "WaterRecharge" => Some(12),
                "SnowKept" => Some(13),
                _ => name
                    .strip_prefix("SurfaceWaterMonth")
                    .and_then(|n| n.parse::<usize>().ok())
                    .filter(|&m| m < 12),
            };
            if let Some(month) = month {
                let view = column.read_only();
                let mut year = [0.0; 14];
                for (at, amount) in year.iter_mut().enumerate() {
                    *amount = if at == month {
                        value
                    } else {
                        view.year[at].get(cell)?
                    };
                }
                column.set_year(cell, year)?;
                return Ok(true);
            }
        }
        if ![
            "DrainageElevations",
            "CatchmentArea",
            "FlowAccumulation",
            "PerennialFlow",
            "Runoff",
            "RiverWarmth",
            "DrainageBasinIds",
            "RiverOrders",
            "SmallChannelLength",
            "RiverWidth",
            "RiverDepth",
            "RiverChannelStrength",
        ]
        .contains(&name)
        {
            return Ok(false);
        }
        self.inherit_projections(cell, &|channel| Ok((channel == name).then_some(value)))?;
        Ok(true)
    }
    pub fn inherit_datum(&mut self, base: f64, effective: f64) {
        self.ocean.base_level = base;
        self.ocean.effective_level = effective;
        self.ocean.initialized = true;
    }
    pub fn inherit_resources(
        &mut self,
        cell: usize,
        read: impl Fn(&str) -> io::Result<Option<f64>>,
    ) -> io::Result<()> {
        let value = |name: &str, default: f64| read(name).map(|value| value.unwrap_or(default));
        let captured = CapturedColumn {
            snow: value("SnowPack", 0.0)?.max(0.0),
            soil: value("SoilWater", 0.0)?.max(0.0),
            ground: value("GroundwaterStorage", 0.0)?.max(0.0),
            standing: value("WaterDepths", 0.0)?.max(0.0),
            surface: value("WaterSurfaceElevations", NO_WATER_SURFACE)?,
            kind: value("WaterKindCodes", 0.0)? as u8,
            body: (value("WaterBodyIds", 0.0)? + 0.5).floor() as i32,
        };
        let mut year = [0.0; 14];
        for (month, amount) in year.iter_mut().enumerate() {
            let name = match month {
                12 => "WaterRecharge".into(),
                13 => "SnowKept".into(),
                _ => format!("SurfaceWaterMonth{month}"),
            };
            *amount = value(&name, 0.0)?.max(0.0);
        }
        self.inherit_column(cell, captured, year)?;
        self.inherit_projections(cell, &read)
    }
    fn inherit_projections(
        &mut self,
        cell: usize,
        read: &impl Fn(&str) -> io::Result<Option<f64>>,
    ) -> io::Result<()> {
        for (name, band) in [
            ("DrainageElevations", &mut self.drainage.elevations),
            ("CatchmentArea", &mut self.flow.catchment),
            ("FlowAccumulation", &mut self.flow.mean),
            ("PerennialFlow", &mut self.flow.perennial),
        ] {
            if let Some(value) = read(name)? {
                band.set(cell, value)?;
            }
        }
        if let Some(value) = read("Runoff")? {
            self.runoff.inherit_mean(cell, value)?;
        }
        if let Some(value) = read("RiverWarmth")? {
            self.warmth.inherit(cell, value)?;
        }
        if let Some(value) = read("DrainageBasinIds")? {
            self.routing
                .inherit_basin(cell, (value + 0.5).floor() as i32)?;
        }
        self.projection.inherit(
            cell,
            read("RiverOrders")?.map(|v| v as u32),
            read("SmallChannelLength")?,
        )?;
        self.channels.inherit_dimensions(
            cell,
            [
                read("RiverWidth")?,
                read("RiverDepth")?,
                read("RiverChannelStrength")?,
            ],
        )
    }
}
