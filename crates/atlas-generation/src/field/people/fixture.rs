//! Small fields for testing people's mechanisms on real bands: a square of land fine enough
//! that a map-relative reach crosses several cells, people and identity columns laid on it,
//! water where a test puts it, and plain bands for the answers a question would give.
use crate::{
    field::{tests::MemoryFile, Field, FieldSeed},
    human::{
        catalogue::LayerId,
        identity::{IdentityLayer, Tradition, TRADITIONS},
        HumanField,
    },
    lattice::{TriangularLattice as Lattice, WorldLatticeOptions},
    rock::ground::observers::GroundObservers,
    scale::MapScale,
    storage::{BlockCache, BlockScratch, ReadBand},
    water::column::{CapturedColumn, NO_WATER_SURFACE},
};
use atlas_map::Bounds;
use std::rc::Rc;

/// The side of the test land, in the map's units, and how many cells cover it: about eighty
/// across, so two hundredths of the span is about one and a half cells.
pub const SIDE: f64 = 1000.0;
const CELLS: f64 = 6000.0;

/// A layer of `people` speaking `tongue`, knowing `known`, holding with `realm` and keeping
/// `craft` (zero for none).
pub fn layer(people: f64, tongue: i32, known: i32, realm: i32, craft: i32) -> IdentityLayer {
    let mut traditions = [0; TRADITIONS];
    traditions[Tradition::Tongue as usize] = tongue;
    traditions[Tradition::Known as usize] = known;
    traditions[Tradition::Allegiance as usize] = realm;
    traditions[Tradition::Craft as usize] = craft;
    IdentityLayer {
        people,
        traditions,
        ..Default::default()
    }
}
/// The test land: every cell dry, empty and level, before `settle` lays people on it.
pub fn land(settle: impl FnOnce(&mut FieldSeed, &Lattice)) -> Field {
    let mesh = Rc::new(
        WorldLatticeOptions::default()
            .build(Bounds(0.0, 0.0, SIDE, SIDE), CELLS, 0.0, |_, _| true)
            .unwrap(),
    );
    let scale = MapScale::new(SIDE, SIDE, mesh.cell_span()).unwrap();
    let mut seed = FieldSeed::new(
        mesh.clone(),
        scale,
        BlockCache::new(4_000_000, BlockScratch::new(MemoryFile::default())),
    );
    settle(&mut seed, &mesh);
    seed.finish(Box::<GroundObservers>::default()).unwrap()
}
/// The cell nearest the given point of the test land's mesh.
pub fn point(mesh: &Lattice, x: f64, y: f64) -> usize {
    let [ox, oy] = mesh.origin();
    mesh.cell_at(x - ox, y - oy).unwrap()
}
/// Lays `column` on `cell`, with the population its layers add to.
pub fn people(seed: &mut FieldSeed, cell: usize, column: &[IdentityLayer]) {
    let total: f64 = column.iter().map(|layer| layer.people).sum();
    seed.people
        .initialize(HumanField::Layer(LayerId::Population), cell, total)
        .unwrap();
    seed.people.initialize_column(cell, column).unwrap();
}
/// Puts open water on `cell`.
pub fn water(field: &Field, cell: usize) {
    field
        .water
        .borrow_mut()
        .inherit_column(
            cell,
            CapturedColumn {
                snow: 0.0,
                soil: 0.0,
                ground: 0.0,
                standing: 1.0,
                surface: NO_WATER_SURFACE,
                kind: 1,
                body: 1,
            },
            [0.0; 14],
        )
        .unwrap();
}
/// A band holding `value(cell)` on every cell, as a question's answer would.
pub fn band(field: &Field, value: impl Fn(usize) -> f64) -> ReadBand<f64> {
    let mut band = field.coverage.borrow_mut().allocate(0.0);
    for cell in 0..field.mesh.len() {
        band.set(cell, value(cell)).unwrap();
    }
    band.read_only()
}
/// The cell nearest the given point of the test land.
pub fn at(field: &Field, x: f64, y: f64) -> usize {
    point(&field.mesh, x, y)
}
/// A living place at `anchor` over `cells`.
pub fn place(id: &str, anchor: usize, cells: Vec<usize>, town_people: f64) -> super::places::Place {
    super::places::Place {
        id: id.into(),
        anchor,
        cells,
        founded: "test".into(),
        abandoned: None,
        tongue: None,
        absorbed_by: None,
        adopted: None,
        town_people,
        peak: town_people,
        people: town_people,
        built_km2: 0.0,
        works: 0.0,
        hinterland: None,
        history: Vec::new(),
        contested_by: None,
    }
}
/// The going over plain, unwooded land: friction one, no climbing cost, no rivers.
pub fn plain_travel(field: &Field) -> super::travel::Travel<'_> {
    let rivers = {
        let mut band = field.coverage.borrow_mut().allocate(0u32);
        band.set(0, 0).unwrap();
        Rc::new(band.read_only())
    };
    super::travel::Travel::new(field, band(field, |_| 1.0), band(field, |_| 1.0), rivers).unwrap()
}
/// The cells next to `cell`.
pub fn neighbours(field: &Field, cell: usize) -> Vec<usize> {
    (0..3)
        .filter_map(|edge| field.mesh.neighbor(cell, edge))
        .collect()
}
