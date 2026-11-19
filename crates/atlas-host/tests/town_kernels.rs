#![cfg(not(target_arch = "wasm32"))]
use atlas_generation::town::{
    fabric::Town,
    founding::establish,
    ground::{Ground, WATER},
    influence::Conditions,
    seat::Seat,
    story::Story,
    templates::{Selection, SiteEvidence, Template, Tenure},
};
use atlas_gis::geometry::NativeGeos;

/// A dry plateau beside the west bank, with an eastern shore 100 metres away.
/// No fields have yet been cleared in the native grove.
fn site() -> (SiteEvidence, Ground) {
    let mut ground = Ground::new([-260., -260., 260., 260.], 2.);
    for cell in 0..ground.count() {
        if (50.0..150.0).contains(&ground.centre(cell)[0]) {
            ground.withhold(cell, WATER);
        }
    }
    let survey = SiteEvidence {
        centre: [0., 0.],
        upper: Some([-90., 35.]),
        lower: Some([-20., -35.]),
        shore: Some([48., 0.]),
        far_shore: Some([152., 0.]),
        afloat: Some([85., 0.]),
        submerged: Some([110., 30.]),
        door: Some([-80., -50.]),
        grove: Some([-60., 65.]),
        witness: Some([10., -75.]),
        institution: Some([-90., 0.]),
        industry: Some([-40., -90.]),
        approaches: vec![[-240., 0.], [240., 0.]],
        guarded: true,
        old: true,
        vowed: true,
        ..Default::default()
    };
    (survey, ground)
}

#[test]
fn eligible_templates_can_realize_their_kernel_in_supplied_habitats() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let (survey, ground) = site();
    let ranked = Selection::choose(survey, 0.);
    assert_eq!(ranked.ranked.len(), Template::ALL.len());
    for choice in &ranked.ranked {
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("example"),
                name: "Example".into(),
                centre: ranked.site.centre,
                story: Story {
                    people: 5000.,
                    ..Default::default()
                },
                arms: vec![],
                culture: None,
            },
            None,
        );
        town.template = ranked.clone();
        town.template.selected = choice.template;
        let local = |p: [f64; 2]| {
            Ok(Some(Conditions {
                bank: (p[0] - 50.).abs() < 15. || (p[0] - 150.).abs() < 15.,
                rooted: p[0] < -25. && p[1] > 30.,
                ..Default::default()
            }))
        };
        assert!(
            establish(&mut town, &ground, &spatial, local).unwrap(),
            "{} stopped after {} founding occupations",
            choice.template.name(),
            town.holdings().len()
        );
        if choice.template == Template::Compound {
            assert!(town
                .holdings()
                .iter()
                .any(|h| h.slot.tenure == Tenure::Dependent));
            assert!(town
                .holdings()
                .iter()
                .any(|h| h.slot.tenure == Tenure::Institutional));
        }
    }
}
