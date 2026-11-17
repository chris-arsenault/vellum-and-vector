use crate::{
    control::GenerationControl,
    storage::{Band, Coverage},
};
use atlas_map::{Bounds, RasterBand};
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum Resampling {
    Mean,
    Category,
}
pub struct RasterPlane {
    pub definition: RasterBand,
    pub resampling: Resampling,
    pub values: Band<f32>,
}
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterGrid {
    pub width: u32,
    pub height: u32,
    pub bounds: Bounds,
}
impl RasterGrid {
    pub fn count(self) -> io::Result<usize> {
        self.bounds.validate().map_err(io::Error::other)?;
        if self.width == 0 || self.height == 0 {
            return Err(io::Error::other("Empty map raster"));
        }
        (self.width as usize)
            .checked_mul(self.height as usize)
            .ok_or_else(|| io::Error::other("Map raster dimensions exceed address space"))
    }
    pub fn pixel_span(self) -> [f64; 2] {
        [
            (self.bounds.2 - self.bounds.0) / f64::from(self.width),
            (self.bounds.3 - self.bounds.1) / f64::from(self.height),
        ]
    }
}
/// North-first regular map pixels. Generation cells and process identifiers never enter this type.
pub struct MapRaster {
    pub grid: RasterGrid,
    pub coverage: Band<f32>,
    pub planes: Vec<RasterPlane>,
}
impl MapRaster {
    pub fn new(
        grid: RasterGrid,
        definitions: Vec<(RasterBand, Resampling)>,
        storage: &mut Coverage,
    ) -> io::Result<Self> {
        let count = grid.count()?;
        if definitions.is_empty() {
            return Err(io::Error::other("Map raster needs display bands"));
        }
        let planes = definitions
            .into_iter()
            .map(|(definition, resampling)| RasterPlane {
                definition,
                resampling,
                values: storage.scratch(count, 0.0),
            })
            .collect();
        Ok(Self {
            grid,
            coverage: storage.scratch(count, 0.0),
            planes,
        })
    }
    pub fn validate(&self) -> io::Result<()> {
        let count = self.grid.count()?;
        if self.coverage.len() != count
            || self.planes.is_empty()
            || self.planes.iter().any(|plane| plane.values.len() != count)
        {
            return Err(io::Error::other(
                "Map raster bands must cover their declared grid",
            ));
        }
        Ok(())
    }
    /// Area-weighted overview, retaining category labels and fractional edge coverage.
    pub async fn overview(
        &self,
        storage: &mut Coverage,
        control: &impl GenerationControl,
    ) -> io::Result<Self> {
        self.validate()?;
        let grid = RasterGrid {
            width: self.grid.width.div_ceil(2),
            height: self.grid.height.div_ceil(2),
            bounds: self.grid.bounds,
        };
        let mut result = Self::new(
            grid,
            self.planes
                .iter()
                .map(|p| (p.definition.clone(), p.resampling))
                .collect(),
            storage,
        )?;
        for row in 0..grid.height {
            control
                .cooperate()
                .await
                .map_err(|error| io::Error::other(format!("{error:?}")))?;
            for col in 0..grid.width {
                let cell = row as usize * grid.width as usize + col as usize;
                let footprint = Footprint::new(self.grid, grid, col, row);
                let covered = footprint.visit(self, |_, _| Ok(()))?;
                result
                    .coverage
                    .set(cell, (covered / footprint.area()) as f32)?;
                if covered <= 0.0 {
                    continue;
                }
                for (source, target) in self.planes.iter().zip(&mut result.planes) {
                    target
                        .values
                        .set(cell, footprint.read(self, source, covered)?)?;
                }
            }
        }
        result.terrain_overview(storage)?;
        Ok(result)
    }
    fn terrain_overview(&mut self, storage: &mut Coverage) -> io::Result<()> {
        // Finished-map assets namespace each group's bands; standalone terrain
        // publications retain the same band IDs without the channel prefix.
        let find = |id| {
            self.planes.iter().position(|p| {
                p.definition
                    .id
                    .strip_prefix("Elevation:")
                    .unwrap_or(&p.definition.id)
                    == id
            })
        };
        let (Some(height), Some(east), Some(north), Some(span)) = (
            find("display-height"),
            find("east-gradient"),
            find("north-gradient"),
            find("sample-span"),
        ) else {
            return Ok(());
        };
        let count = self.grid.count()?;
        let mut dx = storage.scratch(count, 0.0);
        let mut dy = storage.scratch(count, 0.0);
        super::terrain::gradients(self, height, &mut dx, &mut dy)?;
        self.planes[east].values = dx;
        self.planes[north].values = dy;
        for cell in 0..count {
            self.planes[span]
                .values
                .set(cell, self.grid.pixel_span()[0] as f32)?;
        }
        Ok(())
    }
}
struct Footprint {
    west: f64,
    north: f64,
    east: f64,
    south: f64,
}
impl Footprint {
    fn new(source: RasterGrid, target: RasterGrid, col: u32, row: u32) -> Self {
        let dx = f64::from(source.width) / f64::from(target.width);
        let dy = f64::from(source.height) / f64::from(target.height);
        Self {
            west: f64::from(col) * dx,
            east: f64::from(col + 1) * dx,
            north: f64::from(row) * dy,
            south: f64::from(row + 1) * dy,
        }
    }
    fn area(&self) -> f64 {
        (self.east - self.west) * (self.south - self.north)
    }
    fn visit(
        &self,
        source: &MapRaster,
        mut visit: impl FnMut(usize, f64) -> io::Result<()>,
    ) -> io::Result<f64> {
        let mut covered = 0.0;
        for row in self.north.floor() as u32..(self.south.ceil() as u32).min(source.grid.height) {
            for col in self.west.floor() as u32..(self.east.ceil() as u32).min(source.grid.width) {
                let cell = row as usize * source.grid.width as usize + col as usize;
                let area = (self.east.min(f64::from(col + 1)) - self.west.max(f64::from(col)))
                    * (self.south.min(f64::from(row + 1)) - self.north.max(f64::from(row)));
                let weight = area * f64::from(source.coverage.get(cell)?);
                if weight > 0.0 {
                    covered += weight;
                    visit(cell, weight)?;
                }
            }
        }
        Ok(covered)
    }
    fn read(&self, raster: &MapRaster, plane: &RasterPlane, covered: f64) -> io::Result<f32> {
        let mut sum = 0.0;
        // Halving each dimension overlaps at most nine source pixels; this is not a map-size cap.
        let mut classes = [0.0f32; 9];
        let mut weights = [0.0f64; 9];
        let mut count = 0;
        self.visit(raster, |cell, weight| {
            let value = plane.values.get(cell)?;
            if !value.is_finite() {
                return Err(io::Error::other("Non-finite covered map pixel"));
            }
            if plane.resampling == Resampling::Mean {
                sum += f64::from(value) * weight;
            } else {
                let slot = classes[..count]
                    .iter()
                    .position(|&held| held == value)
                    .unwrap_or_else(|| {
                        let slot = count;
                        classes[slot] = value;
                        count += 1;
                        slot
                    });
                weights[slot] += weight;
            }
            Ok(())
        })?;
        if plane.resampling == Resampling::Mean {
            return Ok((sum / covered) as f32);
        }
        let mut best = 0;
        for slot in 1..count {
            if weights[slot] > weights[best] {
                best = slot;
            }
        }
        Ok(classes[best])
    }
}
