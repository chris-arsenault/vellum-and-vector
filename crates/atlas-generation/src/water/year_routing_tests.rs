use super::{
    balance::MONTHS,
    ledger::*,
    network_tests::fixture,
    reaches::{BoundaryEntry, ReachStore},
    year_routing::*,
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-8, "{a} != {b}");
}
#[test]
fn monthly_boundary_flow_and_local_supply_pass_through_lake_outlet_at_mean_overflow() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let mut targets = coverage.allocate(-1i32);
    targets.set(a, b as i32).unwrap();
    targets.set(b, c as i32).unwrap();
    let mut kind = coverage.allocate(0u8);
    kind.set(b, 2).unwrap();
    kind.set(c, 1).unwrap();
    let mut surface = coverage.allocate(0.0);
    let depth = SECONDS_PER_YEAR * 1000.0 / mesh.area(a);
    surface.set(a, depth).unwrap();
    let runoff = coverage.allocate(0.0);
    let melt = coverage.allocate(0.0);
    let year: [_; MONTHS] = std::array::from_fn(|_| coverage.allocate(0.0));
    let mut outlets = coverage.allocate(-1i32);
    outlets.set(b, c as i32).unwrap();
    let mut overflow = coverage.allocate(0.0);
    overflow.set(b, 2.0).unwrap();
    let mut store = ReachStore::default();
    store.entries.push(BoundaryEntry {
        cell: a,
        monthly: std::array::from_fn(|month| if month < 6 { 2.0 } else { 6.0 }),
        catchment: 900.0,
    });
    let mut flow = RiverFlow::new(&mut coverage);
    let mut ledger = WaterLedger::default();
    let routed = flow
        .route(
            &RoutingInputs {
                mesh: &mesh,
                targets: &targets.read_only(),
                water_kind: &kind.read_only(),
                surface_water: &surface.read_only(),
                runoff: &runoff.read_only(),
                meltwater: &melt.read_only(),
                year: &std::array::from_fn(|month| year[month].read_only()),
                lake_outlets: &outlets.read_only(),
                lake_overflow: &overflow.read_only(),
                lake_evaporation: 1.0,
                lake_seepage: 1.0,
                lake_infiltration_loss: 2.0,
                passage: &|_, received| {
                    Ok(Passage {
                        passed: received,
                        bed: 0.0,
                        drawn: 0.0,
                    })
                },
            },
            &store,
            &mut ledger,
            &mut coverage,
        )
        .unwrap();
    let read = flow.read_only();
    near(read.mean.get(a).unwrap(), 5.0);
    near(read.mean.get(b).unwrap(), 2.0);
    near(routed.monthly[0].get(a).unwrap(), 3.0);
    near(routed.monthly[6].get(a).unwrap(), 7.0);
    near(routed.monthly[0].get(c).unwrap(), 2.0);
    near(routed.monthly[6].get(c).unwrap(), 2.0);
    near(read.catchment.get(a).unwrap(), mesh.area(a) + 900.0);
    near(read.seepage.get(b).unwrap(), 3.0);
}
#[test]
fn captured_unresolved_channel_length_must_reach_an_actual_edge_before_forming_a_head() {
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let mut targets = coverage.allocate(-1i32);
    targets.set(a, b as i32).unwrap();
    targets.set(b, c as i32).unwrap();
    let mut length = coverage.allocate(0.0);
    length.set(a, mesh.physical_distance(a, b) / 2.0).unwrap();
    length.set(b, mesh.physical_distance(b, c)).unwrap();
    let order = crate::flow_graph::target_order(&mut coverage, &targets.read_only()).unwrap();
    let origins = channel_origins(
        &mesh,
        &order.read_only(),
        &targets.read_only(),
        &length.read_only(),
        &mut coverage,
    )
    .unwrap();
    assert_eq!((origins[a], origins[b], origins[c]), (0, 1, 0));
}
#[test]
fn restating_a_water_move_replaces_its_earlier_statement() {
    let mut ledger = WaterLedger::default();
    ledger.state(Move::Rain, 5.0);
    ledger.state(Move::Rain, 9.0);
    ledger.flow(Move::Mouth, 2.0);
    near(ledger.volume(Move::Rain), 9.0);
    near(ledger.volume(Move::Mouth), 2.0 * SECONDS_PER_YEAR);
    assert_eq!(Move::BedLoss.stores(), (Store::River, Store::Ground));
    ledger.state(Move::Rain, f64::NAN);
    near(ledger.volume(Move::Rain), 0.0);
}
#[test]
fn retained_network_reads_routed_bands_and_reports_released_storage() {
    use super::routed_network::NetworkInputs;
    use crate::scale::MapScale;
    let (mesh, mut coverage, [a, b, c]) = fixture();
    let mut kind = coverage.allocate(1u8);
    kind.set(a, 0).unwrap();
    kind.set(b, 0).unwrap();
    let mut targets = coverage.allocate(-1i32);
    targets.set(a, b as i32).unwrap();
    targets.set(b, c as i32).unwrap();
    let catchment = coverage.allocate(0.0);
    let order = crate::flow_graph::target_order(&mut coverage, &targets.read_only()).unwrap();
    let mut year = RoutedYear {
        order,
        monthly: std::array::from_fn(|_| coverage.allocate(0.1)),
    };
    let scale = MapScale::new(100.0, 100.0, mesh.cell_span()).unwrap();
    let (kind, targets, catchment) = (kind.read_only(), targets.read_only(), catchment.read_only());
    let input = || NetworkInputs {
        mesh: &mesh,
        water_kind: &kind,
        targets: &targets,
        catchment: &catchment,
        bed: &|_| Ok(12.0),
        scale: &scale,
        epoch: 3.0,
    };
    let mut store = ReachStore::default();
    let id = store.add(vec![a, b]);
    store.get_mut(id).unwrap().river = Some("captured".into());
    store
        .advance_routed(input(), &year, None, &mut coverage)
        .unwrap();
    let reach = store.get(id).unwrap();
    assert_eq!(reach.cells(), [a, b]);
    assert_eq!(reach.river(), Some("captured"));
    near(reach.flow(), 0.1);
    year.monthly[0].release();
    assert!(store.refresh_routed(input(), &year).is_err());
}
#[test]
fn resolved_cut_bed_takes_water_before_withdrawal_and_transmission() {
    use super::passage::PassageInputs;
    use crate::rock::columns::Column;
    let (mesh, mut coverage, [a, b, _]) = fixture();
    let mut kind = coverage.allocate(0u8);
    kind.set(b, 2).unwrap();
    let mut cut = coverage.allocate(0.0);
    cut.set(a, 0.2).unwrap();
    let withdrawal = coverage.allocate(2.0);
    let transmission = coverage.allocate(0.5);
    let mut store = ReachStore::default();
    store.add(vec![a, b]);
    let passage = store
        .prepare_passage(PassageInputs {
            mesh: &mesh,
            water_kind: &kind.read_only(),
            cut_share: &cut.read_only(),
            permeability: &|_, facet| Ok(if facet == Some(Column::Cut) { 1.0 } else { 0.0 }),
            filled: &|_| Ok(0.0),
            open_bed_seepage: 0.001,
            withdrawal: withdrawal.read_only(),
            transmission: transmission.read_only(),
        })
        .unwrap();
    let parts = passage.parts(a, 10.0).unwrap();
    assert!(parts.bed > 0.0);
    near(parts.passed, (10.0 - parts.bed - 2.0) * 0.5);
    near(passage.parts(b, 10.0).unwrap().bed, 0.0);
}
