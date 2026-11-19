#![cfg(not(target_arch = "wasm32"))]
//! The supplied raster cases from domain/fieldExtrema.test.ts; no generation setup.
use atlas_generation::{
    field::schema::NumericBand,
    lattice::BLOCK_CELLS,
    reconstruction::{
        extrema::{Field, Query},
        Grid, Layout,
    },
    storage::{BlockCache, BlockScratch, Coverage},
};
use atlas_gis::geometry::NativeGeos;
use atlas_host::native::NativeScratch;
use atlas_map::{regions::rectangle, Bounds, Geometry, Position};

fn range(
    name: &str,
    values: [f64; 4],
    footprint: &Geometry,
    region: &Geometry,
) -> Option<[f64; 2]> {
    let path = std::env::temp_dir().join(format!(
        "atlas-extrema-{}-{name}.blocks",
        std::process::id()
    ));
    let cache = BlockCache::new(
        BLOCK_CELLS * 8 * 4,
        BlockScratch::new(NativeScratch::create_new(path).unwrap()),
    );
    let mut coverage = Coverage::samples(4, cache);
    let mut band = coverage.allocate(0.0);
    for (i, value) in values.into_iter().enumerate() {
        band.set(i, value).unwrap();
    }
    let grid = Grid {
        bounds: [0.0, 0.0, 100.0, 100.0],
        periodic_width: None,
        layout: Layout::Raster {
            width: 2,
            height: 2,
        },
        measures: coverage.allocate(2500.0).read_only(),
        donors: Default::default(),
    };
    let field = Field {
        grid: &grid,
        footprint,
        values: NumericBand::F64(band.read_only()),
        discrete: false,
        overlays: Vec::new(),
    };
    Query {
        spatial: &NativeGeos::new(1e-6).unwrap(),
        precision: 1e-6,
        coverage: &mut coverage,
    }
    .range(&field, region)
    .unwrap()
}
#[test]
fn bilinear_support_inside_clipped_footprints_needs_no_active_vertices() {
    let footprint = Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(0.0, 50.0),
            Position::xy(50.0, 0.0),
            Position::xy(100.0, 50.0),
            Position::xy(50.0, 100.0),
            Position::xy(0.0, 50.0),
        ]],
    };
    assert_eq!(
        range("clipped", [1000.0; 4], &footprint, &footprint),
        Some([1000.0, 1000.0])
    );
}
#[test]
fn diagonal_constraint_edges_include_their_interior_extrema() {
    let footprint = rectangle(Bounds(0.0, 0.0, 100.0, 100.0));
    let region = Geometry::LineString {
        coordinates: vec![Position::xy(0.0, 0.0), Position::xy(100.0, 100.0)],
    };
    assert_eq!(
        range("diagonal", [0.0, 1.0, 1.0, 0.0], &footprint, &region),
        Some([0.0, 0.5])
    );
}
