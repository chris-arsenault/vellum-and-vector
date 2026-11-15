//! Water columns are inherited and transported as one owner package (water/column.ts).
use super::{
    balance::MONTHS,
    stores::{Capacity, StoreColumn, StoreView},
};
use crate::{
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage, ReadBand},
    transport::{TransportShares, TRANSPORT_WEIGHT_SCALE},
};
use std::{io, rc::Rc};

pub const NO_WATER_SURFACE: f64 = -9_223_372_036_854_775_808.0;
const YEAR_PARTS: usize = MONTHS + 2;
#[derive(Clone, Copy)]
#[repr(usize)]
pub enum Store {
    Snow,
    Soil,
    Ground,
    Standing,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CapturedColumn {
    pub snow: f64,
    pub soil: f64,
    pub ground: f64,
    pub standing: f64,
    pub surface: f64,
    pub kind: u8,
    pub body: i32,
}
pub struct WaterMedium {
    pub elevation: ReadBand<f64>,
    pub soil_capacity: Capacity,
    pub groundwater_capacity: Capacity,
}

// owner-direction(2026-11-12): water gets an actual column of water, carried and inherited as one package.
pub struct WaterColumn {
    stores: [StoreColumn; 4],
    surface: Band<f64>,
    kind: Band<u8>,
    body: Band<i32>,
    elevation: ReadBand<f64>,
    year: [Band<f64>; YEAR_PARTS],
    lake_outlet: Band<i32>,
    lake_overflow: Band<f64>,
    lake_memory: Band<f64>,
}
#[derive(Clone)]
pub struct WaterColumnView {
    stores: [StoreView; 4],
    pub surface: ReadBand<f64>,
    pub kind: ReadBand<u8>,
    pub body: ReadBand<i32>,
    pub year: [ReadBand<f64>; YEAR_PARTS],
    pub lake_outlet: ReadBand<i32>,
    pub lake_overflow: ReadBand<f64>,
    pub lake_memory: ReadBand<f64>,
}
impl crate::execution::QueryValue for WaterColumnView {}
impl WaterColumnView {
    pub fn store(&self, store: Store) -> &StoreView {
        &self.stores[store as usize]
    }
}
impl WaterColumn {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.label("water-column")?;
        for (index, store) in self.stores.iter_mut().enumerate() {
            archive.band(&format!("store-{index}"), &mut store.contents)?;
        }
        archive.band("surface", &mut self.surface)?;
        archive.band("kind", &mut self.kind)?;
        archive.band("body", &mut self.body)?;
        archive.bands("year", &mut self.year)?;
        archive.band("lake-outlet", &mut self.lake_outlet)?;
        archive.band("lake-overflow", &mut self.lake_overflow)?;
        archive.band("lake-memory", &mut self.lake_memory)
    }
    pub(super) fn transport_memory(
        &mut self,
        plan: &crate::transport::scatter::ScalarTransport<'_>,
        scratch: &mut Band<f64>,
    ) -> io::Result<()> {
        plan.apply(
            &mut self.lake_memory,
            crate::transport::quantities::QuantityKind::Share,
            scratch,
        )
    }
    pub fn new(coverage: &mut Coverage, medium: WaterMedium) -> Self {
        let surface = coverage.allocate(NO_WATER_SURFACE);
        let read_surface = surface.read_only();
        let elevation = medium.elevation.clone();
        let standing_capacity: Capacity = Rc::new(move |cell| {
            Ok(MapScale::metres(
                (read_surface.get(cell)? - elevation.get(cell)?).max(0.0),
                LengthUnit::Native,
            ))
        });
        Self {
            stores: [
                StoreColumn::new(
                    coverage.allocate(0.0),
                    Rc::new(|_| Ok(f64::INFINITY)),
                    false,
                    1.0,
                ),
                StoreColumn::new(coverage.allocate(0.0), medium.soil_capacity, true, 1.0),
                StoreColumn::new(
                    coverage.allocate(0.0),
                    medium.groundwater_capacity,
                    false,
                    1.0,
                ),
                StoreColumn::new(
                    coverage.allocate(0.0),
                    standing_capacity,
                    false,
                    MapScale::metres(1.0, LengthUnit::Native),
                ),
            ],
            surface,
            kind: coverage.allocate(0),
            body: coverage.allocate(0),
            elevation: medium.elevation,
            year: std::array::from_fn(|_| coverage.allocate(0.0)),
            lake_outlet: coverage.allocate(-1),
            lake_overflow: coverage.allocate(0.0),
            lake_memory: coverage.allocate(0.0),
        }
    }
    pub fn read_only(&self) -> WaterColumnView {
        WaterColumnView {
            stores: std::array::from_fn(|i| self.stores[i].read_only()),
            surface: self.surface.read_only(),
            kind: self.kind.read_only(),
            body: self.body.read_only(),
            year: std::array::from_fn(|i| self.year[i].read_only()),
            lake_outlet: self.lake_outlet.read_only(),
            lake_overflow: self.lake_overflow.read_only(),
            lake_memory: self.lake_memory.read_only(),
        }
    }
    pub(super) fn store(&mut self, store: Store) -> &mut StoreColumn {
        &mut self.stores[store as usize]
    }
    pub fn put_snow(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        self.store(Store::Snow).replace(cell, depth)
    }
    pub fn put_soil_water(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        self.store(Store::Soil).replace(cell, depth)
    }
    pub fn put_groundwater(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        self.store(Store::Ground).replace(cell, depth)
    }
    pub fn transfer(
        &mut self,
        from: Store,
        to: Store,
        cell: usize,
        request: f64,
    ) -> io::Result<super::stores::Transfer> {
        let given = self.store(from).give(cell, request)?;
        let overflow = self.store(to).receive(cell, given)?;
        Ok(super::stores::Transfer {
            given,
            received: given - overflow,
            overflow,
        })
    }
    pub fn capture(&self, cell: usize) -> io::Result<CapturedColumn> {
        Ok(CapturedColumn {
            snow: self.stores[0].contents.get(cell)?,
            soil: self.stores[1].contents.get(cell)?,
            ground: self.stores[2].contents.get(cell)?,
            standing: self.stores[3].contents.get(cell)?,
            surface: self.surface.get(cell)?,
            kind: self.kind.get(cell)?,
            body: self.body.get(cell)?,
        })
    }
    /// A captured child input is copied whole; no budget or capacity clipping runs here.
    pub fn inherit(&mut self, cell: usize, value: CapturedColumn) -> io::Result<()> {
        for (store, depth) in
            self.stores
                .iter_mut()
                .zip([value.snow, value.soil, value.ground, value.standing])
        {
            store.contents.set(cell, depth)?;
        }
        self.surface.set(cell, value.surface)?;
        self.kind.set(cell, value.kind)?;
        self.body.set(cell, value.body)
    }
    pub fn set_year(&mut self, cell: usize, values: [f64; YEAR_PARTS]) -> io::Result<()> {
        for (band, value) in self.year.iter_mut().zip(values) {
            band.set(cell, value)?;
        }
        Ok(())
    }
    pub fn add_groundwater(&mut self, cell: usize, depth: f64) -> io::Result<()> {
        let store = &mut self.stores[Store::Ground as usize];
        store.replace(cell, store.at(cell)?.held + depth)
    }
    pub fn clear_surface(&mut self, cell: usize) -> io::Result<()> {
        self.stores[Store::Standing as usize]
            .contents
            .set(cell, 0.0)?;
        self.surface.set(cell, NO_WATER_SURFACE)
    }
    pub fn set_surface(&mut self, cell: usize, surface: f64) -> io::Result<()> {
        let depth = surface - self.elevation.get(cell)?;
        if depth <= 0.0 {
            return Err(io::Error::other(
                "Water surface must be above its physical floor",
            ));
        }
        self.surface.set(cell, surface)?;
        self.stores[Store::Standing as usize]
            .contents
            .set(cell, depth)
    }
    pub fn stand(
        &mut self,
        cell: usize,
        kind: StandingKind,
        surface: f64,
        body: Option<i32>,
    ) -> io::Result<()> {
        self.kind.set(cell, kind as u8)?;
        if let Some(body) = body {
            self.body.set(cell, body)?;
        }
        self.set_surface(cell, surface)
    }
    pub fn drain(&mut self, cell: usize) -> io::Result<()> {
        self.kind.set(cell, 0)?;
        self.body.set(cell, 0)?;
        self.clear_surface(cell)
    }
    pub fn clear_standing(&mut self) -> io::Result<()> {
        for cell in 0..self.kind.len() {
            self.drain(cell)?;
        }
        Ok(())
    }
    pub fn reconcile(&mut self, cell: usize) -> io::Result<()> {
        let surface = self.surface.get(cell)?;
        if surface == NO_WATER_SURFACE {
            return Ok(());
        }
        if surface > self.elevation.get(cell)? {
            return self.stores[Store::Standing as usize]
                .contents
                .set(cell, surface - self.elevation.get(cell)?);
        }
        self.lake_outlet.set(cell, -1)?;
        self.lake_overflow.set(cell, 0.0)?;
        self.drain(cell)
    }
    pub fn impound(&mut self, cell: usize, body: i32, crest: f64) -> io::Result<()> {
        self.stand(cell, StandingKind::Lake, crest, Some(body))
    }
    pub fn hold_surface(&mut self, cell: usize, surface: f64) -> io::Result<()> {
        if surface > self.surface.get(cell)? {
            self.surface.set(cell, surface)?;
        }
        Ok(())
    }
    pub fn forget_lake(&mut self, cell: usize) -> io::Result<()> {
        self.lake_memory.set(cell, 0.0)
    }
    pub fn remember_lakes(&mut self) -> io::Result<()> {
        for cell in 0..self.kind.len() {
            if self.kind.get(cell)? == 2 {
                self.lake_memory.set(
                    cell,
                    self.lake_memory
                        .get(cell)?
                        .max(self.stores[Store::Standing as usize].at(cell)?.held),
                )?;
            }
        }
        Ok(())
    }
    pub(super) fn clear_lakes(&mut self) -> io::Result<()> {
        for cell in 0..self.kind.len() {
            self.lake_outlet.set(cell, -1)?;
            self.lake_overflow.set(cell, 0.0)?;
            if self.kind.get(cell)? == 2 {
                self.drain(cell)?;
            }
        }
        Ok(())
    }
    pub(super) fn set_lake_outlet(
        &mut self,
        cell: usize,
        target: i32,
        overflow: f64,
    ) -> io::Result<()> {
        self.lake_outlet.set(cell, target)?;
        self.lake_overflow.set(cell, overflow)
    }
    pub fn carry(
        &mut self,
        shares: &TransportShares,
        coverage: &mut Coverage,
        area: impl Fn(usize) -> f64,
    ) -> io::Result<()> {
        for store in &mut self.stores[..3] {
            carry_depth(&mut store.contents, shares, coverage, &area)?;
        }
        for band in &mut self.year {
            carry_depth(band, shares, coverage, &area)?;
        }
        self.carry_lakes(shares)
    }
    fn carry_lakes(&mut self, shares: &TransportShares) -> io::Result<()> {
        let kind = self.kind.snapshot()?;
        let body = self.body.snapshot()?;
        let standing = self.stores[Store::Standing as usize].contents.snapshot()?;
        let surface = self.surface.snapshot()?;
        for cell in 0..self.kind.len() {
            let Ok(source) = usize::try_from(shares.dominant.get(cell)?) else {
                continue;
            };
            if kind.get(source)? == 1 && kind.get(cell)? == 1 {
                continue;
            }
            if kind.get(source)? == 2 {
                self.kind.set(cell, kind.get(source)?)?;
                self.body.set(cell, body.get(source)?)?;
                self.stores[Store::Standing as usize]
                    .contents
                    .set(cell, standing.get(source)?)?;
                self.surface.set(cell, surface.get(source)?)?;
            } else if kind.get(cell)? == 2 {
                self.drain(cell)?;
            }
        }
        Ok(())
    }
}
#[derive(Clone, Copy)]
#[repr(u8)]
pub enum StandingKind {
    Sea = 1,
    Lake = 2,
}
fn carry_depth(
    values: &mut Band<f64>,
    shares: &TransportShares,
    coverage: &mut Coverage,
    area: &impl Fn(usize) -> f64,
) -> io::Result<()> {
    let mut arriving = coverage.scratch(values.len(), 0.0);
    for source in 0..values.len() {
        let value = values.get(source)?;
        for offset in shares.offsets.get(source)?..shares.offsets.get(source + 1)? {
            let Ok(target) = usize::try_from(shares.targets.get(offset as usize)?) else {
                continue;
            };
            let contribution =
                value * shares.weights.get(offset as usize)? * area(source) / area(target);
            arriving.set(target, arriving.get(target)? + contribution)?;
        }
    }
    for cell in 0..values.len() {
        values.set(cell, arriving.get(cell)? / TRANSPORT_WEIGHT_SCALE)?;
    }
    Ok(())
}
