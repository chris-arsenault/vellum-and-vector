use atlas_generation::{
    lattice::WorldLatticeOptions,
    tectonics::{
        allocation::{self, Candidate, Growth, Layout},
        controls::plate_travel,
        motion::{edge_allowance, move_point, site_motion},
        state::{Plate, Province, Site},
        territories::Territories,
    },
};
use atlas_map::Bounds;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

fn candidate(x: f64, y: f64) -> Candidate {
    Candidate {
        position: [x, y],
        priority: 0.0,
    }
}
fn contacts(count: usize, edges: &[[usize; 2]]) -> Vec<u8> {
    let mut result = vec![0; count * count];
    for &[a, b] in edges {
        result[a * count + b] = 1;
        result[b * count + a] = 1;
    }
    result
}
#[test]
fn plate_travel_uses_duration_and_travel_share_without_a_strength_input() {
    assert_eq!(plate_travel(1000.0, 20.0, 1.0), 20_000.0);
    assert_eq!(plate_travel(1000.0, 40.0, 0.5), 20_000.0);
    assert_eq!(plate_travel(1000.0, 20.0, 0.0), 0.0);
}
#[test]
fn plate_drift_resolves_from_the_maps_size_without_following_its_resolution() {
    use atlas_generation::{
        scale::MapScale, scale_settings::RelativeOverrides, tectonics::province_settings,
    };
    let drift = |width, height, cell_span| {
        let resolved = MapScale::new(width, height, cell_span)
            .unwrap()
            .resolve_settings(
                &province_settings::settings(),
                &RelativeOverrides::default(),
            )
            .unwrap();
        province_settings::Settings::from_resolved(&resolved)
            .unwrap()
            .plate_drift_per_myr
    };
    assert_eq!(drift(400.0, 300.0, 1.0), 10.0);
    assert_eq!(drift(400.0, 300.0, 10.0), 10.0);
    assert_eq!(drift(800.0, 600.0, 1.0), 20.0);
}
#[test]
fn boundary_width_uses_distance_to_the_bisector_and_loaded_opening_is_a_rift() {
    use atlas_generation::tectonics::provinces::{bisector_distance, boundary_code};
    assert_eq!(bisector_distance(90.0, 110.0, 20.0), 100.0);
    assert_eq!(boundary_code(-0.2, 0.0, 0.12), 1);
    assert_eq!(boundary_code(0.2, 0.0, 0.12), 2);
    assert_eq!(boundary_code(0.01, 0.03, 0.12), 2);
    assert_eq!(boundary_code(0.01, 0.0, 0.12), 3);
}
#[test]
fn weld_rule_requires_closing_motion_and_taken_up_opening() {
    use atlas_generation::tectonics::{fracture::can_weld, state::Bond};
    let mut bond = Bond {
        a: 0,
        b: 1,
        strength: 1.0,
        extension: 0.1,
        shortening: 0.2,
        broken: true,
        active: true,
        suture: false,
    };
    assert!(!can_weld(&bond, -0.01));
    bond.shortening = 0.4;
    assert!(can_weld(&bond, -0.05));
    assert!(!can_weld(&bond, -0.2));
    bond.shortening = 0.7;
    assert!(can_weld(&bond, -0.2));
    assert!(!can_weld(&bond, 0.01));
}
#[test]
fn accretion_follows_the_nucleus_and_does_not_cross_another_assembly() {
    let sites = [
        candidate(0.0, 0.0),
        candidate(1.0, 0.0),
        candidate(0.0, 1.0),
        candidate(2.0, 0.0),
    ];
    let adjacent = contacts(4, &[[0, 1], [0, 2], [1, 3]]);
    let growth = Growth {
        seed: 17,
        cohesion: 1.0,
        adjacent: &adjacent,
        width: 0.0,
    };
    assert_eq!(
        allocation::next_continental_province(&sites, &[1, 1, 0, 0], 1, 0, &growth, |_| true),
        Some(2)
    );
    assert_eq!(
        allocation::next_continental_province(&sites, &[1, 2, 2, 0], 1, 0, &growth, |_| true),
        None
    );
    assert_eq!(
        allocation::next_continental_province(
            &sites,
            &[1, 2, 2, 0],
            1,
            0,
            &Growth {
                cohesion: 0.0,
                ..growth
            },
            |_| true
        ),
        Some(3)
    );
}
#[test]
fn accretion_uses_periodic_distance_and_ranks_only_eligible_provinces() {
    let sites = [
        candidate(9.5, 0.0),
        candidate(0.5, 0.0),
        candidate(7.5, 0.0),
    ];
    let adjacent = contacts(3, &[[0, 1], [0, 2]]);
    let growth = Growth {
        seed: 17,
        cohesion: 1.0,
        adjacent: &adjacent,
        width: 10.0,
    };
    assert_eq!(
        allocation::next_continental_province(&sites, &[1, 0, 0], 1, 0, &growth, |_| true),
        Some(1)
    );
    assert_eq!(
        allocation::next_continental_province(&sites, &[1, 0, 0], 1, 0, &growth, |i| i != 1),
        Some(2)
    );
    assert_eq!(
        allocation::next_continental_province(
            &sites,
            &[1, 0, 0],
            1,
            0,
            &Growth {
                width: 0.0,
                ..growth
            },
            |_| true
        ),
        Some(2)
    );
}
fn allocation_input() -> ([Candidate; 6], Territories, Layout) {
    let sites = [
        candidate(0.0, 0.0),
        candidate(1.0, 0.0),
        candidate(2.0, 0.0),
        candidate(2.0, 1.0),
        candidate(1.0, 1.0),
        candidate(0.0, 1.0),
    ];
    let territory = Territories {
        areas: vec![1.0; 6],
        adjacent: contacts(6, &[[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]),
    };
    let layout = Layout {
        assemblies: 1,
        continental_fraction: 0.5,
        clustering: 1.0,
        growth_variation: 0.0,
        major_assemblies: 1,
        major_growth: 2.0,
        ocean_plates: 1,
        ocean_water_share: 1.0,
    };
    (sites, territory, layout)
}
#[test]
fn allocation_uses_continental_material_before_grouping_the_remaining_ocean() {
    let (sites, territory, layout) = allocation_input();
    let mixed = allocation::allocate(&sites, &territory, layout, 17, 0.0);
    assert!(mixed.continents.contains(&1));
    assert!(mixed.oceans.contains(&1));
    for (continent, ocean) in mixed.continents.iter().zip(&mixed.oceans) {
        assert_eq!(*continent == 0, *ocean > 0);
    }
    let shared = allocation::allocate(
        &sites,
        &territory,
        Layout {
            ocean_water_share: 0.0,
            ..layout
        },
        17,
        0.0,
    );
    assert!(shared.continents.contains(&0));
    assert!(shared.oceans.iter().all(|&id| id == 0));
}
#[test]
fn allocation_does_not_force_a_continent_or_reserve_an_ocean() {
    let (sites, territory, layout) = allocation_input();
    let ocean = allocation::allocate(
        &sites,
        &territory,
        Layout {
            continental_fraction: 0.0,
            ..layout
        },
        17,
        0.0,
    );
    assert!(ocean.continents.iter().all(|&id| id == 0));
    assert!(ocean.oceans.iter().all(|&id| id == 1));
    let land = allocation::allocate(
        &sites,
        &territory,
        Layout {
            continental_fraction: 1.0,
            ..layout
        },
        17,
        0.0,
    );
    assert!(land.continents.iter().all(|&id| id == 1));
    assert!(land.oceans.iter().all(|&id| id == 0));
}
#[test]
fn rigid_motion_rotates_the_point_and_ductile_motion_uses_the_local_driver() {
    let mesh = WorldLatticeOptions::default()
        .build(Bounds(-100.0, -100.0, 100.0, 100.0), 64.0, 0.0, |_, _| true)
        .unwrap();
    let plate = Plate {
        id: 1,
        position: [0.0; 2],
        motion: [2.0, 0.0],
        spin: std::f64::consts::FRAC_PI_2,
    };
    let mut site = Site {
        province: Province {
            position: [10.0, 0.0],
            priority: 0.0,
            assembly: 1,
            ocean_plate: 0,
            motion: [0.0; 2],
        },
        id: 1,
        plate: 1,
        origin: [10.0, 0.0],
        drive: [3.0, 0.0],
        mass: 1.0,
        area: 1.0,
        compliance: 0.0,
        block: 1,
        pull: [0.0; 2],
    };
    let moved = move_point(&mesh, &site, &plate, [10.0, 0.0], 1.0);
    assert!((moved[0] - 2.0).abs() < 1e-10);
    assert!((moved[1] - 10.0).abs() < 1e-10);
    let velocity = site_motion(&mesh, [10.0, 0.0], &plate);
    site.compliance = 0.2;
    let ductile = move_point(&mesh, &site, &plate, [10.0, 0.0], 1.0);
    assert!((ductile[0] - moved[0] - 0.2 * (3.0 - velocity[0])).abs() < 1e-10);
    assert!((ductile[1] - moved[1] + 0.2 * velocity[1]).abs() < 1e-10);
    assert_eq!(edge_allowance(900.0, 300.0), 1.0);
    assert_eq!(edge_allowance(150.0, 300.0), 0.5);
    assert_eq!(edge_allowance(-50.0, 300.0), 0.0);
}
