//! Explicit parcels, sponsors and terrain exercise the same commission and fabric edits as a town.
use atlas_generation::{
    processes::town::{Candidate, Frontage},
    town::{
        fabric::{Proposal, Town},
        ground::{Ground, WATER},
        influence::{Conditions, Opportunities},
        land_sites,
        major_works::{advance, commission, InheritedWork, WorkFamily, WorkOrigin},
        seat::Seat,
        story::Story,
        templates::Habitat,
    },
};
use atlas_gis::geometry::NativeGeos;
use atlas_map::{spatial::SpatialKernel, Bounds, Id};

fn settlement(population: f64) -> Town {
    Town::new(
        Seat {
            key: Id::from_name("test"),
            name: "Test".into(),
            centre: [0., 0.],
            story: Story {
                people: population,
                ..Default::default()
            },
            arms: vec![],
            culture: None,
        },
        None,
    )
}
fn site_conditions() -> Conditions {
    Conditions {
        bank: true,
        flowing: true,
        cultivated: 0.8,
        building: 1.,
        craft: Some(2),
        ..Default::default()
    }
}
fn build(town: &mut Town, ground: &mut Ground, spatial: &dyn SpatialKernel) {
    let anchors: Vec<_> = town.works.active_sites().collect();
    let land = site_conditions();
    let candidates = land_sites::around(anchors, 70., 12., 22., town.round)
        .into_iter()
        .map(|mut slot| {
            if ground.owner(slot.front) == WATER {
                slot.habitat = Habitat::Floating;
            }
            Candidate {
                conditions: Conditions {
                    bank: !slot.habitat.wet(),
                    ..land
                },
                slot,
                opportunities: Opportunities::new(&[], land),
            }
        })
        .collect::<Vec<_>>();
    let walking = ground.clone();
    let conditions = vec![land; town.holdings().len()];
    let links = town
        .template
        .site
        .door
        .zip(town.template.site.works.paired_door)
        .map(|(a, b)| (a, b, 1.))
        .into_iter()
        .collect::<Vec<_>>();
    town.effort = 100.;
    advance(
        town,
        &mut Frontage {
            walking_ground: &walking,
            outlying: &[],
            links: &links,
            sources: &[],
            ground,
            spatial,
            candidates: &candidates,
            conditions: &conditions,
            exposure: 1.,
        },
    )
    .unwrap();
    town.round += 1;
}
#[test]
fn each_inherited_work_builds_distinct_operating_premises_around_reserved_ground() {
    let spatial = NativeGeos::new(0.001).unwrap();
    for &family in WorkFamily::ALL {
        let mut town = settlement(50.);
        town.template.site.works.deep_water = Some([0., 300.]);
        town.template.site.works.paired_door = Some([240., 0.]);
        town.template.site.door = Some([0., 0.]);
        let capture = InheritedWork {
            family,
            design: None,
            id: Id::from_name("kept"),
            anchor: [0., 0.],
        };
        commission(&mut town, 15, std::slice::from_ref(&capture));
        commission(&mut town, 15, &[capture]);
        let mut ground = Ground::new([-350., -350., 350., 450.], 3.);
        let water = if family == WorkFamily::FloatingHall {
            [-350., -350., 350., 450.]
        } else {
            [-120., 220., 120., 400.]
        };
        for cell in ground.cells_within(water) {
            ground.withhold(cell, WATER);
        }
        for _ in 0..7 {
            build(&mut town, &mut ground, &spatial);
        }
        assert_operating_premises(&town, family, &spatial);
        if family == WorkFamily::PortalHostel {
            town.template.site.works.paired_door = None;
            build(&mut town, &mut ground, &spatial);
            assert!(!town.works.commissions[0].operating(&town));
        }
    }
}

fn assert_operating_premises(town: &Town, family: WorkFamily, spatial: &dyn SpatialKernel) {
    let [work] = town.works.commissions.as_slice() else {
        panic!("duplicate inherited {family:?}");
    };
    assert!(
        work.complete(),
        "{family:?} established {} components",
        work.members.len()
    );
    assert_eq!(work.inherited_id, Some(Id::from_name("kept")));
    assert!(work.operating(town));
    if family == WorkFamily::PortalHostel {
        let transfer = &town.holdings()[work.members[1].0 as usize];
        assert!((transfer.slot.front[0] - 240.).abs() < 34.);
    }
    let reserved = work.grounds.as_ref().unwrap();
    assert!(spatial.area(reserved).unwrap() > 1.);
    for member in &work.members {
        let h = &town.holdings()[member.0 as usize];
        assert!(h.occupation > 0. && (h.outdoor || !h.buildings.is_empty()));
        assert!(
            spatial
                .intersection_areas(reserved, std::slice::from_ref(&h.outline))
                .unwrap()[0]
                < 0.01
        );
    }
}

#[test]
fn a_city_commission_and_a_rare_local_subscription_build_the_same_library() {
    let spatial = NativeGeos::new(0.001).unwrap();
    for (people, origin, sponsor_count) in [
        (400_000., WorkOrigin::Commissioned, 0),
        (300., WorkOrigin::Organic, 2),
    ] {
        let mut town = settlement(people);
        let mut ground = Ground::new([-350., -350., 350., 350.], 3.);
        commission(&mut town, 4, &[]);
        if origin == WorkOrigin::Organic {
            assert!(town.works.commissions.is_empty());
            establish_archivists(&mut town, &spatial);
        }
        for _ in 0..7 {
            build(&mut town, &mut ground, &spatial);
        }
        check_library(&mut town, origin, sponsor_count, &spatial);
    }
}

fn check_library(
    town: &mut Town,
    origin: WorkOrigin,
    sponsor_count: usize,
    spatial: &dyn SpatialKernel,
) {
    let libraries = town
        .works
        .commissions
        .iter()
        .filter(|w| w.family == WorkFamily::Library)
        .collect::<Vec<_>>();
    assert_eq!(libraries.len(), 1);
    let library = libraries[0];
    assert_eq!(library.origin, origin);
    assert!(library.complete());
    assert_eq!(library.sponsors.len(), sponsor_count);
    assert!(library.operating(town));
    let Bounds(w, s, e, n) = spatial.bounds(library.grounds.as_ref().unwrap()).unwrap();
    assert!(e > w && n > s);
    town.occupy(library.members[0], 0., 0., 0., 0.);
    assert!(!town
        .works
        .commissions
        .iter()
        .find(|w| w.family == WorkFamily::Library)
        .unwrap()
        .operating(town));
}

fn establish_archivists(town: &mut Town, spatial: &dyn SpatialKernel) {
    let slots = land_sites::around([[-70., 0.]], 42., 10., 15., 0);
    for slot in [slots.first().unwrap(), slots.last().unwrap()] {
        let kind = serde_json::from_value(serde_json::json!("Learning")).unwrap();
        let id = town
            .establish(
                Proposal {
                    slot: slot.clone(),
                    kind,
                    means: 1.,
                    priority: 1.,
                    cause: "archivist".into(),
                },
                spatial,
            )
            .unwrap()
            .unwrap();
        town.occupy(id, 1., 1., 1., 0.);
    }
}

#[test]
fn captured_library_keeps_its_program_while_a_different_site_can_found_another() {
    let mut parent = settlement(400_000.);
    commission(&mut parent, 4, &[]);
    let library = parent
        .works
        .commissions
        .iter()
        .find(|w| w.family == WorkFamily::Library)
        .unwrap();
    let inherited = InheritedWork {
        family: library.family,
        id: Id::from_name("inherited-library"),
        anchor: [800., 800.],
        design: Some(library.design.clone()),
    };
    let mut child = settlement(1_500_000.);
    commission(&mut child, 93, &[inherited]);
    let libraries: Vec<_> = child
        .works
        .commissions
        .iter()
        .filter(|w| w.family == WorkFamily::Library)
        .collect();
    assert_eq!(libraries.len(), 2);
    let retained = libraries
        .iter()
        .find(|w| w.origin == WorkOrigin::Inherited)
        .unwrap();
    assert_eq!(retained.design.program(), library.design.program());
    assert_eq!(
        retained.design.component_count(),
        library.design.component_count()
    );
    assert!(libraries
        .iter()
        .any(|w| w.origin == WorkOrigin::Commissioned && w.anchor == child.seat.centre));
}

#[test]
fn libraries_with_different_programs_build_different_premises_and_public_grounds() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut first: Option<(String, Vec<_>, String)> = None;
    for seed in 0..32 {
        let mut town = settlement(50.);
        commission(
            &mut town,
            seed,
            &[InheritedWork {
                family: WorkFamily::Library,
                id: Id::from_name("library"),
                anchor: [0., 0.],
                design: None,
            }],
        );
        let w = &town.works.commissions[0];
        if first
            .as_ref()
            .is_some_and(|(program, _, _)| program == w.design.program())
        {
            continue;
        }
        let mut ground = Ground::new([-700., -700., 700., 700.], 3.);
        for _ in 0..7 {
            build(&mut town, &mut ground, &spatial);
        }
        let w = &town.works.commissions[0];
        assert!(w.operating(&town));
        let uses = w
            .members
            .iter()
            .map(|id| town.holdings()[id.0 as usize].kind)
            .collect::<Vec<_>>();
        if let Some((_, uses_before, grounds)) = &first {
            assert_ne!(&uses, uses_before);
            assert_ne!(w.design.grounds_label(), grounds);
            return;
        }
        first = Some((
            w.design.program().into(),
            uses,
            w.design.grounds_label().into(),
        ));
    }
    panic!("no second library program was constructed");
}
