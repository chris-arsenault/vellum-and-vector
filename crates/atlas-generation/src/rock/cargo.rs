//! Material-owned sparse cargo and detached parcels retain reservoir and constituent identity.
use crate::{
    hpc::IntPairIndex,
    storage::{Band, Coverage},
};
use std::io;

/// Detached parcel-local columns, never one object or reservoir allocation per map cell.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MaterialCargo {
    keys: Vec<i32>,
    hosts: Vec<i32>,
    densities: Vec<f64>,
}
impl MaterialCargo {
    pub fn from_entries(entries: impl IntoIterator<Item = (i32, i32, f64)>) -> Self {
        let mut result = Self::default();
        for (key, host, density) in entries {
            result.push(key, host, density);
        }
        result
    }
    fn push(&mut self, key: i32, host: i32, density: f64) {
        self.keys.push(key);
        self.hosts.push(host);
        self.densities.push(density);
    }
    pub fn len(&self) -> usize {
        self.keys.len()
    }
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }
    pub fn entries(&self) -> impl DoubleEndedIterator<Item = (i32, i32, f64)> + '_ {
        self.keys
            .iter()
            .zip(&self.hosts)
            .zip(&self.densities)
            .map(|((&key, &host), &density)| (key, host, density))
    }
    pub fn map_keys(&self, key_at: impl Fn(i32) -> i32) -> Option<Self> {
        if self.keys.iter().all(|&key| key_at(key) == key) {
            return Some(self.clone());
        }
        let mut mixture = CargoMixture::default();
        for (key, host, density) in self.entries() {
            mixture.add_entry(key_at(key), host, density);
        }
        mixture.finish(1.0)
    }
    pub fn without(&self, key: i32) -> Self {
        Self::from_entries(self.entries().filter(|(held, _, _)| *held != key))
    }
    pub fn rekey(&self, from: i32, to: i32, share: f64) -> Option<Self> {
        let mut mixture = CargoMixture::default();
        for (key, host, density) in self.entries() {
            let fraction = if key == from {
                share.clamp(0.0, 1.0)
            } else {
                0.0
            };
            mixture.add_entry(key, host, density * (1.0 - fraction));
            if fraction > 0.0 {
                mixture.add_entry(to, host, density * fraction);
            }
        }
        mixture.finish(1.0)
    }
    /// Coarsening loses minor constituent identities; their cargo belongs to the aggregate.
    pub fn aggregate_hosts(&self, a: i32, b: i32) -> Option<Self> {
        if self
            .hosts
            .iter()
            .all(|&host| host == 0 || host == a || host == b)
        {
            return Some(self.clone());
        }
        let mut mixture = CargoMixture::default();
        for (key, host, density) in self.entries() {
            mixture.add_entry(key, if host == a || host == b { host } else { 0 }, density);
        }
        mixture.finish(1.0)
    }
    /// Selective extraction takes constituent cargo; aggregate cargo follows the parcel share.
    pub fn partition(&self, kind: i32, host_share: f64, taken_share: f64) -> CargoPartition {
        let mut taken = Self::default();
        let mut remaining = Self::default();
        for (key, host, density) in self.entries() {
            let share = if host == kind {
                taken_share / host_share
            } else if host == 0 {
                taken_share
            } else {
                0.0
            };
            let lost = density * share;
            if lost > 0.0 {
                taken.push(key, host, lost / taken_share);
            }
            if taken_share < 1.0 && density > lost {
                remaining.push(key, host, (density - lost) / (1.0 - taken_share));
            }
        }
        CargoPartition {
            taken: nonempty(taken),
            remaining: nonempty(remaining),
        }
    }
    /// Unrepresented basement supplies ordinary rock, never an infinite charged inventory.
    pub fn finite_slice(
        &self,
        represented_depth: f64,
        depth: f64,
        basement: bool,
        offset: f64,
    ) -> Option<Self> {
        if !basement || offset + depth <= represented_depth - 1.0 {
            return Some(self.clone());
        }
        let share = (represented_depth - 1.0 - offset).min(depth).max(0.0) / depth;
        if share <= 0.0 {
            return None;
        }
        Some(Self::from_entries(
            self.entries()
                .map(|(key, host, density)| (key, host, density * share)),
        ))
    }
}
fn nonempty(cargo: MaterialCargo) -> Option<MaterialCargo> {
    (!cargo.is_empty()).then_some(cargo)
}
pub struct CargoPartition {
    pub taken: Option<MaterialCargo>,
    pub remaining: Option<MaterialCargo>,
}

#[derive(Default)]
pub struct CargoMixture {
    pairs: IntPairIndex,
    amounts: Vec<f64>,
}
impl CargoMixture {
    pub fn clear(&mut self) {
        self.pairs.clear();
        self.amounts.clear();
    }
    pub fn add(&mut self, cargo: Option<&MaterialCargo>, weight: f64) {
        if weight <= 0.0 {
            return;
        }
        if let Some(cargo) = cargo {
            for (key, host, density) in cargo.entries() {
                self.add_entry(key, host, density * weight);
            }
        }
    }
    pub fn add_entry(&mut self, key: i32, host: i32, amount: f64) {
        if amount <= 0.0 || amount.is_nan() {
            return;
        }
        let at = self.pairs.include(key, host);
        if at == self.amounts.len() {
            self.amounts.push(amount);
        } else {
            self.amounts[at] += amount;
        }
    }
    pub fn finish(&self, weight: f64) -> Option<MaterialCargo> {
        if self.pairs.is_empty() || weight <= 0.0 {
            return None;
        }
        Some(MaterialCargo::from_entries((0..self.pairs.len()).map(
            |i| {
                let (key, host) = self.pairs.pair(i);
                (key, host, self.amounts[i] / weight)
            },
        )))
    }
}
pub fn blend(
    a: Option<&MaterialCargo>,
    b: Option<&MaterialCargo>,
    wa: f64,
    wb: f64,
) -> Option<MaterialCargo> {
    let mut mixture = CargoMixture::default();
    mixture.add(a, wa);
    mixture.add(b, wb);
    mixture.finish(wa + wb)
}

/// Exclusive sparse chains per material slot. Snapshots never share mutable records.
/// ```compile_fail
/// use atlas_generation::rock::cargo::CargoStore;
/// fn bypass(store:&mut CargoStore) {store.heads.set(0,12);}
/// ```
pub struct CargoStore {
    heads: Band<u32>,
    keys: Vec<i32>,
    hosts: Vec<i32>,
    densities: Vec<f64>,
    next: Vec<u32>,
    free: u32,
}
impl CargoStore {
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut crate::checkpoint::Archive<'_>,
    ) -> io::Result<()> {
        archive.band("cargo-heads", &mut self.heads)?;
        archive.value("cargo-keys", &mut self.keys)?;
        archive.value("cargo-hosts", &mut self.hosts)?;
        archive.value("cargo-densities", &mut self.densities)?;
        archive.value("cargo-next", &mut self.next)?;
        archive.value("cargo-free", &mut self.free)
    }
    pub(super) fn has(&self, slot: usize) -> io::Result<bool> {
        Ok(self.heads.get(slot)? != 0)
    }
    pub fn new(coverage: &mut Coverage, slots: usize) -> Self {
        let mut heads = coverage.scratch(slots, 0_u32);
        heads.retain();
        Self {
            heads,
            keys: Vec::new(),
            hosts: Vec::new(),
            densities: Vec::new(),
            next: Vec::new(),
            free: 0,
        }
    }
    pub fn density(&self, slot: usize, key: i32, host: Option<i32>) -> io::Result<f64> {
        let mut density = 0.0;
        let mut head = self.heads.get(slot)?;
        while head != 0 {
            let i = head as usize - 1;
            if self.keys[i] == key && host.is_none_or(|host| self.hosts[i] == host) {
                density += self.densities[i];
            }
            head = self.next[i];
        }
        Ok(density)
    }
    pub fn get(&self, slot: usize) -> io::Result<Option<MaterialCargo>> {
        let mut cargo = MaterialCargo::default();
        let mut head = self.heads.get(slot)?;
        while head != 0 {
            let i = head as usize - 1;
            cargo.push(self.keys[i], self.hosts[i], self.densities[i]);
            head = self.next[i];
        }
        Ok(nonempty(cargo))
    }
    pub fn set(&mut self, slot: usize, cargo: Option<&MaterialCargo>) -> io::Result<()> {
        self.clear(slot)?;
        let mut head = 0;
        if let Some(cargo) = cargo {
            for (key, host, density) in cargo.entries().rev() {
                if density <= 0.0 || density.is_nan() {
                    continue;
                }
                let i = self.allocate()?;
                self.keys[i] = key;
                self.hosts[i] = host;
                self.densities[i] = density;
                self.next[i] = head;
                head = (i + 1) as u32;
                // Keep ownership visible even if subsequent allocation or scratch IO fails.
                self.heads.set(slot, head)?;
            }
        }
        Ok(())
    }
    pub fn clear(&mut self, slot: usize) -> io::Result<()> {
        let mut head = self.heads.get(slot)?;
        self.heads.set(slot, 0)?;
        while head != 0 {
            let i = head as usize - 1;
            let next = self.next[i];
            self.next[i] = self.free;
            self.free = head;
            head = next;
        }
        Ok(())
    }
    fn allocate(&mut self) -> io::Result<usize> {
        if self.free != 0 {
            let i = self.free as usize - 1;
            self.free = self.next[i];
            return Ok(i);
        }
        let i = self.keys.len();
        u32::try_from(i + 1)
            .map_err(|_| io::Error::other("Cargo chain exceeds its index representation"))?;
        self.keys.push(0);
        self.hosts.push(0);
        self.densities.push(0.0);
        self.next.push(0);
        Ok(i)
    }
    pub fn snapshot(&self, coverage: &mut Coverage) -> io::Result<Self> {
        Ok(Self {
            heads: coverage.copy_band(&self.heads)?,
            keys: self.keys.clone(),
            hosts: self.hosts.clone(),
            densities: self.densities.clone(),
            next: self.next.clone(),
            free: self.free,
        })
    }
}
