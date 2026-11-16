use atlas_generation::{
    scale::{LengthUnit, MapScale, RelativeMeasure},
    scale_settings::*,
};
use serde_json::json;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn fixed_detail_uses_area_and_profile_without_a_cell_count() {
    use atlas_generation::atlas::resolution::{Profile, Quality};
    assert_eq!(Quality::Draft.cell_area_km2(Profile::World), Ok(800.0));
    assert_eq!(Quality::Standard.cell_area_km2(Profile::World), Ok(200.0));
    assert_eq!(Quality::Fine.cell_area_km2(Profile::World), Ok(50.0));
    assert_eq!(Quality::Standard.cell_area_km2(Profile::Region), Ok(2.0));
    for profile in [Profile::Local, Profile::Site, Profile::Interior] {
        assert!(profile.real_scale());
        assert!(Quality::Standard.cell_span(profile).is_err());
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn real_scale_hexes_are_built_from_triangles_whatever_the_detail() {
    use atlas_generation::{
        atlas::resolution::{HexSize, Quality},
        lattice::TRIANGLE_AREA,
    };
    let sizes = HexSize::ALL.map(HexSize::across_flats);
    assert_eq!(sizes, [1.5, 3.0, 10.0, 30.0, 100.0, 300.0]);
    for hex in HexSize::ALL {
        let flats = hex.across_flats();
        let hex_area = 3.0_f64.sqrt() / 2.0 * flats * flats;
        for quality in [Quality::Draft, Quality::Standard, Quality::Fine] {
            let n = f64::from(quality.triangles_per_hex_edge());
            let span = quality.real_scale_span(hex);
            let triangle_area = span * span;
            let spacing = span / TRIANGLE_AREA.sqrt();
            assert!((hex_area / triangle_area - 6.0 * n * n).abs() < 1e-9);
            assert!((3.0 * n * spacing - flats).abs() < 1e-9);
        }
    }
    assert!(
        Quality::Fine.real_scale_span(HexSize::TenMetres)
            < Quality::Draft.real_scale_span(HexSize::TenMetres)
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn standard_region_has_default_world_cell_count_at_seven_land_regions() {
    use atlas_generation::atlas::resolution::{Profile, Quality};
    let world_area = MapScale::REFERENCE_WIDTH * MapScale::REFERENCE_HEIGHT;
    let world_cells = world_area / Quality::Standard.cell_span(Profile::World).unwrap().powi(2);
    let regional_area = world_area * 0.35 / 7.0;
    let regional_cells = regional_area / Quality::Standard.regional_span(1).unwrap().powi(2);
    assert!((0.95..1.05).contains(&(regional_cells / world_cells)));
    assert!(
        Quality::Standard.regional_span(2).unwrap() < Quality::Standard.regional_span(1).unwrap()
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn nested_declarations_resolve_fractions_and_preserve_unmeasured_settings() {
    let scale = MapScale::new(400.0, 300.0, 10.0).unwrap();
    let measure = json!({"kind":"relative-measure", "fraction":0.1,
        "dimension":1, "exponent":1, "unit":"m"});
    let definition = ScaleDefinition::from_value(json!({"kind":"relative-settings", "values":{
        "radius":measure, "layers":[{"width":measure,"enabled":true}, measure], "label":"map"
    }}))
    .unwrap();
    let overrides = RelativeOverrides::from_value(json!({"radius":0.2,
        "layers":[{"width":0.05,"enabled":false}], "label":null, "extra":true}));
    let result = scale.resolve_settings(&definition, &overrides).unwrap();
    assert_eq!(
        result.values(),
        &json!({"radius":80.0,
        "layers":[{"width":20.0,"enabled":false},40.0],"label":"map"})
    );
    assert!(ScaleDefinition::from_value(result.values().clone()).is_err());
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn fractional_dimensions_units_and_sampling_have_distinct_meanings() {
    let scale = MapScale::from_cells([10.0, 20.0, 410.0, 320.0], 1200.0).unwrap();
    let root = scale
        .resolve(RelativeMeasure::new(2.0, 0.5, 1.0, LengthUnit::Metre).unwrap())
        .unwrap();
    assert_eq!(root.value(), 40.0);
    assert_eq!(scale.cell_count(30.0), 3.0);
    assert_eq!(
        scale
            .measure_fraction(root, 1.0, LengthUnit::Metre)
            .unwrap(),
        2.0
    );
    assert!(RelativeMeasure::new(1.0, f64::INFINITY, 1.0, LengthUnit::Metre).is_err());
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn current_atlas_profile_binds_environmental_operation_settings() {
    use atlas_generation::atlas::{
        environment::{Environment, Questions},
        parameters::AtlasParameters,
        profile,
    };
    let scale = MapScale::new(4_000_000.0, 3_000_000.0, 10_000.0).unwrap();
    let settings = scale
        .atlas_profile(
            &AtlasParameters::default(),
            &profile::definition(),
            &RelativeOverrides::from_value(json!({})),
        )
        .unwrap();
    let questions = Questions::default();
    let environment = Environment::new(&settings, &questions, false, None).unwrap();
    atlas_generation::atlas::state::Settings::new(&settings, &settings).unwrap();
    let mut responders = atlas_generation::answers::QuestionBook::default();
    environment
        .respond(
            &mut responders,
            settings.values()["FluvialReferenceRunoff"]
                .as_f64()
                .unwrap(),
        )
        .unwrap();
    assert!(questions.book().is_err());
    questions.bind(responders).unwrap();
    assert!(questions.book().is_ok());
    assert!(questions.bind(Default::default()).is_err());
}
