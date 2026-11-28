use super::{controls, motion, territories};
use crate::{
    chance::Chance,
    lattice::TriangularLattice,
    spatial::{SpatialKernel, SpatialResult},
};

/// How firmly two neighbouring provinces hold together, drawn once for the pair.
fn bond_strength(seed: i32, a: usize, b: usize) -> f64 {
    Chance::of(seed, 0x5c173).spread([a as f64, b as f64], 0.6, 0.8)
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Province {
    pub position: [f64; 2],
    pub priority: f64,
    pub assembly: usize,
    pub ocean_plate: usize,
    pub motion: [f64; 2],
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Site {
    pub province: Province,
    pub id: usize,
    pub plate: usize,
    pub origin: [f64; 2],
    pub drive: [f64; 2],
    pub mass: f64,
    pub area: f64,
    pub compliance: f64,
    pub block: usize,
    pub pull: [f64; 2],
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Plate {
    pub id: usize,
    pub position: [f64; 2],
    pub motion: [f64; 2],
    pub spin: f64,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Bond {
    pub a: usize,
    pub b: usize,
    pub strength: f64,
    pub extension: f64,
    pub shortening: f64,
    pub broken: bool,
    pub active: bool,
    pub suture: bool,
}
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub enum TransitionKind {
    Split,
    Weld,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Transition {
    pub kind: TransitionKind,
    pub at_myr: f64,
    pub plates: Vec<usize>,
    pub sites: Vec<usize>,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct State {
    pub sites: Vec<Site>,
    pub plates: Vec<Plate>,
    pub bonds: Vec<Bond>,
    pub next_plate_id: usize,
    pub elapsed_myr: f64,
    pub splits: usize,
    pub welds: usize,
    pub sunk: usize,
    pub rate: f64,
    pub seed: i32,
    pub transitions: Vec<Transition>,
    #[serde(skip)]
    bond_lookup: Vec<Option<usize>>,
}
pub fn plate_of(mesh: &TriangularLattice, sites: &[Site], id: usize) -> Plate {
    let members: Vec<_> = sites.iter().filter(|site| site.plate == id).collect();
    let root = members[0].province.position;
    let mass: f64 = members.iter().map(|s| s.mass).sum();
    let mean = |value: &dyn Fn(&Site) -> f64| {
        members.iter().map(|s| value(s) * s.mass).sum::<f64>() / mass
    };
    Plate {
        id,
        position: mesh.point(
            root[0] + mean(&|s| mesh.delta_x(s.province.position[0] - root[0])),
            mean(&|s| s.province.position[1]),
        ),
        motion: [
            mean(&|s| s.province.motion[0]),
            mean(&|s| s.province.motion[1]),
        ],
        spin: 0.0,
    }
}
impl State {
    pub fn new(
        mesh: &TriangularLattice,
        kernel: &dyn SpatialKernel,
        sites: Vec<Site>,
        seed: i32,
        rate: f64,
    ) -> SpatialResult<Self> {
        if sites.is_empty() {
            return Err("Tectonic state requires provinces".into());
        }
        let mut ids = Vec::new();
        for site in &sites {
            if !ids.contains(&site.plate) {
                ids.push(site.plate);
            }
        }
        let plates = ids.iter().map(|&id| plate_of(mesh, &sites, id)).collect();
        let positions: Vec<_> = sites.iter().map(|s| s.province.position).collect();
        let adjacent =
            territories::adjacency(kernel, &positions, mesh.periodic_width().unwrap_or(0.0))?;
        let mut bonds = Vec::new();
        for a in 0..sites.len() {
            for b in a + 1..sites.len() {
                if adjacent[a * sites.len() + b] == 0 {
                    continue;
                }
                let (first, second) = (&sites[a].province, &sites[b].province);
                let craton = first.assembly > 0 && first.assembly == second.assembly
                    || first.ocean_plate > 0 && first.ocean_plate == second.ocean_plate;
                bonds.push(Bond {
                    a,
                    b,
                    strength: bond_strength(seed, a, b)
                        * if craton {
                            controls::CONTINENT_BOND_STRENGTH
                        } else {
                            1.0
                        },
                    extension: 0.0,
                    shortening: 0.0,
                    broken: false,
                    active: true,
                    suture: false,
                });
            }
        }
        let mut state = Self {
            sites,
            plates,
            bonds,
            next_plate_id: ids.into_iter().max().unwrap() + 1,
            elapsed_myr: 0.0,
            splits: 0,
            welds: 0,
            sunk: 0,
            rate,
            seed,
            transitions: Vec::new(),
            bond_lookup: Vec::new(),
        };
        state.index_bonds()?;
        motion::refresh_site_motion(mesh, &mut state);
        Ok(state)
    }
    pub fn index_bonds(&mut self) -> SpatialResult<()> {
        let n = self.sites.len();
        self.bond_lookup = vec![
            None;
            n.checked_mul(n)
                .ok_or("Tectonic bond lookup exceeds address space")?
        ];
        for (i, bond) in self.bonds.iter().enumerate() {
            self.bond_lookup[bond.a * n + bond.b] = Some(i);
            self.bond_lookup[bond.b * n + bond.a] = Some(i);
        }
        Ok(())
    }
    pub fn bond(&self, a: usize, b: usize) -> Option<&Bond> {
        self.bond_lookup[a * self.sites.len() + b].map(|i| &self.bonds[i])
    }
    pub fn refresh_contacts(
        &mut self,
        mesh: &TriangularLattice,
        kernel: &dyn SpatialKernel,
    ) -> SpatialResult<()> {
        let n = self.sites.len();
        let positions: Vec<_> = self.sites.iter().map(|s| s.province.position).collect();
        let adjacent =
            territories::adjacency(kernel, &positions, mesh.periodic_width().unwrap_or(0.0))?;
        self.index_bonds()?;
        for bond in &mut self.bonds {
            bond.active = false;
        }
        for a in 0..n {
            for b in a + 1..n {
                if adjacent[a * n + b] == 0 {
                    continue;
                }
                if let Some(index) = self.bond_lookup[a * n + b] {
                    self.bonds[index].active = true;
                } else {
                    self.bonds.push(Bond {
                        a,
                        b,
                        strength: bond_strength(self.seed, a, b),
                        extension: 0.0,
                        shortening: 0.0,
                        broken: true,
                        active: true,
                        suture: false,
                    });
                }
            }
        }
        self.index_bonds()
    }
    pub fn move_sites(&mut self, mesh: &TriangularLattice, distance: f64) {
        for site in &mut self.sites {
            let plate = self
                .plates
                .iter()
                .find(|p| p.id == site.plate)
                .expect("Site plate exists");
            let [x, y] = motion::move_point(mesh, site, plate, site.province.position, distance);
            site.province.position = mesh.point(x, y);
        }
        for plate in &mut self.plates {
            plate.position = plate_of(mesh, &self.sites, plate.id).position;
        }
        motion::refresh_site_motion(mesh, self);
    }
}
