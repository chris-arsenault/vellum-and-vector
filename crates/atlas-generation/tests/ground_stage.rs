use atlas_generation::{
    lattice::WorldLatticeOptions,
    rock::{
        cargo_identity::CargoIdentities, catalogue::*, coarsening::Fold, columns::*, ground::*,
        load::MaterialLoad, ModeId, ModeMix,
    },
    scale::MapScale,
    settlement::{removal::*, stage::*, Sharing},
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
struct Events;
impl GroundEvents for Events {
    fn remapped_package(&mut self, _: Column, _: usize, _: usize) -> io::Result<()> {
        Ok(())
    }
    fn constructed(
        &mut self,
        _: usize,
        _: &atlas_generation::rock::material::MaterialLayer,
        _: &str,
        _: f64,
    ) -> io::Result<()> {
        Ok(())
    }
    fn folded(&mut self, _: usize, _: Column, _: &Fold<'_>) -> io::Result<()> {
        Ok(())
    }
    fn changed(&mut self, _: usize) -> io::Result<()> {
        Ok(())
    }
}
struct Fixture {
    ground: Ground,
    coverage: Coverage,
    load: MaterialLoad,
    mesh: Rc<atlas_generation::lattice::TriangularLattice>,
    cells: Vec<usize>,
    history: ReadBand<f64>,
    _conditions: (Band<f64>, Band<u8>),
}
fn fixture() -> Fixture {
    fixture_with(|_, _, _| {})
}
fn fixture_with(configure: impl FnOnce(&mut GroundStorage, &mut RockColumns, &[usize])) -> Fixture {
    let mesh = Rc::new(
        WorldLatticeOptions::default()
            .build(Bounds(0.0, 0.0, 1000.0, 1000.0), 16.0, 0.0, |_, _| true)
            .unwrap(),
    );
    let mut coverage = Coverage::new(
        mesh.clone(),
        BlockCache::new(16_000_000, BlockScratch::new(File::default())),
    );
    let mut storage = GroundStorage::new(&mut coverage);
    let mut columns = RockColumns::new(&mut coverage);
    let mut identities = CargoIdentities::default();
    let kept = identities.declare("kept vein", Some("fire")).unwrap();
    let cells: Vec<_> = (0..mesh.len()).collect();
    for cell in 0..mesh.len() {
        storage
            .initialize(GroundField::BedrockElevation, cell, MapScale::native(100.0))
            .unwrap();
        storage
            .initialize(
                GroundField::CrustThickness,
                cell,
                MapScale::native(30_000.0),
            )
            .unwrap();
        storage
            .initialize(GroundField::SoilDepth, cell, 1.0)
            .unwrap();
        for (slot, (kind, depth, age)) in [(10, 10.0, 4.0), (1, 100.0, 2.0), (9, 30000.0, 0.0)]
            .into_iter()
            .enumerate()
        {
            let mut bed = material(kind, MapScale::native(depth), age);
            if slot == 0 {
                bed.cargo = Some(atlas_generation::rock::cargo::MaterialCargo::from_entries(
                    [(kept, kind as i32, 2.0)],
                ));
            }
            columns.set_layer(cell, Column::Land, slot, &bed).unwrap();
        }
    }
    configure(&mut storage, &mut columns, &cells);
    let empty = coverage.allocate(0.0);
    let marine = coverage.allocate(0u8);
    let inputs = GroundInputs {
        tree: empty.read_only(),
        grass: empty.read_only(),
        wetland: empty.read_only(),
        ice: empty.read_only(),
        fire: empty.read_only(),
        fracture: empty.read_only(),
        ward: empty.read_only(),
        marine: marine.read_only(),
        root_hold: None,
        stiffening: None,
    };
    let seed = GroundSeed {
        storage,
        columns,
        identities,
        scale: MapScale::reference(250.0).unwrap(),
        sea_level: 0.0,
        completed_epochs: 8.0,
        crust_initialized: false,
        support_initialized: false,
    };
    let mut ground = Ground::new(seed, mesh.clone(), inputs, Box::new(Events)).unwrap();
    let recorded = coverage.allocate(0.0);
    let history = recorded.read_only();
    ground.bind_history("incision", recorded).unwrap();
    let load = MaterialLoad::ground(&mut coverage, mesh.clone());
    Fixture {
        ground,
        coverage,
        load,
        mesh,
        cells,
        history,
        _conditions: (empty, marine),
    }
}
fn cut(ground: &mut Ground, cell: usize, depth: f64, share: f64) -> CutReceipt {
    ground
        .cut(
            Cut {
                cell,
                depth: MapScale::native(depth),
                share,
                cause: "river",
                floor: f64::NEG_INFINITY,
            },
            &mut |_| Ok(()),
        )
        .unwrap()
}
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 0.002, "{actual} != {expected}");
}
#[test]
fn buried_inventory_keeps_its_host_and_only_reached_charge_is_released() {
    let mut f = fixture();
    let cell = f.cells[0];
    let area = f.mesh.area(cell);
    let stock = f.ground.inventory("salt:test/bed", None).unwrap();
    f.ground
        .inventory_construct(
            stock,
            cell,
            InventoryConstruction {
                amount: area * 30.0,
                depth: MapScale::native(3.0),
                kind: 4,
            },
            "test",
        )
        .unwrap();
    f.ground
        .construct_material(
            cell,
            &material(4, MapScale::native(2.0), 8.0),
            "test",
            Pool::Space,
            None,
        )
        .unwrap();
    near(f.ground.inventory_get(stock, cell).unwrap() / area, 30.0);
    assert_eq!(
        f.ground
            .inventory_reached(stock, cell, MapScale::native(2.0))
            .unwrap(),
        0.0
    );
    let access = InventoryAccess {
        reach: MapScale::native(2.0),
        surface_only: false,
        loose_only: false,
    };
    assert_eq!(
        f.ground
            .inventory_extract(stock, cell, area * 10.0, &access, &mut |_| panic!(
                "Unreached host was extracted"
            ))
            .unwrap(),
        0.0
    );
    near(
        f.ground
            .inventory_release(stock, cell, MapScale::native(3.0), &|_| 0.5)
            .unwrap()
            / area,
        5.0,
    );
    near(f.ground.inventory_get(stock, cell).unwrap() / area, 25.0);
    assert!(f
        .ground
        .columns()
        .read_layer(cell, Column::Land, 0)
        .unwrap()
        .cargo
        .is_none());
}
#[test]
fn inventory_extraction_returns_facet_weighted_carrier_and_charge() {
    let mut f = fixture();
    let cell = f.cells[0];
    let area = f.mesh.area(cell);
    let stock = f.ground.inventory("salt:test/bed", None).unwrap();
    f.ground
        .inventory_construct(
            stock,
            cell,
            InventoryConstruction {
                amount: area * 30.0,
                depth: MapScale::native(3.0),
                kind: 4,
            },
            "test",
        )
        .unwrap();
    f.ground.open_cut(cell, 0.2).unwrap();
    let mut parcels = Vec::new();
    let actual = f
        .ground
        .inventory_extract(
            stock,
            cell,
            area * 5.0,
            &InventoryAccess {
                reach: MapScale::native(3.0),
                surface_only: false,
                loose_only: false,
            },
            &mut |parcel| {
                parcels.push(parcel);
                Ok(())
            },
        )
        .unwrap();
    near(actual / area, 5.0);
    assert_eq!(parcels[0].kind, 4);
    near(inventory::cargo_density(&parcels[0], stock, None), 10.0);
    near(f.ground.inventory_get(stock, cell).unwrap() / area, 25.0);
}
#[test]
fn charging_basement_keeps_its_unbounded_marker_empty_and_spending_cannot_create_hosts() {
    let mut f = fixture_with(|_, columns, cells| {
        for slot in 0..Column::Land.size() {
            columns
                .set_layer(cells[0], Column::Land, slot, &Default::default())
                .unwrap();
        }
        columns
            .set_layer(
                cells[0],
                Column::Land,
                0,
                &material(4, MapScale::native(2.0) + 1.0, 0.0),
            )
            .unwrap();
    });
    let cell = f.cells[0];
    let area = f.mesh.area(cell);
    let stock = f.ground.inventory("salt:bed", None).unwrap();
    f.ground.inventory_set(stock, cell, 100.0).unwrap();
    assert_eq!(f.ground.inventory_get(stock, cell).unwrap(), 0.0);
    f.ground
        .inventory_charge(
            stock,
            cell,
            &Charge {
                dose: ChargeDose::Amount(area * 8.0),
                reach: MapScale::native(20.0),
                hosts: &[4],
                from_rock: false,
                start: 0.0,
            },
        )
        .unwrap();
    near(f.ground.inventory_get(stock, cell).unwrap() / area, 8.0);
    let marker = f
        .ground
        .columns()
        .read_layer(cell, Column::Land, 1)
        .unwrap();
    assert_eq!(marker.depth, 1.0);
    assert!(marker.cargo.is_none());
    f.ground.inventory_set(stock, cell, area * 4.0).unwrap();
    near(f.ground.inventory_get(stock, cell).unwrap() / area, 4.0);
    let custodian = f
        .ground
        .inventory("society/salt", Some("salt:bed"))
        .unwrap();
    f.ground
        .inventory_transfer(stock, cell, area * 2.0, custodian)
        .unwrap();
    near(f.ground.inventory_get(custodian, cell).unwrap() / area, 2.0);
    near(f.ground.inventory_get(stock, cell).unwrap() / area, 2.0);
    let held = f.ground.hold(&mut f.coverage).unwrap();
    f.ground
        .place_carried(&held, cell, cell, [1.0, 0.0, 0.0, 1.0])
        .unwrap();
    assert_eq!(f.ground.inventory_get(custodian, cell).unwrap(), 0.0);
    near(f.ground.inventory_get(stock, cell).unwrap() / area, 4.0);
}
#[test]
fn exposed_weak_foundation_releases_cap_and_direction_controls_failure() {
    let mix = compile(ModeMix::default().with(ModeId::Shear, 1.0));
    let section = |support, slope| {
        let mut lower = material(support, MapScale::native(20.0), 1.0);
        lower.bed_slope_x = slope;
        vec![
            SectionLayer {
                material: material(8, MapScale::native(10.0), 2.0),
                top: MapScale::native(100.0),
                bottom: MapScale::native(90.0),
                share: 1.0,
                loose: false,
                basement: false,
            },
            SectionLayer {
                material: lower,
                top: MapScale::native(90.0),
                bottom: MapScale::native(70.0),
                share: 1.0,
                loose: false,
                basement: false,
            },
        ]
    };
    let failure = |support, slope, floor, run| {
        support_failure_depth(
            &section(support, slope),
            MapScale::native(floor),
            [1.0, 0.0],
            run,
            1.0,
            &mix,
        )
    };
    near(failure(1, 0.0, 70.0, 50.0), MapScale::native(30.0));
    assert_eq!(failure(1, 0.0, 95.0, 5.0), 0.0);
    assert_eq!(failure(8, 0.0, 70.0, 5.0), 0.0);
    near(failure(1, -1.0, 70.0, 75.0), MapScale::native(30.0));
    assert_eq!(failure(1, 1.0, 70.0, 75.0), 0.0);
}
#[test]
fn transport_opening_removes_donor_cover_cargo_and_sheet() {
    let mut f = fixture();
    let cell = f.cells[0];
    cut(&mut f.ground, cell, 20.0, 0.25);
    f.ground
        .deposit_package(
            cell,
            &[material(3, MapScale::native(2.0), 5.0)],
            "test",
            Pool::Load,
            None,
        )
        .unwrap();
    f.ground.join_sheet(cell, [1.0, 2.0, 3.0], 0.5).unwrap();
    f.ground.form_transport_opening(cell).unwrap();
    let bed = f
        .ground
        .columns()
        .read_layer(cell, Column::Land, 0)
        .unwrap();
    assert_eq!(bed.kind, BASALT);
    assert!(bed.cargo.is_none());
    assert_eq!(
        f.ground.columns().depth(cell, Column::Land, 1).unwrap(),
        0.0
    );
    assert_eq!(f.ground.share(cell, Facet::Cut).unwrap(), 0.0);
    assert_eq!(f.ground.cover_depth(cell, Facet::Land).unwrap(), 0.0);
    assert_eq!(
        f.ground.view(GroundField::ThrustPairIds).get(cell).unwrap(),
        0.0
    );
    assert_eq!(
        f.ground.view(GroundField::Elevation).get(cell).unwrap(),
        f.ground
            .view(GroundField::CrustSupportElevation)
            .get(cell)
            .unwrap()
    );
}
#[test]
fn sediment_motion_moves_actual_material_and_releases_custody() {
    use atlas_generation::transport::TransportShares;
    let mut f = fixture();
    let [source, target] = [f.cells[0], f.cells[1]];
    let mut parcel = material(10, 100.0, 2.0);
    parcel.cargo = Some(atlas_generation::rock::cargo::MaterialCargo::from_entries(
        [(1, 10, 4.0)],
    ));
    f.load.add(source, &parcel).unwrap();
    let mut offsets = f.coverage.scratch(f.mesh.len() + 1, 0u32);
    for i in source + 1..=f.mesh.len() {
        offsets.set(i, 1).unwrap();
    }
    let targets = f.coverage.scratch(1, target as i32);
    let weights = f.coverage.scratch(1, 750000.0);
    let dominant = f.coverage.allocate(-1i32);
    let inflow = f.coverage.allocate(0.0);
    let plan = TransportShares {
        offsets: offsets.read_only(),
        targets: targets.read_only(),
        weights: weights.read_only(),
        dominant: dominant.read_only(),
        inflow: inflow.read_only(),
    };
    f.ground
        .transport_load(&plan, &mut f.load, &mut f.coverage)
        .unwrap();
    assert_eq!(f.load.amount(source).unwrap(), 0.0);
    let arrived = f.load.get(target).unwrap();
    assert_eq!(
        (arrived.depth, arrived.kind, arrived.formed_min),
        (75.0, 10, 2.0)
    );
    assert_eq!(
        arrived.cargo.unwrap().entries().collect::<Vec<_>>(),
        vec![(2, 10, 4.0)]
    );
    near(
        f.load.supply().unwrap().get(target).unwrap(),
        MapScale::in_units(
            75.0 / f.mesh.area(target),
            atlas_generation::scale::LengthUnit::Native,
        ),
    );
}
fn remap(f: &mut Fixture, weights: [f64; 2], rotation: bool) {
    use atlas_generation::transport::{DeformationBands, GroundArrivals};
    let [a, b, target] = [f.cells[0], f.cells[1], f.cells[2]];
    let mut offsets = f.coverage.scratch(f.mesh.len() + 1, 0u32);
    for i in target + 1..=f.mesh.len() {
        offsets.set(i, 2).unwrap();
    }
    let mut sources = f.coverage.scratch(2, 0u32);
    sources.set(0, a as u32).unwrap();
    sources.set(1, b as u32).unwrap();
    let mut areas = f.coverage.scratch(2, 0.0);
    for (i, weight) in weights.into_iter().enumerate() {
        areas.set(i, weight).unwrap();
    }
    let mut xx = f.coverage.allocate(1.0);
    let mut xy = f.coverage.allocate(0.0);
    let mut yx = f.coverage.allocate(0.0);
    let mut yy = f.coverage.allocate(1.0);
    if rotation {
        xx.set(a, 0.0).unwrap();
        xy.set(a, -1.0).unwrap();
        yx.set(a, 1.0).unwrap();
        yy.set(a, 0.0).unwrap();
    }
    let deformation = DeformationBands {
        xx: xx.read_only(),
        xy: xy.read_only(),
        yx: yx.read_only(),
        yy: yy.read_only(),
    };
    let held = f.ground.hold(&mut f.coverage).unwrap();
    let mut mapper =
        remap::GroundRemapper::new(&mut f.ground, &held, &deformation, &mut f.coverage).unwrap();
    mapper
        .place(
            target,
            &GroundArrivals {
                offsets: offsets.read_only(),
                sources: sources.read_only(),
                weights: areas.read_only(),
            },
        )
        .unwrap();
}
#[test]
fn remap_keeps_elevated_contacts_separate_from_lower_donor_basement() {
    let mut f = fixture_with(|storage, columns, cells| {
        for &cell in &cells[..2] {
            for slot in 0..Column::Land.size() {
                columns
                    .set_layer(cell, Column::Land, slot, &Default::default())
                    .unwrap();
            }
            columns
                .set_layer(
                    cell,
                    Column::Land,
                    0,
                    &material(10, MapScale::native(30_000.0), 0.0),
                )
                .unwrap();
        }
        let cell = cells[0];
        columns
            .set_layer(
                cell,
                Column::Land,
                0,
                &material(BASALT, MapScale::native(1000.0), 2.0),
            )
            .unwrap();
        columns
            .set_layer(
                cell,
                Column::Land,
                1,
                &material(10, MapScale::native(30_000.0), 0.0),
            )
            .unwrap();
        storage
            .initialize(
                GroundField::BedrockElevation,
                cell,
                MapScale::native(1100.0),
            )
            .unwrap();
    });
    remap(&mut f, [0.5, 0.5], false);
    let target = f.cells[2];
    near(
        f.ground.view(GroundField::Elevation).get(target).unwrap(),
        MapScale::native(600.0),
    );
    let cap = f
        .ground
        .columns()
        .read_layer(target, Column::Land, 0)
        .unwrap();
    assert_eq!((cap.kind, cap.formed_min), (BASALT, 2.0));
    near(cap.depth, MapScale::native(500.0));
    let base = f
        .ground
        .columns()
        .read_layer(target, Column::Land, 1)
        .unwrap();
    assert_eq!((base.kind, base.secondary_share), (10, 0.0));
    near(
        f.ground
            .view(GroundField::CrustThickness)
            .get(target)
            .unwrap(),
        MapScale::native(30000.0),
    );
}
#[test]
fn remap_rotates_before_mixing_and_keeps_dominant_seam_with_its_strength() {
    let mut f = fixture_with(|storage, columns, cells| {
        for (n, &cell) in cells[..2].iter().enumerate() {
            for slot in 0..Column::Land.size() {
                columns
                    .set_layer(cell, Column::Land, slot, &Default::default())
                    .unwrap();
            }
            let mut layer = material(BASALT, MapScale::native(30000.0), 0.0);
            layer.bed_slope_x = 0.2;
            layer.grain_x = 1000.0;
            columns.set_layer(cell, Column::Land, 0, &layer).unwrap();
            storage
                .initialize(GroundField::CrustSuturePairIds, cell, [7.0, 9.0][n])
                .unwrap();
            storage
                .initialize(GroundField::CrustSutureStrength, cell, [200.0, 900.0][n])
                .unwrap();
        }
    });
    remap(&mut f, [0.75, 0.25], true);
    let target = f.cells[2];
    let bed = f
        .ground
        .columns()
        .read_layer(target, Column::Land, 0)
        .unwrap();
    near(bed.bed_slope_x, 0.05);
    near(bed.bed_slope_y, 0.15);
    near(bed.grain_x, -500.0);
    assert_eq!(
        f.ground
            .view(GroundField::CrustSuturePairIds)
            .get(target)
            .unwrap(),
        7.0
    );
    assert_eq!(
        f.ground
            .view(GroundField::CrustSutureStrength)
            .get(target)
            .unwrap(),
        200.0
    );
}
#[test]
fn remap_reorders_filled_cut_before_subsequent_incision() {
    let mut f = fixture_with(|storage, columns, cells| {
        let cell = cells[0];
        storage
            .initialize(GroundField::GroundCutShare, cell, 0.25)
            .unwrap();
        storage
            .initialize(GroundField::GroundCutDepth, cell, MapScale::native(40.0))
            .unwrap();
        columns
            .set_layer(
                cell,
                Column::Cut,
                0,
                &material(3, MapScale::native(30000.0), 0.0),
            )
            .unwrap();
        columns
            .set_layer(
                cell,
                Column::CutLoose,
                0,
                &material(BASALT, MapScale::native(60.0), 2.0),
            )
            .unwrap();
    });
    remap(&mut f, [1.0, 0.0], false);
    let cell = f.cells[2];
    near(f.ground.share(cell, Facet::Cut).unwrap(), 0.75);
    near(
        f.ground
            .view(GroundField::GroundCutDepth)
            .get(cell)
            .unwrap(),
        MapScale::native(-40.0),
    );
    let mut removed = Vec::new();
    f.ground
        .cut(
            Cut {
                cell,
                depth: MapScale::native(1.0),
                share: 0.75,
                cause: "test",
                floor: f64::NEG_INFINITY,
            },
            &mut |layer| {
                removed.push(layer);
                Ok(())
            },
        )
        .unwrap();
    assert_eq!(removed[0].kind, 10);
    let loose = f
        .ground
        .columns()
        .read_layer(cell, Column::Loose, 0)
        .unwrap();
    assert_eq!(loose.kind, BASALT);
    near(loose.depth, MapScale::native(60.0));
}
#[test]
fn widening_spends_on_intact_material_before_deepening_and_keeps_bed_contacts() {
    let mut f = fixture();
    let cell = f.cells[0];
    cut(&mut f.ground, cell, 30.0, 0.1);
    let actual = cut(&mut f.ground, cell, 10.0, 0.3);
    near(f.ground.share(cell, Facet::Cut).unwrap(), 0.2);
    near(f.ground.surface(cell, Facet::Land).unwrap() / 1024.0, 100.0);
    near(f.ground.surface(cell, Facet::Cut).unwrap() / 1024.0, 70.0);
    assert_eq!(actual.depth, 0.0);
    near(actual.amount / 1024.0, 3.0);
    assert_eq!(
        f.ground.section(cell, Facet::Land).unwrap()[0]
            .material
            .kind,
        10
    );
    assert_eq!(
        f.ground.section(cell, Facet::Cut).unwrap()[0].material.kind,
        1
    );
    cut(&mut f.ground, cell, 20.0, 0.3);
    near(f.ground.surface(cell, Facet::Cut).unwrap() / 1024.0, 60.0);
}
#[test]
fn routed_deposit_lands_after_widening_and_history_records_only_floor_deepening() {
    let mut f = fixture();
    let [target, source] = [f.cells[0], f.cells[1]];
    cut(&mut f.ground, target, 30.0, 0.1);
    let depth = 2048.0 * f.mesh.area(target) / f.mesh.area(source);
    f.ground
        .deposit_package(
            source,
            &[material(8, depth, 6.0)],
            "supply",
            Pool::Load,
            None,
        )
        .unwrap();
    let height = f.ground.view(GroundField::Elevation);
    let before = height.get(target).unwrap();
    let mut stage = Stage::new(
        &mut f.ground,
        &mut f.coverage,
        &f.mesh,
        &mut f.load,
        Sharing::Simultaneous,
    );
    stage
        .cut(
            &WearCause {
                id: "river".into(),
                remembers: "incision".into(),
                past_base_level: false,
            },
            target,
            10240.0,
            0.3,
            true,
        )
        .unwrap();
    stage
        .move_loose(source, target, 2.0 * f.mesh.area(target), "transport")
        .unwrap();
    assert_eq!(height.get(target).unwrap(), before);
    stage.settle().unwrap();
    near(f.ground.share(target, Facet::Cut).unwrap(), 0.2);
    assert_eq!(f.history.get(target).unwrap(), 0.0);
    near(
        f.ground
            .view(GroundField::SedimentThickness)
            .get(target)
            .unwrap()
            / 1024.0,
        2.0,
    );
    let section = f.ground.section(target, Facet::Land).unwrap();
    assert_eq!(
        (section[0].material.kind, section[1].material.kind),
        (8, 10)
    );
}
#[test]
fn simultaneous_routes_share_each_sources_starting_cover_and_preserve_its_material() {
    let mut f = fixture();
    let [source, a, b] = [f.cells[0], f.cells[1], f.cells[2]];
    f.ground
        .deposit_package(
            source,
            &[material(3, 4096.0, 6.0)],
            "supply",
            Pool::Load,
            None,
        )
        .unwrap();
    let offered = 8.0 * f.mesh.area(source);
    let mut stage = Stage::new(
        &mut f.ground,
        &mut f.coverage,
        &f.mesh,
        &mut f.load,
        Sharing::Simultaneous,
    );
    stage.move_loose(source, a, offered, "a").unwrap();
    stage.move_loose(source, b, offered, "b").unwrap();
    stage.settle().unwrap();
    for target in [a, b] {
        let layer = &f.ground.section(target, Facet::Land).unwrap()[0];
        assert_eq!(
            (
                layer.material.kind,
                layer.material.formed_min,
                layer.material.consolidation
            ),
            (3, 6.0, 0.0)
        );
        near(
            layer.material.depth / 1024.0,
            2.0 * f.mesh.area(source) / f.mesh.area(target),
        );
    }
    assert_eq!(f.ground.cover_depth(source, Facet::Land).unwrap(), 0.0);
}
#[test]
fn weathering_keeps_cover_placement_and_material_order() {
    let mut f = fixture();
    let cell = f.cells[0];
    f.ground
        .deposit_package(cell, &[material(3, 2048.0, 7.0)], "cover", Pool::Load, None)
        .unwrap();
    let height = f.ground.view(GroundField::Elevation);
    let before = height.get(cell).unwrap();
    f.ground
        .weather_facets(cell, [12288.0; 2], "weather")
        .unwrap();
    near(height.get(cell).unwrap(), before);
    let section = f.ground.section(cell, Facet::Land).unwrap();
    assert_eq!(
        section
            .iter()
            .take(3)
            .map(|layer| layer.material.kind)
            .collect::<Vec<_>>(),
        vec![3, 10, 1]
    );
    assert!(section.iter().take(3).all(|layer| layer.loose));
    assert_eq!(section[3].material.kind, 1);
    assert_eq!(
        section[1]
            .material
            .cargo
            .as_ref()
            .unwrap()
            .entries()
            .next()
            .unwrap()
            .0,
        2
    );
}

#[test]
fn selective_extraction_uses_original_contacts_beneath_the_cap_and_retains_custody() {
    use atlas_generation::rock::{
        cargo::MaterialCargo,
        extraction::{Extraction, ExtractionKind},
    };
    let mut f = fixture();
    let cell = f.cells[0];
    for (kind, depth, age) in [(4, 4.0, 1.0), (8, 2.0, 2.0), (4, 1.0, 4.0), (10, 1.0, 5.0)] {
        let mut bed = material(kind, MapScale::native(depth), age);
        if age == 4.0 {
            bed.cargo = Some(MaterialCargo::from_entries([(1, 4, 3.0)]));
        }
        f.ground
            .construct_material(cell, &bed, "construction", Pool::Space, None)
            .unwrap();
    }
    let height = f.ground.view(GroundField::Elevation).get(cell).unwrap();
    let action = Extraction {
        kind: ExtractionKind::One(4),
        amount: 20480.0,
        reach: 4096.0,
        surface_only: false,
        loose_only: false,
        select: None,
    };
    let mut receipts = Vec::new();
    f.ground
        .extract(cell, &action, "solution", Pool::Load, &mut |material| {
            receipts.push(material);
            Ok(())
        })
        .unwrap();
    let section = f.ground.section(cell, Facet::Land).unwrap();
    assert_eq!(
        section
            .iter()
            .take(3)
            .map(|layer| layer.material.kind)
            .collect::<Vec<_>>(),
        vec![10, 8, 4]
    );
    assert_eq!(section[0].material.formed_min, 5.0);
    assert_eq!(section[2].material.depth, 4096.0);
    assert_eq!(
        f.ground.view(GroundField::Elevation).get(cell).unwrap(),
        height - 1024.0
    );
    assert_eq!(
        receipts[0]
            .cargo
            .as_ref()
            .unwrap()
            .entries()
            .next()
            .unwrap()
            .0,
        1
    );
    let surface = Extraction {
        surface_only: true,
        reach: f64::INFINITY,
        ..action
    };
    assert_eq!(
        f.ground
            .extract(cell, &surface, "wind", Pool::Load, &mut |_| Ok(()))
            .unwrap(),
        0.0
    );
}

#[test]
fn alteration_splits_only_the_reached_interval_and_keeps_placement_and_deeper_material() {
    use atlas_generation::rock::{
        ground::alteration::{alter_interval, Alteration},
        material::MaterialLayer,
        transforms::heated_material,
    };
    let mut f = fixture();
    let cell = f.cells[0];
    f.ground
        .deposit_package(
            cell,
            &[material(3, 20480.0, 4.0)],
            "cover",
            Pool::Load,
            None,
        )
        .unwrap();
    let before = f.ground.view(GroundField::Elevation).get(cell).unwrap();
    let transform = |layer: &MaterialLayer| Some(heated_material(layer, 9.0));
    f.ground
        .alter(
            cell,
            &Alteration {
                depth: 10240.0,
                offset: 5120.0,
                from_rock: false,
                retained_only: false,
                facet: None,
                transform: &transform,
            },
        )
        .unwrap();
    let section = f.ground.section(cell, Facet::Land).unwrap();
    assert_eq!(
        section
            .iter()
            .take(3)
            .map(|layer| (layer.material.kind, layer.material.depth))
            .collect::<Vec<_>>(),
        vec![(3, 5120.0), (7, 10240.0), (3, 5120.0)]
    );
    assert_eq!(section[1].material.formed_min, 4.0);
    assert_eq!(
        f.ground.view(GroundField::Elevation).get(cell).unwrap(),
        before
    );
    let basement = material(9, 1.0, 2.0);
    let altered = alter_interval(
        std::slice::from_ref(&basement),
        30.0,
        45.0,
        &transform,
        true,
        false,
    )
    .unwrap();
    assert_eq!(
        altered.iter().map(|layer| layer.depth).collect::<Vec<_>>(),
        vec![30.0, 15.0, 1.0]
    );
    assert_eq!(altered[2].kind, basement.kind);
    assert!(alter_interval(&[basement], 30.0, 45.0, &|_| None, true, false).is_none());
}

#[test]
fn physical_displacement_bends_contacts_while_translation_keeps_their_dip() {
    let mut f = fixture();
    let mut movement = f.coverage.allocate(2048.0);
    let cell = f
        .cells
        .iter()
        .copied()
        .find(|&cell| (0..3).all(|edge| f.mesh.neighbor(cell, edge).is_some()))
        .unwrap();
    f.ground
        .displace_field(&movement.read_only(), "translation")
        .unwrap();
    near(
        f.ground.section(cell, Facet::Land).unwrap()[0]
            .material
            .bed_slope_x,
        0.0,
    );
    for cell in 0..f.mesh.len() {
        let [x, y] = f.mesh.position(cell);
        movement.set(cell, (x * 0.2 - y * 0.3) * 1024.0).unwrap();
    }
    f.ground
        .displace_field(&movement.read_only(), "bend")
        .unwrap();
    let layer = &f.ground.section(cell, Facet::Land).unwrap()[0].material;
    near(layer.bed_slope_x, 0.2);
    near(layer.bed_slope_y, -0.3);
    assert_eq!(layer.formed_min, 4.0);
    let cargo = layer.cargo.clone();
    f.ground.transform(cell, [0.0, -1.0, 1.0, 0.0]).unwrap();
    let layer = &f.ground.section(cell, Facet::Land).unwrap()[0].material;
    near(layer.bed_slope_x, 0.3);
    near(layer.bed_slope_y, 0.2);
    assert_eq!(layer.cargo, cargo);
}
#[test]
fn top_down_solvent_stops_at_insoluble_cap_and_surface_queries_read_real_loose_material() {
    let mut f = fixture();
    let [a, b] = [f.cells[0], f.cells[1]];
    let mix = compile(ModeMix::default().with(ModeId::Solution, 1.0));
    // Soil is a surface skin. Remove it through the ordinary ground owner first.
    for cell in [a, b] {
        f.ground
            .withdraw(
                Withdrawal {
                    cell,
                    facet: Facet::Land,
                    pool: MaterialPool::Rock,
                    amount: 1024.0,
                    cause: "skin",
                    soil: 1.0,
                },
                &mut |_| Ok(()),
            )
            .unwrap();
    }
    assert_eq!(
        f.ground
            .act_on(
                SurfaceAction {
                    cell: a,
                    mix: &mix,
                    power: 100.0,
                    limit: 102400.0,
                    direction: [0.0; 2]
                },
                Facet::Land
            )
            .unwrap(),
        0.0
    );
    f.ground
        .deposit_package(a, &[material(4, 25600.0, 0.0)], "salt", Pool::Load, None)
        .unwrap();
    f.ground
        .deposit_package(b, &[material(8, 25600.0, 0.0)], "basalt", Pool::Load, None)
        .unwrap();
    assert!(
        f.ground.gives(a, &mix, [0.0; 2]).unwrap() > f.ground.gives(b, &mix, [0.0; 2]).unwrap()
    );
}

#[test]
fn buried_valley_fill_hardens_at_its_own_depth_and_visitor_reads_both_constituents() {
    use atlas_generation::rock::ground::query::{average, ground_fact, Fact, GroundQuery};
    let mut f = fixture();
    let cell = f.cells[0];
    f.ground.open_cut(cell, 0.2).unwrap();
    f.ground
        .deposit_package(
            cell,
            &[material(8, 8192.0, 0.0)],
            "land",
            Pool::Load,
            Some(Facet::Land),
        )
        .unwrap();
    f.ground
        .deposit_package(
            cell,
            &[material(3, 409600.0, 3.0)],
            "valley",
            Pool::Load,
            Some(Facet::Cut),
        )
        .unwrap();
    f.ground
        .lithify_buried(cell, 1024000.0, 0.5, "burial")
        .unwrap();
    let land = f.ground.section(cell, Facet::Land).unwrap();
    let valley = f.ground.section(cell, Facet::Cut).unwrap();
    assert_eq!((land[0].loose, land[0].material.depth), (true, 10240.0));
    assert_eq!(
        (valley[0].loose, valley[0].material.depth),
        (true, 1536000.0)
    );
    assert_eq!(
        (
            valley[1].loose,
            valley[1].material.depth,
            valley[1].material.kind,
            valley[1].material.altered
        ),
        (false, 512000.0, 3, 8.0)
    );
    let mut porosity = GroundQuery::new(0.0);
    porosity.rock = Some(Box::new(|_, layer, _| ground_fact(layer, Fact::Porosity)));
    let result = f.ground.fold(cell, &average(porosity), None).unwrap();
    near(
        result,
        kind_of_code(10).facts.porosity * 0.8 + kind_of_code(3).facts.porosity * 0.2,
    );
}

#[test]
fn ground_publication_reconciles_actual_water_and_persistent_load_projects_supply() {
    use atlas_generation::water::column::{
        CapturedColumn, WaterColumn, WaterMedium, NO_WATER_SURFACE,
    };
    use std::cell::RefCell;
    let mut f = fixture();
    let cell = f.cells[0];
    let mut column = WaterColumn::new(
        &mut f.coverage,
        WaterMedium {
            elevation: f.ground.view(GroundField::Elevation),
            soil_capacity: Rc::new(|_| Ok(1.0)),
            groundwater_capacity: Rc::new(|_| Ok(10.0)),
        },
    );
    column
        .inherit(
            cell,
            CapturedColumn {
                snow: 0.0,
                soil: 0.0,
                ground: 2.0,
                standing: 10240.0,
                surface: 112640.0,
                kind: 2,
                body: 7,
            },
        )
        .unwrap();
    let water = column.read_only();
    let column = Rc::new(RefCell::new(column));
    let sink = column.clone();
    f.ground
        .bind_water(move |cell| sink.borrow_mut().reconcile(cell));
    f.ground.displace(cell, 20480.0, "uplift").unwrap();
    assert_eq!(
        (
            water.kind.get(cell).unwrap(),
            water.surface.get(cell).unwrap()
        ),
        (0, NO_WATER_SURFACE)
    );
    let supply = f.load.supply().unwrap();
    f.load
        .add(cell, &material(3, 2.0 * f.mesh.area(cell), 0.0))
        .unwrap();
    near(supply.get(cell).unwrap(), 2048.0);
    f.load.take(cell, f.mesh.area(cell)).unwrap();
    near(supply.get(cell).unwrap(), 1024.0);
    f.load.clear(cell).unwrap();
    assert_eq!(supply.get(cell).unwrap(), 0.0);
}
