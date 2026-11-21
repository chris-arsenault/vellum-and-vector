use atlas_generation::{
    execution::Executor,
    human::{catalogue::*, identity::*, operations::*, HumanField as F, HumanLayers, HumanSeed},
    lattice::WorldLatticeOptions,
    storage::*,
};
use atlas_map::Bounds;
use std::{io, rc::Rc};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
#[derive(Default)]
struct File(Vec<u8>);
impl RandomAccessFile for File {
    fn read(&mut self, into: &mut [u8], offset: u64) -> io::Result<usize> {
        let offset = offset as usize;
        let count = into.len().min(self.0.len().saturating_sub(offset));
        if count > 0 {
            into[..count].copy_from_slice(&self.0[offset..offset + count]);
        }
        Ok(count)
    }
    fn write(&mut self, bytes: &[u8], offset: u64) -> io::Result<usize> {
        let offset = offset as usize;
        self.0.resize(self.0.len().max(offset + bytes.len()), 0);
        self.0[offset..offset + bytes.len()].copy_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
struct State {
    layers: HumanLayers,
    coverage: Coverage,
}
struct Fixture {
    runtime: Executor<State>,
    ops: Operations<State>,
    cells: Vec<usize>,
    floats: Vec<Band<f64>>,
    integers: Vec<Band<i32>>,
    mesh: Rc<atlas_generation::lattice::TriangularLattice>,
}
impl Fixture {
    fn new() -> Self {
        let mesh = Rc::new(
            WorldLatticeOptions::default()
                .build(Bounds(0.0, 0.0, 1000.0, 1000.0), 16.0, 0.0, |_, _| true)
                .unwrap(),
        );
        let mut coverage = Coverage::new(
            mesh.clone(),
            BlockCache::new(1_000_000, BlockScratch::new(File::default())),
        );
        let seed = HumanSeed::new(&mut coverage);
        let layers = HumanLayers::new(seed, mesh.clone());
        Self {
            runtime: Executor::new(State { layers, coverage }),
            ops: Operations::new(|state| (&mut state.layers, &mut state.coverage)),
            cells: (0..mesh.len()).collect(),
            floats: Vec::new(),
            integers: Vec::new(),
            mesh,
        }
    }
    fn values(&mut self, samples: &[(usize, f64)]) -> ReadBand<f64> {
        let mut band = Band::new(
            self.mesh.len(),
            0.0,
            BlockCache::new(1_000_000, BlockScratch::new(File::default())),
        );
        for &(index, value) in samples {
            band.set(self.cells[index], value).unwrap();
        }
        let read = band.read_only();
        self.floats.push(band);
        read
    }
    fn codes(&mut self, samples: &[(usize, i32)]) -> ReadBand<i32> {
        let mut band = Band::new(
            self.mesh.len(),
            0,
            BlockCache::new(1_000_000, BlockScratch::new(File::default())),
        );
        for &(index, value) in samples {
            band.set(self.cells[index], value).unwrap();
        }
        let read = band.read_only();
        self.integers.push(band);
        read
    }
    fn lay(&mut self, kind: LayerId, samples: &[(usize, f64)]) {
        let amount = self.values(samples);
        self.runtime
            .run_with(&self.ops.lay, &Lay { kind, amount })
            .unwrap();
    }
    fn tongue(&mut self, cell: usize, code: i32, people: f64) {
        let codes = self.codes(&[(cell, code)]);
        let people = self.values(&[(cell, people)]);
        let mut traditions = std::array::from_fn(|_| None);
        traditions[0] = Some(codes);
        self.runtime
            .run_with(
                &self.ops.overlay,
                &Overlay {
                    traditions,
                    people,
                    hardness: 0.0,
                },
            )
            .unwrap();
    }
    fn get(&self, field: F, index: usize) -> f64 {
        self.runtime
            .state()
            .layers
            .view(field)
            .get(self.cells[index])
            .unwrap()
    }
    fn column(&self, index: usize) -> IdentityColumn {
        self.runtime
            .state()
            .layers
            .column(self.cells[index])
            .unwrap()
    }
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-8, "{a} != {b}");
}
#[test]
fn owner_operations_preserve_area_competition_and_simultaneous_migration() {
    let mut f = Fixture::new();
    f.lay(LayerId::Farmland, &[(0, 0.7)]);
    f.lay(LayerId::BuiltUp, &[(0, 0.5), (1, 0.5)]);
    near(f.get(F::Layer(LayerId::BuiltUp), 0), 0.3);
    f.lay(LayerId::Population, &[(0, 100.0), (1, 40.0)]);
    f.tongue(0, 1, 100.0);
    f.tongue(1, 2, 40.0);
    let targets = f.codes(&[(0, f.cells[1] as i32), (1, f.cells[2] as i32)]);
    let share = f.values(&[(0, 0.5), (1, 0.25)]);
    f.runtime
        .run_with(
            &f.ops.move_layer,
            &Move {
                kind: LayerId::Population,
                targets,
                share,
                years: 2.0,
            },
        )
        .unwrap();
    for (index, expected) in [50.0, 80.0, 10.0].into_iter().enumerate() {
        near(f.get(F::Layer(LayerId::Population), index), expected);
    }
    assert_eq!(
        f.column(1)
            .iter()
            .map(|layer| (layer.traditions[0], layer.people))
            .collect::<Vec<_>>(),
        vec![(1, 50.0), (2, 30.0)]
    );
    for (index, expected) in [100.0, 120.0, 20.0].into_iter().enumerate() {
        near(
            f.get(F::WalkedRoute, index) / (f.mesh.area(f.cells[index]) / 1_000_000.0),
            expected,
        );
    }
}
#[test]
fn movement_captures_identity_share_before_an_aliased_owner_band_changes() {
    let mut f = Fixture::new();
    f.lay(LayerId::Population, &[(0, 0.5)]);
    f.tongue(0, 8, 0.5);
    let targets = f.codes(&[(0, f.cells[1] as i32)]);
    let share = f.runtime.state().layers.view(F::Layer(LayerId::Population));
    f.runtime
        .run_with(
            &f.ops.move_layer,
            &Move {
                kind: LayerId::Population,
                targets,
                share,
                years: 1.0,
            },
        )
        .unwrap();
    near(f.get(F::Layer(LayerId::Population), 1), 0.25);
    near(f.column(1)[0].people, 0.25);
    near(f.column(0)[0].people, 0.25);
}
#[test]
fn layer_loss_retains_builders_tongue_and_burial_does_not_count_departure_as_death() {
    let mut f = Fixture::new();
    f.lay(LayerId::Population, &[(0, 100.0), (1, 80.0)]);
    f.tongue(0, 5, 100.0);
    f.tongue(1, 7, 40.0);
    f.lay(LayerId::BuiltUp, &[(0, 0.2), (1, 0.2)]);
    f.lay(LayerId::Pasture, &[(0, 0.4)]);
    let intensity = f.values(&[(0, 1.0)]);
    let mut modes = [0.0; 7];
    modes[LayerMode::Burn as usize] = 1.0;
    f.runtime
        .run_with(
            &f.ops.wear,
            &Wear {
                mix: compile(modes),
                intensity,
            },
        )
        .unwrap();
    let lost = 1.0 - (-0.6f64).exp();
    near(
        f.get(F::Layer(LayerId::Population), 0),
        100.0 * (1.0 - lost),
    );
    near(f.get(F::RuinedBuiltUp, 0), 0.2 * lost * 0.7);
    assert_eq!(
        f.runtime
            .state()
            .layers
            .ruin_tongue()
            .get(f.cells[0])
            .unwrap(),
        5
    );
    near(
        f.get(F::MassDeath, 0),
        100.0 * lost * f.mesh.area(f.cells[0]) / 1_000_000.0,
    );
    let share = f.values(&[(1, 0.5)]);
    f.runtime.run_with(&f.ops.bury, &share).unwrap();
    near(f.get(F::Layer(LayerId::Population), 1), 40.0);
    near(f.column(1)[0].people, 20.0);
    near(f.get(F::RuinCover, 1), 1.0);
    near(f.get(F::MassDeath, 1), 0.0);
    let share = f.values(&[(1, 0.25)]);
    f.runtime.run_with(&f.ops.reexpose, &share).unwrap();
    near(f.get(F::RuinCover, 1), 0.75);
}
#[test]
fn identity_hardens_with_standing_and_keeps_unmentioned_traditions() {
    let mut f = Fixture::new();
    f.lay(LayerId::Population, &[(0, 100.0), (1, 100.0)]);
    f.lay(LayerId::BuiltUp, &[(0, 0.2)]);
    f.lay(LayerId::Standing, &[(0, 0.2 * FULL_STANDING_PER_BUILT_KM2)]);
    f.tongue(0, 1, 100.0);
    f.tongue(1, 2, 100.0);
    f.runtime
        .run_with(
            &f.ops.harden,
            &Harden {
                years: 10000.0,
                settling: 300.0,
            },
        )
        .unwrap();
    near(f.column(0)[0].hardness, 0.9);
    near(f.column(1)[0].hardness, 0.2);
    let faith = f.codes(&[(0, 9)]);
    let people = f.values(&[(0, 50.0)]);
    let mut traditions = std::array::from_fn(|_| None);
    traditions[Tradition::Faith as usize] = Some(faith);
    f.runtime
        .run_with(
            &f.ops.overlay,
            &Overlay {
                traditions,
                people,
                hardness: 0.0,
            },
        )
        .unwrap();
    let column = f.column(0);
    assert_eq!(column[0].traditions, [1, 9, 0, 0, 0, 0]);
    near(column[0].people, 5.0);
    near(column[0].age, 10000.0);
}
#[test]
fn identity_coarsening_prefers_craft_twins_and_renaming_joins_existing_holders() {
    let layer = |people, tongue, craft| IdentityLayer {
        people,
        traditions: [tongue, 0, 0, 0, craft, 0],
        ..Default::default()
    };
    let mut column = vec![
        layer(50.0, 1, 0),
        layer(1.0, 2, 0),
        layer(40.0, 3, 0),
        layer(30.0, 4, 0),
        layer(20.0, 1, 7),
    ];
    settle(&mut column);
    assert_eq!(
        column
            .iter()
            .map(|layer| (layer.traditions[0], layer.people))
            .collect::<Vec<_>>(),
        vec![(1, 70.0), (2, 1.0), (3, 40.0), (4, 30.0)]
    );
    rename(&mut column, Tradition::Tongue, 4, 3);
    assert_eq!(leading(&column, Tradition::Tongue), (1, 70.0));
    assert_eq!(column.len(), 3);
    let leaving = part(&mut column, 0.25);
    near(leaving[0].people, 17.5);
    near(column[0].people, 52.5);
    reexpose(&mut column, 52.5);
    near(column[0].people, 53.25);
}
#[test]
fn crust_carriage_moves_population_remains_and_whole_identity_columns_together() {
    use atlas_generation::transport::TransportShares;
    let mut f = Fixture::new();
    f.lay(LayerId::Population, &[(0, 100.0), (1, 40.0)]);
    f.lay(LayerId::Farmland, &[(0, 0.6), (1, 0.4)]);
    f.lay(LayerId::BuiltUp, &[(0, 0.4), (1, 0.4)]);
    f.tongue(0, 5, 100.0);
    f.tongue(1, 7, 40.0);
    let buried = f.values(&[(0, 0.5), (1, 0.5)]);
    f.runtime.run_with(&f.ops.bury, &buried).unwrap();
    let cache = BlockCache::new(100000, BlockScratch::new(File::default()));
    let mut offsets = Band::new(f.mesh.len() + 1, 0u32, cache.clone());
    let mut targets = Band::new(2, f.cells[2] as i32, cache.clone());
    let weights = Band::new(2, 1_000_000.0, cache.clone());
    let dominant = Band::new(f.mesh.len(), -1, cache.clone());
    let inflow = Band::new(f.mesh.len(), 0.0, cache);
    let mut count = 0;
    for cell in 0..f.mesh.len() {
        offsets.set(cell, count).unwrap();
        if cell == f.cells[0] || cell == f.cells[1] {
            targets.set(count as usize, f.cells[2] as i32).unwrap();
            count += 1;
        }
    }
    offsets.set(f.mesh.len(), count).unwrap();
    f.runtime
        .run_with(
            &f.ops.carry,
            &TransportShares {
                offsets: offsets.read_only(),
                targets: targets.read_only(),
                weights: weights.read_only(),
                dominant: dominant.read_only(),
                inflow: inflow.read_only(),
            },
        )
        .unwrap();
    near(f.get(F::Layer(LayerId::Population), 0), 0.0);
    near(f.get(F::Layer(LayerId::Population), 2), 70.0);
    near(f.get(F::Layer(LayerId::Farmland), 2), 0.5);
    near(f.get(F::RuinedBuiltUp, 2), 0.4);
    near(f.get(F::RuinCover, 2), 1.0);
    assert_eq!(
        f.runtime
            .state()
            .layers
            .ruin_tongue()
            .get(f.cells[2])
            .unwrap(),
        5
    );
    assert_eq!(
        f.column(2)
            .iter()
            .map(|layer| (layer.traditions[0], layer.people))
            .collect::<Vec<_>>(),
        vec![(7, 20.0), (5, 50.0)]
    );
}
#[test]
fn regional_apportionment_moves_each_identity_share_and_respects_available_land() {
    let mut f = Fixture::new();
    f.lay(LayerId::Population, &[(0, 100.0), (1, 100.0)]);
    f.tongue(0, 1, 100.0);
    f.tongue(1, 2, 100.0);
    f.lay(LayerId::Farmland, &[(0, 0.8), (1, 0.8)]);
    let groups = f.codes(&[(0, 8), (1, 8)]);
    let weight = f.values(&[(0, 3.0), (1, 1.0)]);
    f.runtime
        .run_with(
            &f.ops.apportion,
            &Apportion {
                kinds: vec![LayerId::Population, LayerId::Farmland],
                groups,
                weight,
            },
        )
        .unwrap();
    near(f.get(F::Layer(LayerId::Population), 0), 150.0);
    near(f.get(F::Layer(LayerId::Population), 1), 50.0);
    near(f.column(0)[0].people, 150.0);
    near(f.column(1)[0].people, 50.0);
    assert_eq!(f.column(0)[0].traditions[0], 1);
    assert_eq!(f.column(1)[0].traditions[0], 2);
    near(f.get(F::Layer(LayerId::Farmland), 0), 1.0);
    near(f.get(F::Layer(LayerId::Farmland), 1), 0.4);
}
#[test]
fn tenure_and_paths_follow_elapsed_time_and_invalid_amounts_add_nothing() {
    let mut f = Fixture::new();
    let mut maintained = KeptLineTargets {
        add: f.values(&[]),
        at_most: f.values(&[(0, f64::INFINITY)]),
        at_least: f.values(&[(0, WAY_MEMORY_YEARS)]),
    };
    f.runtime
        .run_with(&f.ops.maintain_lines, &maintained)
        .unwrap();
    f.runtime
        .run_with(&f.ops.maintain_lines, &maintained)
        .unwrap();
    assert_eq!(f.get(F::KeptLine, 0), WAY_MEMORY_YEARS);
    maintained.at_least = f.values(&[]);
    f.runtime
        .run_with(&f.ops.maintain_lines, &maintained)
        .unwrap();
    assert_eq!(f.get(F::KeptLine, 0), 0.0);
    f.lay(LayerId::Population, &[(0, 10.0), (1, f64::NAN)]);
    let travel = f.values(&[(2, 300.0)]);
    f.runtime.run_with(&f.ops.travel, &travel).unwrap();
    f.runtime
        .run_with(
            &f.ops.dwell,
            &Dwelling {
                years: WAY_MEMORY_YEARS,
                fading: None,
            },
        )
        .unwrap();
    near(f.get(F::WalkedRoute, 2), 300.0 / std::f64::consts::E);
    near(
        f.get(F::Tenure, 0),
        10.0 * f.mesh.area(f.cells[0]) / 1_000_000.0 * WAY_MEMORY_YEARS,
    );
    near(f.get(F::Layer(LayerId::Population), 1), 0.0);
    let amount = f.values(&[(0, 1.0)]);
    assert!(f
        .runtime
        .run_with(
            &f.ops.convert,
            &Convert {
                from: LayerId::Population,
                to: LayerId::BuiltUp,
                amount
            }
        )
        .is_err());
    near(f.get(F::Layer(LayerId::Population), 0), 10.0);
}
