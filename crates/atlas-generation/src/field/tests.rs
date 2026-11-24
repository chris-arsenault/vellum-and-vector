use super::{shared::Scalar, FieldSeed};
use crate::{
    lattice::WorldLatticeOptions,
    rock::{
        catalogue,
        columns::Column,
        ground::{observers::GroundObservers, GroundField},
    },
    scale::MapScale,
    storage::{BlockCache, BlockScratch, RandomAccessFile},
    water::column::{CapturedColumn, Store},
};
use atlas_map::Bounds;
use std::{
    io::{self, Read, Seek, SeekFrom, Write},
    rc::Rc,
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[derive(Default)]
pub(super) struct MemoryFile(io::Cursor<Vec<u8>>);
impl RandomAccessFile for MemoryFile {
    fn read(&mut self, into: &mut [u8], offset: u64) -> io::Result<usize> {
        self.0.seek(SeekFrom::Start(offset))?;
        self.0.read(into)
    }
    fn write(&mut self, bytes: &[u8], offset: u64) -> io::Result<usize> {
        self.0.seek(SeekFrom::Start(offset))?;
        self.0.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub(super) fn seed() -> FieldSeed {
    let mesh = Rc::new(
        WorldLatticeOptions::default()
            .build(Bounds(0.0, 0.0, 100.0, 100.0), 16.0, 0.0, |_, _| true)
            .unwrap(),
    );
    let scale = MapScale::new(100.0, 100.0, mesh.cell_span()).unwrap();
    FieldSeed::new(
        mesh,
        scale,
        BlockCache::new(1_000_000, BlockScratch::new(MemoryFile::default())),
    )
}

#[test]
fn surveyed_harvest_outlives_the_parent_sampling_coverage() {
    let mut seed = seed();
    {
        let cache = BlockCache::new(1_000_000, BlockScratch::new(MemoryFile::default()));
        let mut sampled = crate::storage::Coverage::samples(1, cache);
        let food = sampled.allocate(80.0);
        let farmland = sampled.allocate(0.5);
        let residents = sampled.allocate(150.0);
        seed.capture_harvest(&food, &farmland, &residents).unwrap();
    }
    let field = seed.finish(Box::<GroundObservers>::default()).unwrap();
    let harvest = field.harvest.as_ref().unwrap();
    assert_eq!(harvest.food.get(0).unwrap(), 80.0);
    assert_eq!(harvest.farmland.get(0).unwrap(), 0.5);
    assert_eq!(harvest.residents.get(0).unwrap(), 150.0);
}

#[test]
fn captured_grid_projects_categories_and_values_past_the_child_boundary() {
    use super::projection::sampling::Interpolation;
    use crate::storage::Coverage;

    let mesh = WorldLatticeOptions::default()
        .build(Bounds(0.0, 0.0, 100.0, 100.0), 16.0, 0.0, |_, _| true)
        .unwrap();
    let points = [mesh.position(0), [500.0, 500.0], [-500.0, -500.0]];
    assert!(mesh.cell_at(points[1][0], points[1][1]).is_none());
    let mut coverage = Coverage::samples(
        points.len(),
        BlockCache::new(1_000_000, BlockScratch::new(MemoryFile::default())),
    );
    let projection =
        Interpolation::new(&mesh, points.len(), |i| Ok(points[i]), &mut coverage).unwrap();
    for discrete in [true, false] {
        let mut values = vec![0.0; points.len()];
        projection
            .project(
                &|cell| {
                    assert!(cell < mesh.len(), "Only map cells can supply samples");
                    Ok(7.0)
                },
                discrete,
                |start, block| {
                    values[start..start + block.len()].copy_from_slice(block);
                    Ok(())
                },
            )
            .unwrap();
        assert!(values.iter().all(|value| (*value - 7.0).abs() < 1e-9));
    }
}

#[test]
fn final_human_projection_replaces_earlier_capture_with_settled_land() {
    use super::projection::Surface;
    use crate::{
        human::{catalogue::LayerId, HumanField},
        reconstruction::{Grid, Layout},
        storage::Coverage,
    };

    let mut seed = seed();
    for cell in 0..seed.shared.scalar(Scalar::Temperature).len() {
        for (layer, value) in [(LayerId::Population, 80.0), (LayerId::Farmland, 0.5)] {
            seed.people
                .initialize(HumanField::Layer(layer), cell, value)
                .unwrap();
        }
    }
    let field = seed.finish(Box::<GroundObservers>::default()).unwrap();
    let cache = BlockCache::new(1_000_000, BlockScratch::new(MemoryFile::default()));
    let grid = Grid {
        bounds: [0.0, 0.0, 100.0, 100.0],
        periodic_width: None,
        layout: Layout::Raster {
            width: 2,
            height: 2,
        },
        measures: Coverage::samples(4, cache.clone())
            .allocate(2_500.0)
            .read_only(),
        donors: Default::default(),
    };
    let mut surface = Surface::new(grid, &field, cache).unwrap();
    surface
        .sample_channel("Population", "people/square-kilometre", |_| Ok(1.0))
        .unwrap();
    surface
        .sample_channel("Farmland", "ratio", |_| Ok(0.0))
        .unwrap();
    surface.project_people(&field).unwrap();
    assert_eq!(
        surface.channels()["Population"].values().get(0).unwrap(),
        80.0
    );
    assert_eq!(surface.channels()["Farmland"].values().get(0).unwrap(), 0.5);
    assert!(!surface.channels().contains_key("Pasture"));
}

#[test]
fn travel_takes_and_withdraws_offered_non_adjacent_steps() {
    use super::people::country::spread;
    use crate::links::{Link, Offers};
    let field = seed().finish(Box::<GroundObservers>::default()).unwrap();
    let cells: Vec<_> = (0..field.mesh().len()).collect();
    let first = cells[0];
    let far = *cells.last().unwrap();
    let step = |a, b| {
        let [x, y] = field.mesh().position(a);
        let [u, v] = field.mesh().position(b);
        Ok((u - x).hypot(v - y))
    };
    let mut offers = Offers::default();
    let without = spread(&field, &[first], &step, f64::INFINITY, None, &offers).unwrap();
    let id = offers.offer("a test door", move |_| {
        Ok(vec![Link {
            a: first,
            b: far,
            cost: 1.0,
        }])
    });
    let through = spread(&field, &[first], &step, f64::INFINITY, None, &offers).unwrap();
    assert_eq!(through.cost.get(far).unwrap(), 1.0);
    assert!(through.cost.get(far).unwrap() < without.cost.get(far).unwrap());
    offers.withdraw(id);
    assert!(offers.links(&field).unwrap().is_empty());
    let again = spread(&field, &[first], &step, f64::INFINITY, None, &offers).unwrap();
    assert!(again.cost.get(far).unwrap() > through.cost.get(far).unwrap());
}
#[test]
fn catalog() {
    let field = seed().finish(Box::<GroundObservers>::default()).unwrap();
    let bands = field.bands();
    let mut names: Vec<_> = bands.iter().map(|band| band.name.as_str()).collect();
    names.sort_unstable();
    assert!(
        !names.windows(2).any(|pair| pair[0] == pair[1]),
        "A canonical field is owned twice"
    );
    assert!(bands
        .iter()
        .all(|band| band.values.len() == field.mesh().len()));
    let declaration: Vec<_> = bands
        .iter()
        .map(|band| (&band.name, band.values.sample_type(), band.quantity))
        .collect();
    // Used by the TypeScript architecture check to compare the current schemas, not numerical output.
    println!(
        "FIELD_SCHEMA={}",
        serde_json::to_string(&declaration).unwrap()
    );
}
#[test]
fn capacity_reads_current_soil_and_material_and_ground_reconciles_the_owned_column() {
    let mut seed = seed();
    seed.ground
        .storage
        .initialize(GroundField::SoilDepth, 0, 2.0)
        .unwrap();
    seed.shared
        .scalar_mut(Scalar::SoilCarbon)
        .set(0, 30.0)
        .unwrap();
    seed.ground
        .columns
        .set_layer(
            0,
            Column::Land,
            0,
            &catalogue::material(catalogue::SANDSTONE, 2000.0, 0.0),
        )
        .unwrap();
    let mut field = seed.finish(Box::<GroundObservers>::default()).unwrap();
    let water = field.water();
    assert!((water.column.store(Store::Soil).capacity(0).unwrap() - 0.54).abs() < 1e-9);
    field
        .shared_mut()
        .scalar_mut(Scalar::SoilCarbon)
        .set(0, 0.0)
        .unwrap();
    assert!((water.column.store(Store::Soil).capacity(0).unwrap() - 0.24).abs() < 1e-9);
    let capacity = water.column.store(Store::Ground).capacity(0).unwrap();
    assert!(capacity > 0.0);
    field
        .water
        .borrow_mut()
        .inherit_column(
            0,
            CapturedColumn {
                snow: 0.0,
                soil: 0.0,
                ground: 0.0,
                standing: 100.0,
                surface: 100.0,
                kind: 2,
                body: 7,
            },
            [0.0; 14],
        )
        .unwrap();
    // A material operation may hold the river owner while ground notifies its column.
    let retained_water = field.water.borrow_mut();
    field
        .ground
        .borrow_mut()
        .shift(0, 30.0, "explicit test input")
        .unwrap();
    assert_eq!(
        water
            .column
            .store(Store::Standing)
            .contents()
            .get(0)
            .unwrap(),
        70.0
    );
    field
        .ground
        .borrow_mut()
        .shift(0, 100.0, "explicit test input")
        .unwrap();
    assert_eq!(water.column.kind.get(0).unwrap(), 0);
    drop(retained_water);
    // Read views do not keep an owner or its run workspace alive after disposal.
    drop(field);
    assert!(water.column.store(Store::Ground).capacity(0).is_err());
    assert!(water.column.kind.get(0).is_err());
}

#[test]
fn dispatched_settlement_records_canonical_history_and_preserves_material_receipts() {
    use crate::{
        execution::{CommandKind, Executor},
        settlement::{stage::WearCause, Sharing},
    };
    let mut seed = seed();
    seed.ground
        .storage
        .initialize(GroundField::BedrockElevation, 0, 2000.0)
        .unwrap();
    seed.ground
        .columns
        .set_layer(
            0,
            Column::Land,
            0,
            &catalogue::material(catalogue::BASALT, 1000.0, 0.0),
        )
        .unwrap();
    let field = seed.finish(Box::<GroundObservers>::default()).unwrap();
    let history = field.shared.scalar(Scalar::CumulativeFluvialErosion);
    let elevation = field.ground().view(GroundField::Elevation);
    let load = field.ground_load.view();
    let work = super::Field::stage_command(
        "test.explicit-removal",
        CommandKind::Work,
        vec![],
        Sharing::Simultaneous,
        |stage, amount: &f64, _| {
            stage.wear(
                &WearCause {
                    id: "streams".into(),
                    remembers: "CumulativeFluvialErosion".into(),
                    past_base_level: false,
                },
                0,
                *amount,
                *amount,
            )
        },
    );
    let mut executor = Executor::new(field);
    executor.run_with(&work, &100.0).unwrap();
    assert_eq!(history.get(0).unwrap(), 100.0);
    assert_eq!(elevation.get(0).unwrap(), 1900.0);
    assert_eq!(load.kind().get(0).unwrap(), catalogue::BASALT as u32);
    assert!(
        load.scalar(crate::rock::layer_bands::MaterialScalar::Depth)
            .get(0)
            .unwrap()
            > 0.0
    );
}

#[test]
fn derived_reads_compose_and_refresh_after_an_opaque_water_command() {
    use super::water::{InheritWater, WaterOperations};
    use crate::{
        execution::{Executor, Query},
        water::column::NO_WATER_SURFACE,
    };
    let field = seed().finish(Box::<GroundObservers>::default()).unwrap();
    let operations = WaterOperations::new();
    let runoff = operations.runoff.clone();
    let query = Query::new(
        "test.runoff-inspection",
        vec![runoff.dependency()],
        move |_, context| {
            context
                .get(&runoff)?
                .mean
                .get(0)
                .map_err(|error| crate::execution::ExecutionError::Failed(error.to_string()))
        },
    );
    let mut executor = Executor::new(field);
    executor.select(&operations.runoff);
    executor.select(&query);
    assert_eq!(*executor.query(&query).unwrap(), 0.0);
    let input = InheritWater {
        cell: 0,
        column: CapturedColumn {
            snow: 0.5,
            soil: 0.1,
            ground: 0.2,
            standing: 0.0,
            surface: NO_WATER_SURFACE,
            kind: 0,
            body: 0,
        },
        year: [120.0; 14],
    };
    executor.run_with(&operations.inherit, &input).unwrap();
    assert_eq!(*executor.query(&query).unwrap(), 1440.0);
    assert_eq!(*executor.query(&query).unwrap(), 1440.0);
    assert_eq!(
        executor
            .state()
            .water()
            .column
            .store(Store::Snow)
            .held(0)
            .unwrap(),
        0.5
    );
}

#[test]
fn contributions_replace_actual_changes_without_spending_the_same_bounded_amount_twice() {
    use super::contributions::{Contributions, Medium};
    let mut field = seed().finish(Box::<GroundObservers>::default()).unwrap();
    let mut ledger = Contributions::default();
    let medium = Medium::Shared(Scalar::GrassCover);
    field
        .shared
        .scalar_mut(Scalar::GrassCover)
        .set(0, 0.8)
        .unwrap();
    ledger
        .add(medium, 0, 0.5, field.coverage.get_mut())
        .unwrap();
    ledger.commit(&mut field, Medium::bounds).unwrap();
    assert!((ledger.applied_to(medium, 0).unwrap() - 0.2).abs() < 1e-9);
    ledger.commit(&mut field, Medium::bounds).unwrap();
    assert_eq!(field.shared.scalar(Scalar::GrassCover).get(0).unwrap(), 1.0);
    ledger.begin().unwrap();
    ledger.commit(&mut field, Medium::bounds).unwrap();
    assert!((field.shared.scalar(Scalar::GrassCover).get(0).unwrap() - 0.8).abs() < 1e-9);
    field
        .shared
        .scalar_mut(Scalar::GrassCover)
        .set(0, 0.1)
        .unwrap();
    ledger.forget(medium);
    ledger
        .add(medium, 0, 0.2, field.coverage.get_mut())
        .unwrap();
    ledger.commit(&mut field, Medium::bounds).unwrap();
    assert!((field.shared.scalar(Scalar::GrassCover).get(0).unwrap() - 0.3).abs() < 1e-9);
}

#[test]
fn coupled_answers_use_the_run_coverage_and_read_the_same_owners() {
    use crate::{
        answers::{QuestionBook, Responder, ResponseKind},
        execution::Executor,
    };
    let field = seed().finish(Box::<GroundObservers>::default()).unwrap();
    let operations = super::water::WaterOperations::new();
    let runoff = operations.runoff.clone();
    let mut book = QuestionBook::default();
    book.respond(
        0u8,
        Responder {
            by: "climate".into(),
            queries: vec![runoff.dependency()],
            kind: ResponseKind::Base(Box::new(move |_, cell, answers| {
                answers
                    .queries()
                    .get(&runoff)?
                    .mean
                    .get(cell)
                    .map_err(|error| crate::execution::ExecutionError::Failed(error.to_string()))
            })),
        },
    )
    .unwrap();
    let answer = super::Field::question(Rc::new(book), "surfaceWater", 0);
    let mut executor = Executor::new(field);
    executor.select(&operations.runoff);
    executor.select(&answer);
    let values = executor.query(&answer).unwrap();
    assert_eq!(values.values().get(0).unwrap(), 0.0);
    drop(executor);
    assert!(values.values().get(0).is_err());
}
