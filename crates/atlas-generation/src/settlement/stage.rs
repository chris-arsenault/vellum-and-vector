//! Deferred source-local commands from coupling/stage.ts. No material moves on submission.
use super::{removal::*, Sharing};
use crate::{
    hpc::RecordQueue,
    lattice::TriangularLattice,
    rock::{load::MaterialLoad, material::MaterialLayer, CompiledMix},
    scale::{LengthUnit, MapScale},
    storage::{Band, Coverage},
};
use std::{collections::BTreeMap, io, rc::Rc};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Pool {
    Rock,
    Soil,
    Loose,
    Load,
    Sea,
    Crust,
    Ice,
    Melt,
    Space,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WearCause {
    pub id: String,
    pub remembers: String,
    pub past_base_level: bool,
}
pub struct SurfaceAction<'a> {
    pub cell: usize,
    pub mix: &'a CompiledMix,
    pub power: f64,
    pub limit: f64,
    pub direction: [f64; 2],
}
pub struct Deposit<'a> {
    pub cell: usize,
    pub amount: f64,
    pub cause: &'a str,
    pub material: &'a MaterialLayer,
}
pub trait StageGround: RemovalGround {
    fn surface_action(&self, action: SurfaceAction<'_>) -> io::Result<[f64; 2]>;
    fn deposit(&mut self, deposit: Deposit<'_>) -> io::Result<f64>;
    fn weather(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<()>;
    fn weather_by(
        &mut self,
        cell: usize,
        forcing: &Forcing,
        power: f64,
        cause: &str,
    ) -> io::Result<()>;
    fn raise_from_crust(&mut self, cell: usize, amount: f64, cause: &str) -> io::Result<()>;
    fn remember(&mut self, band: &str, cell: usize, amount: f64) -> io::Result<()>;
    fn produced(&mut self, volume: f64);
}
#[derive(Clone)]
pub struct Forcing {
    pub mix: Rc<CompiledMix>,
    pub shield_depth: f64,
}
#[derive(Clone, PartialEq, Eq)]
struct RemovalKey {
    from: GroundSource,
    cause: String,
    wear: Option<WearCause>,
    routed: bool,
    facet: Option<Facet>,
    incision: bool,
}
struct RemovalData {
    key: RemovalKey,
    recorded: Option<Band<f64>>,
    routes: RecordQueue<2>,
    cargo: Option<MaterialLoad>,
}
struct Landing {
    from: Pool,
    cause: String,
    amount: Band<f64>,
    forcing: Option<Forcing>,
}

// Arconis: docs/architecture/subsystems.arconis#item=q_stage — queues ground transfers; nothing moves until settled.
pub struct Stage<'a, G> {
    ground: &'a mut G,
    coverage: &'a mut Coverage,
    mesh: &'a TriangularLattice,
    load: &'a mut MaterialLoad,
    sharing: Sharing,
    requests: Vec<RemovalRequest>,
    data: Vec<RemovalData>,
    landings: Vec<Landing>,
}
impl<'a, G: StageGround> Stage<'a, G> {
    pub fn new(
        ground: &'a mut G,
        coverage: &'a mut Coverage,
        mesh: &'a TriangularLattice,
        load: &'a mut MaterialLoad,
        sharing: Sharing,
    ) -> Self {
        Self {
            ground,
            coverage,
            mesh,
            load,
            sharing,
            requests: Vec::new(),
            data: Vec::new(),
            landings: Vec::new(),
        }
    }
    pub fn simultaneous(&self) -> bool {
        matches!(self.sharing, Sharing::Simultaneous)
    }
    pub fn ground(&self) -> &G {
        self.ground
    }
    pub fn mesh(&self) -> &TriangularLattice {
        self.mesh
    }
    fn removal(&mut self, key: RemovalKey) -> usize {
        if let Some(index) = self.data.iter().position(|data| data.key == key) {
            return index;
        }
        let count = self.ground.count();
        let request = RemovalRequest {
            from: key.from,
            cause: key.cause.clone(),
            past_base_level: key.wear.as_ref().is_some_and(|wear| wear.past_base_level),
            facet: key.facet,
            amount: self.coverage.scratch(count, 0.0),
            incision: key.incision.then(|| Incision {
                share: self.coverage.scratch(count, 0.0),
                deepened: self.coverage.scratch(count, 0.0),
            }),
        };
        let index = self.requests.len();
        self.requests.push(request);
        self.data.push(RemovalData {
            recorded: key.wear.as_ref().map(|_| self.coverage.scratch(count, 0.0)),
            cargo: key.routed.then(|| MaterialLoad::new(self.coverage)),
            routes: RecordQueue::default(),
            key,
        });
        index
    }
    fn landing(&mut self, from: Pool, cause: &str, forcing: Option<Forcing>) -> usize {
        let held = self.landings.iter().position(|held| {
            held.from == from && held.cause == cause && same_forcing(&held.forcing, &forcing)
        });
        if let Some(index) = held {
            return index;
        }
        let index = self.landings.len();
        self.landings.push(Landing {
            from,
            cause: cause.into(),
            forcing,
            amount: self.coverage.scratch(self.ground.count(), 0.0),
        });
        index
    }
    pub fn demand(
        &mut self,
        from: Pool,
        to: Pool,
        cell: usize,
        amount: f64,
        cause: &str,
    ) -> io::Result<()> {
        if to == Pool::Load && matches!(from, Pool::Loose | Pool::Rock) {
            if amount > 0.0 {
                let from = if from == Pool::Loose {
                    GroundSource::Loose
                } else {
                    GroundSource::Rock
                };
                let index = self.removal(key(from, cause));
                add(&mut self.requests[index].amount, cell, amount)?;
            }
            return Ok(());
        }
        if !matches!(
            (from, to),
            (Pool::Rock, Pool::Loose) | (Pool::Crust, Pool::Rock)
        ) {
            return Err(io::Error::other("Unsupported stage transfer"));
        }
        if amount > 0.0 {
            let index = self.landing(from, cause, None);
            add(&mut self.landings[index].amount, cell, amount)?;
        }
        Ok(())
    }
    pub fn weather_action(
        &mut self,
        cell: usize,
        forcing: Forcing,
        power: f64,
        cause: &str,
    ) -> io::Result<()> {
        if power > 0.0 {
            let index = self.landing(Pool::Rock, cause, Some(forcing));
            add(&mut self.landings[index].amount, cell, power)?;
        }
        Ok(())
    }
    pub fn wear(
        &mut self,
        cause: &WearCause,
        cell: usize,
        lowering: f64,
        recorded: f64,
    ) -> io::Result<()> {
        if lowering <= 0.0 {
            return Ok(());
        }
        let mut key = key(GroundSource::Surface, &cause.id);
        key.wear = Some(cause.clone());
        let index = self.removal(key);
        add(&mut self.requests[index].amount, cell, lowering)?;
        add(self.data[index].recorded.as_mut().unwrap(), cell, recorded)
    }
    pub fn attack(&mut self, cause: &WearCause, action: SurfaceAction<'_>) -> io::Result<()> {
        let depths = self.ground.surface_action(SurfaceAction { ..action })?;
        for (index, facet) in Facet::ALL.into_iter().enumerate() {
            let amount = depths[index] * self.ground.facet(action.cell, facet)?.share;
            if amount <= 0.0 {
                continue;
            }
            let mut key = key(GroundSource::Surface, &cause.id);
            key.wear = Some(cause.clone());
            key.facet = Some(facet);
            let index = self.removal(key);
            add(&mut self.requests[index].amount, action.cell, amount)?;
            add(
                self.data[index].recorded.as_mut().unwrap(),
                action.cell,
                amount,
            )?;
        }
        Ok(())
    }
    pub fn cut(
        &mut self,
        cause: &WearCause,
        cell: usize,
        depth: f64,
        share: f64,
        remember: bool,
    ) -> io::Result<()> {
        if depth <= 0.0 || share <= 0.0 {
            return Ok(());
        }
        let covered = share.min(1.0);
        let amount = depth * covered;
        let mut key = key(GroundSource::Surface, &cause.id);
        key.wear = Some(cause.clone());
        key.incision = true;
        let index = self.removal(key);
        let request = &mut self.requests[index];
        add(&mut request.amount, cell, amount)?;
        let incision = request.incision.as_mut().unwrap();
        incision
            .share
            .set(cell, incision.share.get(cell)?.max(covered))?;
        if remember {
            add(self.data[index].recorded.as_mut().unwrap(), cell, amount)?;
        }
        Ok(())
    }
    pub fn move_loose(
        &mut self,
        source: usize,
        target: usize,
        volume: f64,
        cause: &str,
    ) -> io::Result<()> {
        self.route(key(GroundSource::Loose, cause), source, target, volume)
    }
    pub fn move_surface(
        &mut self,
        source: usize,
        target: usize,
        volume: f64,
        cause: &str,
        facet: Option<Facet>,
    ) -> io::Result<()> {
        let mut key = key(GroundSource::Surface, cause);
        key.facet = facet;
        self.route(key, source, target, volume)
    }
    fn route(
        &mut self,
        mut key: RemovalKey,
        source: usize,
        target: usize,
        volume: f64,
    ) -> io::Result<()> {
        if volume <= 0.0 {
            return Ok(());
        }
        key.routed = true;
        let index = self.removal(key);
        let depth = MapScale::in_units(volume / self.mesh.area(source), LengthUnit::Native);
        add(&mut self.requests[index].amount, source, depth)?;
        let source = u32::try_from(source)
            .map_err(|_| io::Error::other("Source cell exceeds representation"))?;
        self.data[index]
            .routes
            .push(source, [target as f64, volume]);
        Ok(())
    }
    // Arconis: docs/architecture/subsystems.arconis#item=q_settle — settles queued demand, shared or sequential, and lands it.
    pub fn settle(&mut self) -> io::Result<BTreeMap<String, f64>> {
        let data = &mut self.data;
        let mesh = self.mesh;
        let load = &mut self.load;
        let landed = settle_removals(
            self.ground,
            &mut self.requests,
            self.sharing,
            self.coverage,
            &mut |index, cell, mut material| {
                material.depth =
                    MapScale::metres(material.depth, LengthUnit::Native) * mesh.area(cell);
                match &mut data[index].cargo {
                    Some(cargo) => cargo.add(cell, &material),
                    None => load.add(cell, &material),
                }
            },
        )?;
        let mut moved = BTreeMap::new();
        for (index, actual) in landed.iter().enumerate() {
            self.remember(index, actual, &mut moved)?;
            self.land_routes(index, actual)?;
        }
        for landing in &self.landings {
            land(self.ground, landing)?;
        }
        self.requests.clear();
        self.data.clear();
        self.landings.clear();
        Ok(moved)
    }
    fn remember(
        &mut self,
        index: usize,
        actual: &Band<f64>,
        moved: &mut BTreeMap<String, f64>,
    ) -> io::Result<()> {
        let request = &self.requests[index];
        let data = &self.data[index];
        let mut sum = 0.0;
        for cell in 0..self.ground.count() {
            let taken = actual.get(cell)?;
            sum += taken;
            if taken <= 0.0 {
                continue;
            }
            self.ground
                .produced(MapScale::metres(taken, LengthUnit::Native) * self.mesh.area(cell));
            if let Some(wear) = &data.key.wear {
                let deepened = match &request.incision {
                    Some(incision) => incision.deepened.get(cell)?,
                    None => taken,
                };
                self.ground.remember(
                    &wear.remembers,
                    cell,
                    data.recorded.as_ref().unwrap().get(cell)? * deepened
                        / request.amount.get(cell)?,
                )?;
            }
        }
        *moved.entry(request.cause.clone()).or_default() += sum;
        Ok(())
    }
    fn land_routes(&mut self, index: usize, actual: &Band<f64>) -> io::Result<()> {
        let data = &mut self.data[index];
        let request = &self.requests[index];
        while let Some((source, [target, volume])) = data.routes.pop() {
            let source = source as usize;
            let target = target as usize;
            let offered = volume * actual.get(source)? / request.amount.get(source)?;
            let mut material = data
                .cargo
                .as_ref()
                .expect("Routed request owns its cargo")
                .get(source)?;
            let received = self.ground.deposit(Deposit {
                cell: target,
                cause: &request.cause,
                material: &material,
                amount: MapScale::in_units(offered / self.mesh.area(target), LengthUnit::Native),
            })?;
            let received = MapScale::metres(received, LengthUnit::Native) * self.mesh.area(target);
            if received < offered {
                material.depth = offered - received;
                self.load.add(source, &material)?;
            }
        }
        Ok(())
    }
}
fn add(band: &mut Band<f64>, cell: usize, amount: f64) -> io::Result<()> {
    band.set(cell, band.get(cell)? + amount)
}
fn key(from: GroundSource, cause: &str) -> RemovalKey {
    RemovalKey {
        from,
        cause: cause.into(),
        wear: None,
        routed: false,
        facet: None,
        incision: false,
    }
}
fn same_forcing(a: &Option<Forcing>, b: &Option<Forcing>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => Rc::ptr_eq(&a.mix, &b.mix) && a.shield_depth == b.shield_depth,
        _ => false,
    }
}
fn land(ground: &mut impl StageGround, request: &Landing) -> io::Result<()> {
    for cell in 0..ground.count() {
        let stated = request.amount.get(cell)?;
        let amount = if request.forcing.is_some() {
            stated
        } else {
            stated.round()
        };
        if amount <= 0.0 {
            continue;
        }
        if request.from == Pool::Crust {
            ground.raise_from_crust(cell, amount, &request.cause)?;
        } else if let Some(forcing) = &request.forcing {
            ground.weather_by(cell, forcing, amount, &request.cause)?;
        } else {
            ground.weather(cell, amount, &request.cause)?;
        }
    }
    Ok(())
}
