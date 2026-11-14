use super::{balance::*, evolution::RiverEnvironment, losses::*, reaches::*, stores::WaterStore};
use std::io;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

struct Environment {
    targets: Vec<Option<usize>>,
    order: Vec<usize>,
    resolved: Vec<bool>,
    water: Vec<[f64; MONTHS]>,
    heads: Option<Vec<bool>>,
}
impl Environment {
    fn new(targets: &[i32]) -> Self {
        Self {
            targets: targets
                .iter()
                .map(|&target| usize::try_from(target).ok())
                .collect(),
            order: (0..targets.len()).collect(),
            resolved: vec![true; targets.len()],
            water: vec![
                std::array::from_fn(|month| if month < 6 { 40.0 } else { 0.0 });
                targets.len()
            ],
            heads: None,
        }
    }
}
impl RiverEnvironment for Environment {
    fn count(&self) -> usize {
        self.targets.len()
    }
    fn ordered(&self, at: usize) -> io::Result<usize> {
        Ok(self.order[at])
    }
    fn next(&self, cell: usize) -> io::Result<Option<usize>> {
        Ok(self.targets[cell])
    }
    fn land(&self, _cell: usize) -> io::Result<bool> {
        Ok(true)
    }
    fn resolved(&self, cell: usize) -> io::Result<bool> {
        Ok(self.resolved[cell])
    }
    fn flow(&self, cell: usize, month: usize) -> io::Result<f64> {
        Ok(self.water[cell][month])
    }
    fn bed(&self, cell: usize) -> io::Result<f64> {
        Ok(100.0 - cell as f64)
    }
    fn catchment(&self, _cell: usize) -> io::Result<f64> {
        Ok(100.0)
    }
    fn discharge(&self) -> f64 {
        10.0
    }
    fn epoch(&self) -> f64 {
        4.0
    }
    fn new_head(&self, cell: usize) -> io::Result<bool> {
        Ok(self.heads.as_ref().is_none_or(|heads| heads[cell]))
    }
}
#[test]
fn retained_network_updates_profiles_and_keeps_dry_identity() {
    let mut store = ReachStore::default();
    let mut env = Environment::new(&[1, 2, -1]);
    store.advance(&env).unwrap();
    store.get_mut(1).unwrap().river = Some("long-river".into());
    env.water.fill([20.0; MONTHS]);
    store.advance(&env).unwrap();
    let reach = store.get(1).unwrap();
    assert_eq!(reach.cells(), &[0, 1, 2]);
    assert_eq!(reach.bed(), &[100.0, 99.0, 98.0]);
    assert_eq!(reach.regime(), Regime::Perennial);
    env.resolved.fill(false);
    store.advance(&env).unwrap();
    let reach = store.get(1).unwrap();
    assert!(reach.dry());
    assert_eq!(reach.river(), Some("long-river"));
    assert_eq!(reach.cells(), &[0, 1, 2]);
    assert_eq!(reach.flow(), 0.0);
    assert_eq!(reach.dried_in(), Some(4.0));
}
#[test]
fn diversions_keep_abandoned_edges_and_remove_reoccupied_edges() {
    let mut store = ReachStore::default();
    let mut original = Environment::new(&[1, 2, -1, -1]);
    original.resolved[3] = false;
    store.advance(&original).unwrap();
    let mut diverted = Environment::new(&[1, 3, -1, -1]);
    diverted.resolved[2] = false;
    store.advance(&diverted).unwrap();
    assert_eq!(store.get(1).unwrap().cells(), &[0, 1, 3]);
    assert_eq!(
        store.get(1).unwrap().former(),
        &[FormerCourse {
            cells: vec![1, 2],
            left_in: 4.0
        }]
    );
    store.advance(&original).unwrap();
    assert_eq!(
        store.get(1).unwrap().former(),
        &[FormerCourse {
            cells: vec![1, 3],
            left_in: 4.0
        }]
    );
}
#[test]
fn confluence_splits_keep_named_lower_reach_and_orders() {
    let mut store = ReachStore::default();
    let mut env = Environment::new(&[2, 2, 3, -1]);
    env.resolved[1] = false;
    store.advance(&env).unwrap();
    store.get_mut(1).unwrap().river = Some("long-river".into());
    env.resolved[1] = true;
    store.advance(&env).unwrap();
    let lower = store.get(1).unwrap();
    assert_eq!(lower.cells(), &[2, 3]);
    assert_eq!(lower.order(), 2);
    assert_eq!(lower.river(), Some("long-river"));
    assert_eq!(
        store
            .reaches()
            .filter(|r| r.downstream() == Some(1))
            .count(),
        2
    );
}
#[test]
fn retained_diversion_splits_a_receiving_course_with_or_without_names() {
    for named in [false, true] {
        let mut store = ReachStore::default();
        let diverted = store.add(vec![0, 1]);
        let receiving = store.add(vec![2, 3, 4]);
        if named {
            store.get_mut(diverted).unwrap().river = Some("tributary".into());
            store.get_mut(receiving).unwrap().river = Some("main-river".into());
        }
        let env = Environment::new(&[1, 3, 3, 4, -1]);
        store.advance(&env).unwrap();
        assert_eq!(store.get(receiving).unwrap().cells(), &[3, 4]);
        assert_eq!(store.get(diverted).unwrap().downstream(), Some(receiving));
        for reach in store.reaches() {
            for pair in reach.cells().windows(2) {
                assert_eq!(env.next(pair[0]).unwrap(), Some(pair[1]));
            }
        }
    }
}
#[test]
fn latent_heads_and_losing_tail_do_not_claim_unrelated_ground() {
    let mut store = ReachStore::default();
    let mut env = Environment::new(&[2, 3, -1, -1]);
    env.heads = Some(vec![true, false, false, false]);
    store.advance(&env).unwrap();
    assert_eq!(store.reaches().count(), 1);
    assert_eq!(store.get(1).unwrap().cells(), &[0, 2]);
    env.water[2].fill(0.0);
    store.advance(&env).unwrap();
    let reach = store.get(1).unwrap();
    assert!(!reach.dry());
    assert_eq!(reach.flow(), 0.0);
    assert_eq!(reach.months_at(0), 6);
    assert_eq!(reach.months_at(1), 0);
}
#[test]
fn drying_receivers_do_not_block_live_water_or_create_self_receiving_reaches() {
    let mut store = ReachStore::default();
    let upper = store.add(vec![0]);
    let middle = store.add(vec![1]);
    let lower = store.add(vec![2]);
    store.get_mut(upper).unwrap().downstream = Some(middle);
    store.get_mut(middle).unwrap().downstream = Some(lower);
    let mut env = Environment::new(&[1, -1, 0]);
    env.order = vec![2, 0, 1];
    env.water[1].fill(0.0);
    store.advance(&env).unwrap();
    for reach in store.reaches() {
        assert_ne!(reach.downstream(), Some(reach.id()));
        if let Some(next) = reach.downstream() {
            assert!(store.get(next).is_some());
        }
    }
    assert!(store.get(middle).unwrap().dry());
    assert_eq!(store.get(middle).unwrap().cells(), &[1]);
    assert_eq!(
        store.reaches().find(|reach| !reach.dry()).unwrap().cells(),
        &[2, 0, 1]
    );
}
#[test]
fn index_prefers_water_at_the_point_over_a_losing_rivers_dry_tail() {
    let mut store = ReachStore::default();
    let losing = store.add(vec![1, 2]);
    let running = store.add(vec![2, 3]);
    store.get_mut(losing).unwrap().order = 3;
    store.get_mut(losing).unwrap().monthly[..MONTHS].fill(40.0);
    store.get_mut(running).unwrap().monthly.fill(20.0);
    let index = store.cell_index();
    assert_eq!(index.get(&store, 2).unwrap().id(), running);
    assert_eq!(index.position(3), Some(1));
    assert!(index.get(&store, 99).is_none());
}
fn ground() -> WaterGround {
    WaterGround {
        rain: [0.0; MONTHS],
        snow: [0.0; MONTHS],
        demand: [0.0; MONTHS],
        melt: [0.0; MONTHS],
        soil_capacity: 0.0,
        sinking: 0.3,
        storm_share: 0.0,
    }
}
#[test]
fn supplied_snow_enters_actual_transfers_after_warmup() {
    let mut ground = ground();
    ground.melt[0] = 120.0;
    let year = water_year(
        &ground,
        HeldWater {
            snow: Some(120.0),
            soil: None,
        },
    );
    assert_eq!(year.thaw[0], 120.0);
    assert_eq!(year.thaw[1], 0.0);
    assert!(year.quick[0] > 0.0);
    assert_eq!(year.end_snow, 0.0);
    ground.soil_capacity = 150.0;
    let year = water_year(
        &ground,
        HeldWater {
            snow: Some(120.0),
            soil: None,
        },
    );
    assert_eq!(year.quick[0], 0.0);
    assert_eq!(year.end_soil, 120.0);
}
#[test]
fn frozen_inherited_snow_is_not_new_ice_and_late_snow_survives_warmup() {
    let mut ground = ground();
    let year = water_year(
        &ground,
        HeldWater {
            snow: Some(120.0),
            soil: None,
        },
    );
    assert_eq!(year.end_snow, 120.0);
    assert_eq!(year.kept_snow, 0.0);
    ground.snow[11] = 120.0;
    ground.melt[0] = 120.0;
    let year = water_year(&ground, HeldWater::default());
    assert_eq!(year.end_snow, 120.0);
    assert_eq!(year.kept_snow, 0.0);
    assert!(year.quick[0] > 0.0);
}
#[test]
fn changed_capacity_releases_soil_and_retention_draws_it_down_gradually() {
    let mut ground = ground();
    ground.soil_capacity = 50.0;
    let year = water_year(
        &ground,
        HeldWater {
            soil: Some(120.0),
            snow: Some(0.0),
        },
    );
    assert!(year.quick[0] > 0.0);
    assert_eq!(year.end_soil, 50.0);
    let mut soil = WaterStore {
        held: 100.0,
        capacity: 100.0,
        retention: 100.0,
    };
    assert!(soil.give(100.0) < 100.0);
    assert!(soil.held > 0.0);
    assert_eq!(soil.receive(-3.0), 0.0);
}
#[test]
fn bed_intake_and_withdrawal_are_limited_by_available_water() {
    assert_eq!(bed_leak(1.0, 1.0, 1.0), 0.0);
    assert_eq!(bed_loss(10.0, 100.0, 100.0), 10.0);
    assert_eq!(passing_water(10.0, 20.0, 1.0), 0.0);
    assert_eq!(passing_water(10.0, 2.0, 0.5), 4.0);
}
