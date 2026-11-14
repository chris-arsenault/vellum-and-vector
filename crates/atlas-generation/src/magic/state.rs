use super::{
    channels::{Channel, Channels},
    configuration::{Carrier, ResolvedSystem, Source},
    inventory::{hosts, Inventory},
};
use crate::{
    lattice::{Membership, TriangularLattice},
    rock::{
        ground::{Ground, InventoryAccess},
        load::MaterialLoad,
    },
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage, ReadBand},
    transport::{TransportShares, TRANSPORT_WEIGHT_SCALE},
};
use std::io;
#[derive(Clone)]
pub struct LocatedSource {
    pub origin: String,
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub strength: f64,
}
#[derive(Clone, Copy)]
pub struct Door {
    pub a: usize,
    pub b: usize,
}
pub struct DrawRequest<'a> {
    pub reservoir: &'a str,
    pub cell: usize,
    pub amount: f64,
}
pub struct OriginState {
    pub(super) source: Band<f64>,
    pub(super) inherited_sites: Option<Vec<i32>>,
    pub(super) stocks: Vec<Inventory>,
}
pub struct FeatureState {
    pub(super) members: Band<f64>,
    pub(super) coverage: Band<f64>,
}
pub struct MagicField {
    pub(super) channels: Channels,
    pub(super) definition: ResolvedSystem,
    pub(super) origins: Vec<OriginState>,
    pub(super) located: Vec<LocatedSource>,
    // hpc-exempt: impact event identities, never a cell-indexed numerical collection.
    pub(super) seeded: std::collections::BTreeSet<String>,
    pub(super) supplied_epoch: i32,
    pub(super) lost: f64,
    pub(super) drawn: Band<f64>,
    pub(super) fresh: Band<f64>,
    pub(super) doors: Vec<Door>,
    pub(super) features: Vec<FeatureState>,
    pub(super) system_coverage: Band<f64>,
    pub(super) parents: Option<Band<i32>>,
    pub(super) wake_paths: Vec<Vec<[f64; 2]>>,
}
impl MagicField {
    pub fn new(
        definition: ResolvedSystem,
        coverage: &mut Coverage,
        ground: &mut Ground,
    ) -> io::Result<Self> {
        let mut origins = Vec::new();
        for origin in &definition.origins {
            let hosted = !matches!(
                origin.source,
                Source::Strain | Source::Pairing | Source::Tenure | Source::KeptLine
            );
            let mut stocks = Vec::new();
            for stock in &origin.stocks {
                stocks.push(
                    if hosted && hosts(&definition.id, &stock.reservoir).is_some() {
                        Inventory::Ground(ground.inventory(
                            &format!("{}:{}/{}", definition.id, origin.id, stock.id),
                            None,
                        )?)
                    } else {
                        Inventory::Mobile(coverage.allocate(0.0))
                    },
                );
            }
            origins.push(OriginState {
                source: coverage.allocate(0.0),
                inherited_sites: None,
                stocks,
            });
        }
        let features = definition
            .features
            .iter()
            .map(|_| FeatureState {
                members: coverage.allocate(0.0),
                coverage: coverage.allocate(0.0),
            })
            .collect();
        Ok(Self {
            definition,
            channels: Channels::new(coverage),
            origins,
            located: vec![],
            seeded: Default::default(),
            supplied_epoch: -1,
            lost: 0.0,
            drawn: coverage.allocate(0.0),
            fresh: coverage.allocate(0.0),
            doors: vec![],
            features,
            system_coverage: coverage.allocate(0.0),
            parents: None,
            wake_paths: vec![],
        })
    }
    pub fn definition(&self) -> &ResolvedSystem {
        &self.definition
    }
    pub(super) fn reservoir_index(&self, reservoir: &str) -> Option<(usize, usize)> {
        self.definition
            .origins
            .iter()
            .enumerate()
            .find_map(|(origin, definition)| {
                definition
                    .stocks
                    .iter()
                    .position(|stock| stock.reservoir == reservoir)
                    .map(|stock| (origin, stock))
            })
    }
    pub fn channel(&self, channel: Channel) -> ReadBand<f64> {
        self.channels.view(channel)
    }
    pub fn located(&self) -> &[LocatedSource] {
        &self.located
    }
    pub fn doors(&self) -> &[Door] {
        &self.doors
    }
    /// Captured named endpoints are candidates; the next shared pairing applies current eligibility.
    pub fn seed_door(&mut self, a: usize, b: usize) {
        self.doors.push(Door { a, b });
    }
    pub fn parents(&self) -> Option<ReadBand<i32>> {
        self.parents.as_ref().map(Band::read_only)
    }
    pub fn wake_paths(&self) -> &[Vec<[f64; 2]>] {
        &self.wake_paths
    }
    pub fn supplied_epoch(&self) -> i32 {
        self.supplied_epoch
    }
    pub fn seeded(&self, id: &str) -> bool {
        self.seeded.contains(id)
    }
    pub fn origin_source(&self, origin: usize) -> ReadBand<f64> {
        self.origins[origin].source.read_only()
    }
    pub fn inherited_sites(&self, origin: usize) -> Option<&[i32]> {
        self.origins[origin].inherited_sites.as_deref()
    }
    pub fn feature(&self, index: usize) -> (ReadBand<f64>, ReadBand<f64>) {
        (
            self.features[index].members.read_only(),
            self.features[index].coverage.read_only(),
        )
    }
    pub fn coverage(&self) -> ReadBand<f64> {
        self.system_coverage.read_only()
    }
    pub fn reservoir_amount(
        &self,
        ground: &Ground,
        reservoir: &str,
        cell: usize,
    ) -> io::Result<f64> {
        let mut amount = 0.0;
        for (origin, state) in self.definition.origins.iter().zip(&self.origins) {
            for (stock, values) in origin.stocks.iter().zip(&state.stocks) {
                if stock.reservoir == reservoir {
                    amount += values.get(ground, cell)?;
                }
            }
        }
        Ok(amount)
    }
    pub fn stock_amount(&self, ground: &Ground, key: &str, cell: usize) -> io::Result<f64> {
        let Some((origin_id, stock_id)) = key.split_once('/') else {
            return Ok(0.0);
        };
        for (origin, state) in self.definition.origins.iter().zip(&self.origins) {
            if origin.id != origin_id {
                continue;
            }
            for (stock, values) in origin.stocks.iter().zip(&state.stocks) {
                if stock.id == stock_id {
                    return values.get(ground, cell);
                }
            }
        }
        Ok(0.0)
    }
    /// The exposed stock per area used by feature conditions, including origin burial settings.
    pub fn stock_reading(
        &self,
        ground: &Ground,
        mesh: &TriangularLattice,
        key: &str,
        cell: usize,
    ) -> io::Result<f64> {
        for (origin_index, origin) in self.definition.origins.iter().enumerate() {
            for (stock_index, stock) in origin.stocks.iter().enumerate() {
                if key != format!("{}/{}", origin.id, stock.id) {
                    continue;
                }
                let burial = self.origin_parameters(origin_index).bury_depth;
                let amount = match &self.origins[origin_index].stocks[stock_index] {
                    Inventory::Ground(key) => {
                        ground.inventory_reached(*key, cell, MapScale::native(burial))?
                    }
                    Inventory::Mobile(values) => {
                        values.get(cell)?
                            * match hosts(&self.definition.id, &stock.reservoir) {
                                Some(kinds) => {
                                    super::inventory::exposure(ground, cell, burial, Some(kinds))?
                                }
                                None => 1.0,
                            }
                    }
                };
                return Ok(amount / mesh.area(cell));
            }
        }
        Ok(0.0)
    }
    pub fn drawn(&self) -> ReadBand<f64> {
        self.drawn.read_only()
    }
    pub fn draw_reservoir(
        &mut self,
        ground: &mut Ground,
        load: &mut MaterialLoad,
        mesh: &TriangularLattice,
        request: DrawRequest<'_>,
    ) -> io::Result<f64> {
        let DrawRequest {
            reservoir,
            cell,
            amount,
        } = request;
        let mut available = 0.0;
        for (origin, state) in self.definition.origins.iter().zip(&self.origins) {
            for (stock, values) in origin.stocks.iter().zip(&state.stocks) {
                if stock.reservoir == reservoir {
                    available += values.get(ground, cell)?.max(0.0);
                }
            }
        }
        if available <= 0.0 || amount <= 0.0 {
            return Ok(0.0);
        }
        let drawn = amount.min(available);
        let mut removed = 0.0;
        for (origin, state) in self.definition.origins.iter().zip(&mut self.origins) {
            for (stock, values) in origin.stocks.iter().zip(&mut state.stocks) {
                if stock.reservoir != reservoir {
                    continue;
                }
                let held = values.get(ground, cell)?;
                if held <= 0.0 {
                    continue;
                }
                let request = drawn * held / available;
                removed += match values {
                    Inventory::Ground(key) => ground.inventory_extract(
                        *key,
                        cell,
                        request,
                        &InventoryAccess {
                            reach: MapScale::native(self.definition.parameters.bury_depth),
                            surface_only: false,
                            loose_only: false,
                        },
                        &mut |mut parcel| {
                            parcel.depth = MapScale::metres(parcel.depth, LengthUnit::Native)
                                * mesh.area(cell);
                            load.add(cell, &parcel)
                        },
                    )?,
                    Inventory::Mobile(band) => {
                        band.set(cell, held - request)?;
                        request
                    }
                };
            }
        }
        self.lost += removed;
        if reservoir == "aquifer" {
            self.drawn.set(cell, self.drawn.get(cell)? + removed)?;
        }
        Ok(removed)
    }
    pub fn deposit_reservoir(
        &mut self,
        ground: &mut Ground,
        mesh: &TriangularLattice,
        reservoir: &str,
        cell: usize,
        amount: f64,
    ) -> io::Result<f64> {
        if amount <= 0.0 {
            return Ok(0.0);
        }
        for (origin, state) in self.definition.origins.iter().zip(&mut self.origins) {
            for (stock, values) in origin.stocks.iter().zip(&mut state.stocks) {
                if stock.reservoir != reservoir {
                    continue;
                }
                if reservoir == "bed" && self.definition.effects.salting > 0.0 {
                    values.deposit_salt(
                        ground,
                        cell,
                        amount,
                        mesh.area(cell),
                        self.definition.parameters.salt_material_density,
                    )?;
                } else {
                    values.add(ground, cell, amount)?;
                }
                self.lost -= amount;
                return Ok(amount);
            }
        }
        Ok(0.0)
    }
    pub fn advect(
        &mut self,
        dominant: &ReadBand<i32>,
        transport: Option<&TransportShares>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        if !self.definition.history.advect {
            return Ok(());
        }
        self.carry_history(dominant)?;
        if let Some(transport) = transport {
            self.carry_stocks(transport, coverage)?;
        }
        Ok(())
    }
    fn carry_history(&mut self, dominant: &ReadBand<i32>) -> io::Result<()> {
        for &channel in Channel::ALL {
            let definition = channel.definition();
            if !definition.carried {
                continue;
            }
            let previous = self.channels.band(channel).snapshot()?;
            let values = self.channels.band_mut(channel);
            for cell in 0..values.len() {
                let source = dominant.get(cell)?;
                values.set(
                    cell,
                    if source >= 0 {
                        previous.get(source as usize)?
                    } else {
                        definition.initial
                    },
                )?;
            }
        }
        Ok(())
    }
    fn carry_stocks(
        &mut self,
        transport: &TransportShares,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        for (origin, state) in self.definition.origins.iter().zip(&mut self.origins) {
            for (stock, values) in origin.stocks.iter().zip(&mut state.stocks) {
                if !stock
                    .carriers
                    .iter()
                    .any(|c| matches!(c, Carrier::Crust | Carrier::Groundwater))
                {
                    continue;
                }
                let Inventory::Mobile(values) = values else {
                    continue;
                };
                carry_amount(values, transport, coverage)?;
            }
        }
        Ok(())
    }
    pub fn budget(&self, ground: &Ground, mesh: &TriangularLattice) -> io::Result<Budget> {
        let mut budget = Budget {
            lost: self.lost,
            ..Budget::default()
        };
        for cell in 0..mesh.len() {
            if mesh.membership(cell) != Membership::Content {
                continue;
            }
            let area = mesh.area(cell);
            budget.created += self.channels.band(Channel::Source).get(cell)? * area;
            budget.stored += self.channels.band(Channel::Stored).get(cell)? * area;
            budget.released += self.channels.band(Channel::Intensity).get(cell)? * area;
            for state in &self.origins {
                for stock in &state.stocks {
                    budget.carried += stock.get(ground, cell)?;
                }
            }
        }
        Ok(budget)
    }
    pub fn fresh(&self) -> ReadBand<f64> {
        self.fresh.read_only()
    }
}
fn carry_amount(
    values: &mut Band<f64>,
    transport: &TransportShares,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let mut moved = coverage.scratch(values.len(), 0.0);
    for source in 0..values.len() {
        let amount = values.get(source)?;
        if amount == 0.0 {
            continue;
        }
        for offset in transport.offsets.get(source)?..transport.offsets.get(source + 1)? {
            let target = transport.targets.get(offset as usize)?;
            if target < 0 {
                continue;
            }
            let target = target as usize;
            moved.set(
                target,
                moved.get(target)?
                    + amount * transport.weights.get(offset as usize)? / TRANSPORT_WEIGHT_SCALE,
            )?;
        }
    }
    for cell in 0..values.len() {
        values.set(cell, moved.get(cell)?)?;
    }
    Ok(())
}
#[derive(Default)]
pub struct Budget {
    pub created: f64,
    pub carried: f64,
    pub stored: f64,
    pub released: f64,
    pub lost: f64,
}
/// JS iterates code points, then charCodeAt(0) takes the first UTF-16 unit of each.
pub fn system_seed(mut seed: i32, id: &str) -> i32 {
    for character in id.chars() {
        let mut units = [0; 2];
        seed = (seed ^ i32::from(character.encode_utf16(&mut units)[0])).wrapping_mul(16_777_619);
    }
    seed
}
