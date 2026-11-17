#![cfg(not(target_arch = "wasm32"))]
//! The existing 25-sample publication fixture, with Rust sampling through GeoTIFF encoding.
use atlas_generation::{
    control::CancellationToken,
    field::{
        inheritance::resources::{Channel, Resource},
        projection::channels::Quantity,
    },
    publication::{
        fields,
        sampling::{self, Source},
        upload::RasterPublication,
    },
    reconstruction::{Grid, Layout},
    scale::MapScale,
    storage::{BlockCache, BlockScratch, Coverage},
};
use atlas_gis::geometry::NativeGeos;
use atlas_host::{native::NativeScratch, native_control::NativeControl};
use atlas_map::{regions::rectangle, Bounds};
use std::{cell::RefCell, collections::BTreeMap, io::Cursor, rc::Rc};

#[test]
fn publishes_physical_shores_display_height_and_gradients() {
    let path =
        std::env::temp_dir().join(format!("atlas-map-sampling-{}.blocks", std::process::id()));
    let cache = BlockCache::new(
        8_000_000,
        BlockScratch::new(NativeScratch::create_new(path).unwrap()),
    );
    let mut storage = Coverage::samples(25, cache.clone());
    let mut heights = storage.allocate(0.0);
    for i in 0..25 {
        heights
            .set(
                i,
                MapScale::native(100.0 + (i % 5) as f64 * 250.0 + (i / 5) as f64 * 125.0),
            )
            .unwrap();
    }
    let mut classes = storage.allocate(0.0);
    let mut surfaces = storage.allocate(0.0);
    let patch_classes = storage.allocate(2.0).read_only();
    for i in 0..25 {
        classes.set(i, if i % 5 >= 2 { 1.0 } else { 0.0 }).unwrap();
        surfaces.set(i, f64::from(i % 5 + i / 5 >= 4)).unwrap();
    }
    let mut field = Resource::new(
        Rc::new(Grid {
            bounds: [0.0, 0.0, 100.0, 100.0],
            periodic_width: None,
            layout: Layout::Raster {
                width: 5,
                height: 5,
            },
            measures: storage.allocate(625.0).read_only(),
        }),
        storage.allocate(1u8).read_only(),
        BTreeMap::from([
            (
                "finalSurface".into(),
                Channel {
                    values: surfaces.read_only().into(),
                    unit: "category".into(),
                    quantity: Quantity::Category,
                },
            ),
            (
                "naturalSurface".into(),
                Channel {
                    values: surfaces.read_only().into(),
                    unit: "category".into(),
                    quantity: Quantity::Category,
                },
            ),
            (
                "Elevation".into(),
                Channel {
                    values: heights.read_only().into(),
                    unit: "native-length".into(),
                    quantity: Quantity::Intensive,
                },
            ),
            (
                "PhysicalMaterial".into(),
                Channel {
                    values: classes.read_only().into(),
                    unit: "category".into(),
                    quantity: Quantity::Category,
                },
            ),
        ]),
        None,
        storage,
    );
    let footprint = rectangle(Bounds(0.0, 0.0, 100.0, 100.0));
    let spatial = NativeGeos::new(1e-6).unwrap();
    let entities = BTreeMap::new();
    let fields = fields::Fields {
        entities: &entities,
        systems: &[],
        confluences: &[],
    };
    assert_category_presence(&mut field, patch_classes, &fields, &spatial);
    let _evidence_owner = install_retained_contributions(&mut field, cache.clone());
    let ocean = rectangle(Bounds(0.0, 0.0, 20.0, 100.0));
    let colors = ["#206020", "#c0a060"]
        .into_iter()
        .enumerate()
        .map(|(value, color)| atlas_map::Category {
            value: value as i32,
            label: format!("Cover {value}"),
            color: Some(color.into()),
            present: true,
            surface: None,
            soluble: None,
        })
        .collect::<Vec<_>>();
    let source = Source {
        field: &field,
        channel: "Elevation",
        footprint: &footprint,
        bounds: Bounds(0.0, 0.0, 100.0, 100.0),
        wrap: None,
        water: None,
        ice: None,
        surface: Some(&field),
        colors: &colors,
        ocean: Some(&ocean),
        lakes: &[],
    };
    let grid = sampling::grid(&source).unwrap();
    assert_eq!((grid.width, grid.height), (64, 64));
    let input = fields::input(&fields, &source, "terrain".into(), &spatial).unwrap();
    assert_eq!(input.planes[0].band.display.factor, 1.0 / 1024.0);
    assert_eq!(input.planes[4].band.id, "sample-span");
    assert_eq!(input.planes[8].band.id, "east-gradient");
    assert!(
        input.planes[5]
            .band
            .categories
            .iter()
            .any(|c| c.value == 1 && c.present),
        "Retained neighbouring classes belong in the published legend"
    );
    let mut output = RasterPublication::new(input, Coverage::samples(0, cache.clone())).unwrap();
    let working = RefCell::new(Coverage::samples(25, cache));
    let control = NativeControl::new(CancellationToken::default(), |_| {});
    let prepared = futures::executor::block_on(sampling::Prepared::new(
        &source, grid, &working, &spatial, &control,
    ))
    .unwrap();
    futures::executor::block_on(sampling::publish(
        &source,
        &prepared,
        &mut output,
        &working,
        &spatial,
        &control,
    ))
    .unwrap();
    let mut bytes = Cursor::new(Vec::new());
    futures::executor::block_on(output.finish(&mut bytes, &control)).unwrap();
    bytes.set_position(0);
    assert_map_pixels(bytes);
}
fn install_retained_contributions(
    field: &mut Resource,
    cache: atlas_generation::storage::SharedCache,
) -> Coverage {
    // The nearest donor is cover 0, while its retained neighbours favour cover 1.
    // Publication must use those contributions instead of inventing a blended colour.
    let mut evidence_storage = Coverage::samples(0, cache);
    let donors = evidence_storage.scratch(25, 0.0f64).read_only();
    for name in ["finalSurface", "naturalSurface"] {
        field.channels.get_mut(name).unwrap().values = donors.clone().into();
    }
    let mut evidence = evidence_storage.scratch(
        25 * atlas_generation::field::projection::support::STRIDE,
        0.0,
    );
    for cell in 0..25 {
        let at = cell * atlas_generation::field::projection::support::STRIDE;
        evidence.set(at, 0.0).unwrap();
        evidence.set(at + 1, 0.25).unwrap();
        evidence.set(at + 2, 1.0).unwrap();
        evidence.set(at + 3, 0.75).unwrap();
    }
    field.surface_support = Some(atlas_generation::field::projection::support::ReadSupport {
        final_surface: evidence.read_only(),
        natural: evidence.read_only(),
    });
    evidence_storage
}

fn assert_category_presence(
    field: &mut Resource,
    patch_classes: atlas_generation::storage::ReadBand<f64>,
    fields: &fields::Fields<'_>,
    spatial: &NativeGeos,
) {
    let footprint = rectangle(Bounds(0.0, 0.0, 100.0, 100.0));
    let present = |resource: &Resource, shape: &atlas_map::Geometry| {
        fields::inspection_band(fields, resource, "PhysicalMaterial", shape, spatial)
            .unwrap()
            .categories
            .into_iter()
            .filter(|c| c.present)
            .map(|c| c.value)
            .collect::<Vec<_>>()
    };
    assert_eq!(present(field, &footprint), vec![0, 1]);
    // Class 1 starts at x=37.5. Boundary contact alone does not put it in the legend.
    assert_eq!(
        present(field, &rectangle(Bounds(0.0, 0.0, 37.5, 100.0))),
        vec![0]
    );
    assert_eq!(
        present(field, &rectangle(Bounds(37.0, 0.0, 38.0, 100.0))),
        vec![0, 1]
    );
    let mut patch = field.clone();
    patch.channels.get_mut("PhysicalMaterial").unwrap().values = patch_classes.into();
    field
        .overlays
        .push(atlas_generation::field::inheritance::resources::Overlay {
            footprint: rectangle(Bounds(37.5, 0.0, 100.0, 100.0)),
            channels: vec!["PhysicalMaterial".into()],
            resource: Rc::new(patch),
        });
    assert_eq!(present(field, &footprint), vec![0, 2]);
}

fn assert_map_pixels(bytes: Cursor<Vec<u8>>) {
    let mut decoder = tiff::decoder::Decoder::new(bytes).unwrap();
    let mut plane = |band| {
        let tiff::decoder::DecodingResult::F32(pixels) = decoder.read_chunk(band).unwrap() else {
            panic!("Map pixels")
        };
        pixels
    };
    let water = plane(2);
    assert_eq!(water[0], 1.0); // Positive ground remains covered by the published ocean geometry.
    let center = 32 * 64 + 32;
    assert_eq!(water[center], 0.0);
    assert_eq!(plane(7)[center], 853.90625);
    assert_eq!(plane(8)[center], 10.0);
    assert_eq!(plane(14)[center], 1.0);
    assert_eq!(plane(15)[center], 1.0);
    let classes = plane(5);
    let red = plane(11);
    let pixels = (0..64)
        .flat_map(|y| (0..64).map(move |x| y * 64 + x))
        .collect::<Vec<_>>();
    assert!(pixels.iter().all(|&i| classes[i] == 1.0));
    assert!(
        pixels.iter().all(|&i| red[i] == 192.0),
        "Surface paint must use the winning retained class before choosing its colour"
    );
}

#[test]
fn capture_layout_depends_on_footprint_not_map_profile() {
    use atlas_generation::atlas::{
        initial,
        resolution::{Profile, Quality},
        state::Scope,
        workspace::Frame,
    };
    use atlas_map::{Geometry, Position};
    let bounds = Bounds(0.0, 0.0, 100.0, 100.0);
    let rectangle = rectangle(bounds);
    let triangle = Geometry::Polygon {
        coordinates: vec![vec![
            Position::xy(0.0, 0.0),
            Position::xy(100.0, 0.0),
            Position::xy(0.0, 100.0),
            Position::xy(0.0, 0.0),
        ]],
    };
    let spatial = NativeGeos::new(1e-6).unwrap();
    for (shape, regular) in [(&rectangle, true), (&triangle, false)] {
        for profile in [Profile::World, Profile::Region] {
            let scope = Scope {
                world: "world".into(),
                area: "area".into(),
                area_name: "Map".into(),
                space: "space".into(),
                world_geography: profile == Profile::World,
                owns_map_geography: true,
                area_parents: Default::default(),
                domain: rectangle.clone(),
                domain_bounds: bounds,
                footprint: shape.clone(),
                cylindrical: false,
                has_boundary: false,
                precision: 1e-6,
                generation_domains: Default::default(),
                contracted: Default::default(),
                real_scale: None,
            };
            let path = std::env::temp_dir().join(format!(
                "atlas-capture-{}-{profile:?}-{regular}.blocks",
                std::process::id()
            ));
            let cache = BlockCache::resident(
                8_000_000,
                BlockScratch::new(NativeScratch::create_new(path).unwrap()),
            );
            let captured = initial::construct(
                &Frame {
                    scope: &scope,
                    chart: shape,
                    bounds,
                    quality: Quality::Draft,
                    profile,
                    has_parent: false,
                    child_resolution: None,
                    coordinate_width: None,
                    boundary_mode: 0.0,
                },
                initial::Source {
                    records: &[],
                    ancestors: &[],
                    owned_geography: true,
                    reopened: false,
                    surface_span: Some(25.0),
                },
                &spatial,
                cache,
            )
            .unwrap();
            assert_eq!(
                matches!(captured.inputs.surface.grid.layout, Layout::Raster { .. }),
                regular
            );
            assert!(!captured.inputs.surface.active.is_empty());
        }
    }
}

#[test]
fn retained_contributions_reconstruct_both_sample_layouts() {
    use atlas_generation::reconstruction::{build, classes, grid_build};
    let path =
        std::env::temp_dir().join(format!("atlas-class-layouts-{}.blocks", std::process::id()));
    let cache = BlockCache::resident(
        8_000_000,
        BlockScratch::new(NativeScratch::create_new(path).unwrap()),
    );
    let spatial = NativeGeos::new(1e-6).unwrap();
    let bounds = [0.0, 0.0, 100.0, 100.0];
    let footprint = rectangle(Bounds(0.0, 0.0, 100.0, 100.0));
    let adaptive = build::adaptive(
        bounds,
        build::Sampling {
            minimum_size: 50.0,
            maximum_size: 50.0,
        },
        |_, _| Ok(true),
        cache.clone(),
    )
    .unwrap();
    for layout in [
        Layout::Raster {
            width: 2,
            height: 2,
        },
        Layout::Adaptive(Box::new(adaptive)),
    ] {
        let mut sampled = grid_build::create(
            grid_build::Frame {
                bounds,
                footprint: &footprint,
                periodic_width: None,
                precision: 1e-6,
            },
            layout,
            &spatial,
            cache.clone(),
        )
        .unwrap();
        let count = sampled.active.len();
        let mut evidence = sampled.coverage.scratch(
            count * atlas_generation::field::projection::support::STRIDE,
            0.0,
        );
        for cell in 0..count {
            let x = sampled.grid.position(cell).unwrap()[0] / 100.0;
            let at = cell * atlas_generation::field::projection::support::STRIDE;
            evidence.set(at, 0.0).unwrap();
            evidence.set(at + 1, 1.0 - x).unwrap();
            evidence.set(at + 2, 1.0).unwrap();
            evidence.set(at + 3, x).unwrap();
        }
        let values = sampled.coverage.allocate(0.0f64).read_only().into();
        let source = classes::Surface {
            grid: &sampled.grid,
            values,
            active: sampled.active.read_only(),
            support: Some(evidence.read_only()),
            overlays: Vec::new(),
        };
        let scratch = RefCell::new(Coverage::samples(0, cache.clone()));
        let mut sampler = classes::Sampler::new(&source, &scratch);
        assert_eq!(sampler.sample([25.0, 50.0], None).unwrap(), 0.0);
        assert_eq!(sampler.sample([75.0, 50.0], None).unwrap(), 1.0);
        assert!(
            sampler
                .sample([25.0, 50.0], Some(&|code| code == 1))
                .unwrap()
                < 0.0
        );
        assert!(
            sampler
                .sample([75.0, 50.0], Some(&|code| code == 1))
                .unwrap()
                > 0.0
        );
    }
}
