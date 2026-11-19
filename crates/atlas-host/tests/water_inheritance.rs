#![cfg(not(target_arch = "wasm32"))]
use atlas_generation::{
    lattice::{TriangularLattice, WorldLatticeOptions},
    water::{captured::*, inherit::RiverInheritance, reaches::ReachStore},
};
use atlas_gis::geometry::NativeGeos;
use atlas_map::{Bounds, Id, Position};

fn mesh() -> TriangularLattice {
    WorldLatticeOptions::default()
        .build(Bounds(0.0, 0.0, 1000.0, 1000.0), 64.0, 0.0, |_, _| true)
        .unwrap()
}
fn position(mesh: &TriangularLattice, cell: usize) -> Position {
    let [x, y] = mesh.position(cell);
    let [ox, oy] = mesh.origin();
    Position::xy(x + ox, y + oy)
}
fn river(id: usize, course: Vec<Position>) -> RetainedRiver {
    let n = course.len();
    RetainedRiver {
        id,
        course,
        junction: None,
        downstream: None,
        order: 2,
        flow: 10.0,
        least: 5.0,
        flood: 15.0,
        months: 12,
        dry: false,
        drawn: true,
        dried_in: None,
        former: Vec::new(),
        monthly: vec![10.0; n * 12],
        catchment: vec![100.0; n],
        bed: Vec::new(),
        width: vec![4.0; n],
        depth: vec![2.0; n],
        leakage: vec![0.2; n],
        river: Some(format!("parent-{id}")),
        record: None,
        name: Some("Named river".into()),
    }
}
fn network(reaches: Vec<RetainedRiver>) -> DrainageNetwork {
    DrainageNetwork {
        area_id: Id::from_name("child"),
        space_id: Id::from_name("planar"),
        reaches: Vec::new(),
        kept: Some(RetainedNetwork {
            next: reaches.iter().map(|r| r.id + 1).max().unwrap_or(1),
            reaches,
            entries: Vec::new(),
        }),
        input: true,
    }
}
fn inherit(mesh: &TriangularLattice, input: &DrainageNetwork) -> ReachStore {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut store = ReachStore::default();
    store
        .inherit(
            input,
            RiverInheritance {
                mesh,
                spatial: &spatial,
                elevation: &|_| Ok(80.0),
                bend: 0.0,
            },
            |_| None,
        )
        .unwrap();
    store
}
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 0.001, "{actual} != {expected}");
}
#[test]
fn clipped_river_interpolates_all_months_and_keeps_supply_and_child_bed() {
    let mesh = mesh();
    let mut input = river(
        7,
        vec![Position::xy(-100.0, 500.0), Position::xy(1100.0, 500.0)],
    );
    input.monthly = (0..24)
        .map(|at| {
            if at < 12 {
                10.0 + at as f64
            } else {
                22.0 + (at - 12) as f64
            }
        })
        .collect();
    input.catchment = vec![100.0, 220.0];
    let store = inherit(&mesh, &network(vec![input]));
    let reach = store.reaches().next().unwrap();
    assert!(reach.cells().len() > 2);
    assert_eq!(store.entries().len(), 1);
    assert_eq!(reach.record(), Some("river:parent-7:0"));
    assert_eq!(reach.name(), Some("Named river"));
    for (at, &cell) in reach.cells().iter().enumerate() {
        let x = position(&mesh, cell).coordinates()[0];
        for month in 0..12 {
            near(
                reach.monthly()[at * 12 + month],
                10.0 + (x + 100.0) / 100.0 + month as f64,
            );
        }
        near(reach.catchment()[at], 100.0 + (x + 100.0) / 10.0);
        near(reach.bed()[at], 80.0);
        near(reach.width()[at], 4.0);
        near(reach.depth()[at], 2.0);
        near(reach.leakage()[at], 0.2);
    }
    assert_eq!(store.entries()[0].cell, reach.cells()[0]);
    near(store.entries()[0].catchment, reach.catchment()[0]);
}
#[test]
fn isolated_samples_keep_captured_entries_without_inventing_direction_or_supply() {
    let mesh = mesh();
    let cell = mesh.cell_at(0.0, 0.0).unwrap();
    let point = position(&mesh, cell);
    let mut input = network(vec![river(4, vec![point])]);
    input.kept.as_mut().unwrap().entries = vec![
        BoundaryEntry {
            position: point,
            monthly: [3.0; 12],
            catchment: 30.0,
        },
        BoundaryEntry {
            position: Position::xy(-50.0, 500.0),
            monthly: [9.0; 12],
            catchment: 90.0,
        },
    ];
    let mut store = inherit(&mesh, &input);
    assert_eq!(store.entries().len(), 1);
    assert_eq!(store.entries()[0].monthly, [3.0; 12]);
    let reach = store.reaches().next().unwrap();
    assert_eq!(reach.cells(), [cell]);
    assert_eq!(reach.downstream(), None);
    assert_eq!(reach.monthly(), [10.0; 12]);
    let spatial = NativeGeos::new(0.001).unwrap();
    store
        .inherit(
            &input,
            RiverInheritance {
                mesh: &mesh,
                spatial: &spatial,
                elevation: &|_| Ok(999.0),
                bend: 0.0,
            },
            |_| None,
        )
        .unwrap();
    assert_eq!(store.reaches().count(), 1);
    assert_eq!(store.entries().len(), 1);
    near(store.reaches().next().unwrap().bed()[0], 80.0);
}
#[test]
fn confluence_preserves_outgoing_tributary_flow_and_connects_only_the_verified_receiver() {
    let mesh = mesh();
    let source = mesh.cell_at(0.0, 0.0).unwrap();
    let junction = mesh.neighbor(source, 0).unwrap();
    let next = (0..3)
        .filter_map(|edge| mesh.neighbor(junction, edge))
        .find(|&cell| cell != source)
        .unwrap();
    let mut tributary = river(40, vec![position(&mesh, source)]);
    tributary.junction = Some(position(&mesh, junction));
    tributary.downstream = Some(80);
    let mut receiver = river(80, vec![position(&mesh, junction), position(&mesh, next)]);
    receiver.monthly.fill(900.0);
    let store = inherit(&mesh, &network(vec![tributary, receiver]));
    let tributary = store
        .reaches()
        .find(|r| r.river() == Some("parent-40"))
        .unwrap();
    let receiver = store
        .reaches()
        .find(|r| r.river() == Some("parent-80"))
        .unwrap();
    assert_eq!(tributary.cells(), [source]);
    assert_eq!(tributary.monthly(), [10.0; 12]);
    assert_eq!(tributary.downstream(), Some(receiver.id()));
    assert_eq!(receiver.cells()[0], junction);
    assert!(store.entries().is_empty());
}
#[test]
fn former_courses_survive_as_dry_beds_when_the_current_river_is_outside_the_child() {
    let mesh = mesh();
    let mut old = river(
        1,
        vec![Position::xy(-200.0, 100.0), Position::xy(-100.0, 100.0)],
    );
    old.former.push(FormerCourse {
        course: vec![Position::xy(100.0, 500.0), Position::xy(900.0, 500.0)],
        left_in: 42.0,
    });
    let store = inherit(&mesh, &network(vec![old]));
    let reach = store.reaches().next().unwrap();
    assert!(reach.dry());
    assert_eq!(reach.dried_in(), Some(42.0));
    assert_eq!(reach.downstream(), None);
    assert!(reach.monthly().iter().all(|&value| value == 0.0));
    assert!(reach.bed().iter().all(|&value| value == 80.0));
    assert!(store.entries().is_empty());
}
#[test]
fn published_current_drainage_resolves_mean_profiles_and_feature_identity() {
    let mesh = mesh();
    let source = mesh.cell_at(0.0, 0.0).unwrap();
    let next = mesh.neighbor(source, 0).unwrap();
    let mut input = network(Vec::new());
    input.kept = None;
    input.reaches.push(DrainageReach {
        downstream: None,
        water_body: None,
        order: 3,
        basin: 0,
        coordinates: vec![position(&mesh, source), position(&mesh, next)],
        discharges: vec![7.0, 9.0],
        catchment_areas: vec![70.0, 90.0],
        feature_ids: vec![Id::from_name("visible-reach")],
    });
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut store = ReachStore::default();
    store
        .inherit(
            &input,
            RiverInheritance {
                mesh: &mesh,
                spatial: &spatial,
                elevation: &|_| Ok(50.0),
                bend: 0.0,
            },
            |id| {
                assert_eq!(id, Id::from_name("visible-reach"));
                Some(RiverIdentity {
                    river: Some("whole-river".into()),
                    name: Some("Named".into()),
                })
            },
        )
        .unwrap();
    let reach = store.reaches().next().unwrap();
    assert_eq!(reach.river(), Some("whole-river"));
    assert_eq!(reach.name(), Some("Named"));
    near(reach.monthly()[0], 7.0);
    near(*reach.monthly().last().unwrap(), 9.0);
    near(reach.bed()[0], 50.0);
    assert_eq!(reach.order(), 3);
}
