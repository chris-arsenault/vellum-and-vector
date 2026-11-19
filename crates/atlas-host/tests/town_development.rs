#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::disallowed_types,
    reason = "the contract fixtures supply explicit POI identities"
)]
use atlas_generation::town::{
    access::Access,
    fabric::{polygon, Proposal, Town},
    geometry::rectangle,
    network::{Class, Street},
    plots::Slot,
    seat::Seat,
    story::Story,
};
use atlas_gis::geometry::NativeGeos;
use atlas_map::spatial::SpatialKernel;
use atlas_map::town::places::{Kind, Residence};
use atlas_map::town::Side;
fn supplied_kind(identity: Kind) -> atlas_generation::town::catalogue::Kind {
    serde_json::from_value(serde_json::to_value(identity).unwrap()).unwrap()
}

fn town() -> Town {
    Town::new(
        Seat {
            key: "town".into(),
            name: "Town".into(),
            centre: [0., 0.],
            story: Story {
                people: 5000.,
                ..Default::default()
            },
            arms: vec![],
            culture: None,
        },
        None,
    )
}
fn proposal(x: f64) -> Proposal {
    let front = [x, 0.];
    Proposal {
        slot: Slot {
            habitat: atlas_generation::town::templates::Habitat::Ground,
            tenure: atlas_generation::town::templates::Tenure::Household,
            participant: None,
            street: Some(0),
            side: Side::Left,
            along: x,
            corners: rectangle(front, [1., 0.], [0., 1.], 10., 20.),
            front,
            direction: [1., 0.],
            inward: [0., 1.],
            frontage: 10.,
            depth: 20.,
        },
        kind: supplied_kind(Kind::Residence(Residence::Burgage)),
        means: 0.5,
        priority: 1.,
        cause: "opportunity".into(),
    }
}

#[test]
fn a_chartered_street_needs_an_occupied_frontage_and_proposes_only_its_sector() {
    use atlas_generation::town::{geometry::distance, templates::Template};
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let home = town.establish(proposal(48.), &spatial).unwrap().unwrap();
    town.occupy(home, 0.5, 0.5, 0.7, 0.);
    assert!(town.template.street_proposals(&town).is_empty());
    town.template.selected = Template::Ring;
    let routes = town.template.street_proposals(&town);
    let [route] = routes.as_slice() else {
        panic!("one occupied survey sector")
    };
    let radius = distance(town.seat.centre, route.points[0]);
    assert!(route
        .points
        .iter()
        .all(|p| p[0] > 0. && (distance(town.seat.centre, *p) - radius).abs() < 0.01));
    town.occupy(home, 0.5, 0.5, 0., 0.);
    assert!(town.template.street_proposals(&town).is_empty());
}

#[test]
fn a_founded_flotilla_has_wet_homes_and_a_working_transfer_to_shore() {
    use atlas_generation::town::{
        access::{Access, Entrance},
        catalogue::AccessUse,
        founding,
        ground::{Ground, WATER},
        influence::Conditions,
        templates::{Habitat, Selection, Template},
    };
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut t = town();
    let mut selection = Selection::commons([0., 0.]);
    selection.selected = Template::Moorings;
    selection.site.afloat = Some([40., 0.]);
    selection.site.shore = Some([-12., 0.]);
    t.template = selection;
    fn waterfront() -> Ground {
        let mut ground = Ground::new([-250., -250., 250., 250.], 2.);
        for i in 0..ground.count() {
            if ground.centre(i)[0] > 0. {
                ground.withhold(i, WATER);
            }
        }
        ground
    }
    let ground = waterfront();
    assert!(
        founding::establish(&mut t, &ground, &spatial, |_| Ok(Some(Conditions {
            bank: true,
            ..Default::default()
        })))
        .unwrap()
    );
    let wet = t
        .holdings()
        .iter()
        .find(|h| h.slot.habitat == Habitat::Floating)
        .unwrap();
    assert!(ground.is_water(wet.slot.front));
    let link = &t.kernel_links()[0];
    assert_ne!(ground.is_water(link.ends[0]), ground.is_water(link.ends[1]));
    let access = Access::for_town(&t, &spatial).unwrap().on_ground(&ground);
    let terminals = link.ends.map(Entrance::external);
    assert!(access
        .bind(&terminals, AccessUse::Foot, &spatial)
        .unwrap()
        .routes(0)
        .cost(1)
        .is_finite());
    assert!(!wet.buildings.is_empty());
    let (id, decks) = (wet.id, wet.buildings.len());
    let mut berth = wet.slot.clone();
    berth.front = [175., 150.];
    assert!(t.berth(id, &berth, &ground, &spatial).unwrap());
    let relocated = &t.holdings()[id.0 as usize];
    assert_eq!(relocated.slot.front, berth.front);
    assert_eq!(relocated.buildings.len(), decks);
}

#[test]
fn dependent_households_remain_outside_the_founding_compound() {
    use atlas_generation::town::{
        founding,
        geometry::distance,
        ground::Ground,
        influence::Conditions,
        templates::{Selection, Template, Tenure},
    };
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut t = town();
    t.template = Selection::commons([0., 0.]);
    t.template.selected = Template::Compound;
    let ground = Ground::new([-200., -200., 200., 200.], 2.);
    assert!(founding::establish(&mut t, &ground, &spatial, |_| Ok(Some(
        Conditions::default()
    )))
    .unwrap());
    let unit = atlas_map::town::plot_size(t.seat.story.size()).1;
    assert!(t
        .holdings()
        .iter()
        .any(|h| h.slot.tenure == Tenure::Dependent
            && distance(h.slot.front, t.seat.centre) >= 3. * unit));
    let walls = t.kernel_walls();
    assert_eq!(walls.len(), 1);
    assert_ne!(walls[0].first(), walls[0].last());
}
#[test]
fn distant_custom_can_fund_an_occupied_centre_before_a_connecting_road_exists() {
    use atlas_generation::town::{
        catalogue::{AccessUse, Activity, Operation},
        fabric::{Endpoint, OperatingTie},
        founding::outlying_sites,
        ground::Ground,
        influence::{Conditions, OpportunitySource},
    };
    use atlas_map::town::Size;
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.set_approaches(vec![Street::new(
        vec![[0., -5.], [40., -5.]],
        Class::Street,
        Size::Town,
    )]);
    let sponsor = town.establish(proposal(10.), &spatial).unwrap().unwrap();
    town.occupy(sponsor, 1., 1., 1., 0.);
    let source = OpportunitySource {
        endpoint: Endpoint::Field(1),
        id: atlas_generation::town::influence::SourceId::Named(atlas_map::Id::from_name("orchard")),
        label: "Orchard".into(),
        position: [280., 0.],
        activity: Activity::Agriculture,
        demand: 2.,
        capability: 0.,
    };
    let walking = Ground::new([-100., -100., 400., 100.], 2.);
    assert!(
        outlying_sites(&town, std::slice::from_ref(&source), &walking, &spatial)
            .unwrap()
            .is_empty()
    );
    town.bind(
        sponsor,
        vec![OperatingTie {
            purpose: Operation::Work,
            destination: source.endpoint.clone(),
            entrance: source.position,
            access: AccessUse::Foot,
            strength: 2.,
        }],
    );
    let sites = outlying_sites(&town, std::slice::from_ref(&source), &walking, &spatial).unwrap();
    let site = &sites[0];
    let mut ground = Ground::new([-100., -100., 400., 100.], 2.);
    let local = Conditions {
        cultivated: 1.,
        ..Default::default()
    };
    town.access_effort = 100.;
    town.occupy(sponsor, 1., 0., 1., 0.);
    assert!(!site
        .settle(&mut town, &mut ground, &walking, &spatial, [local; 2])
        .unwrap());
    assert_eq!(
        (
            town.streets().len(),
            town.holdings().len(),
            town.access_effort
        ),
        (1, 1, 100.)
    );
    town.occupy(sponsor, 1., 1., 1., 0.);
    assert!(site
        .settle(&mut town, &mut ground, &walking, &spatial, [local; 2])
        .unwrap());
    let [_, work, home]: &[_; 3] = town
        .holdings()
        .try_into()
        .expect("expected a workplace and a neighbouring home");
    assert_eq!(town.streets().len(), 1);
    assert_eq!((work.slot.street, home.slot.street), (None, None));
    assert_occupied(work);
    assert_occupied(home);
    assert_eq!(work.sponsors, vec![sponsor]);
    fn check_partners(
        work: &atlas_generation::town::fabric::Holding,
        home: &atlas_generation::town::fabric::Holding,
        source: &OpportunitySource,
    ) {
        assert!(work.ties.iter().any(|t| t.destination == source.endpoint));
        assert!(home.ties.iter().any(
            |t| matches!(t.destination, Endpoint::Premises {holding,..} if holding == work.id)
        ));
    }
    check_partners(work, home, &source);
    assert!(outlying_sites(&town, &[source], &walking, &spatial)
        .unwrap()
        .is_empty());
}
fn assert_occupied(h: &atlas_generation::town::fabric::Holding) {
    assert!(h.occupation > 0.);
    assert!(!h.buildings.is_empty());
}
#[test]
fn square_edges_offer_outward_premises() {
    use atlas_generation::town::plots::participant_slots;
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let mut square = proposal(0.);
    square.kind = supplied_kind(Kind::Market);
    square.slot.corners = rectangle(square.slot.front, [1., 0.], [0., 1.], 30., 40.);
    town.establish(square, &spatial).unwrap().unwrap();
    let square = &town.holdings()[0];
    let slots = participant_slots(square);
    let mut divided = square.clone();
    if let atlas_map::Geometry::Polygon { coordinates } = &square.outline {
        divided.outline = atlas_map::Geometry::MultiPolygon {
            coordinates: vec![coordinates.clone()],
        };
    }
    assert_eq!(participant_slots(&divided).len(), slots.len());
    assert!(slots.iter().any(|s| s.inward == [-1., 0.]));
    assert!(slots.iter().any(|s| s.inward == [1., 0.]));
    for slot in slots {
        assert_eq!(slot.participant, Some(square.id));
        assert!(
            spatial
                .distance(&polygon(&slot.corners), &square.outline)
                .unwrap()
                < 0.2
        );
        assert!(
            spatial
                .intersection_areas(&square.outline, &[polygon(&slot.corners)])
                .unwrap()[0]
                < 0.01
        );
    }
}
#[test]
fn housing_bays_touch_at_the_party_wall() {
    use atlas_generation::town::roofs::components;
    let spatial = NativeGeos::new(0.001).unwrap();
    let house = proposal(0.);
    let roofs = components(&house.slot, house.kind, house.means, 0.5);
    assert_eq!(roofs.len(), 2);
    assert!(spatial.distance(&roofs[0], &roofs[1]).unwrap() < 0.001);
    assert!(spatial.intersection_areas(&roofs[0], &roofs[1..]).unwrap()[0] < 0.01);
}

#[test]
fn conflicting_claims_preserve_the_existing_holding() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let id = town.establish(proposal(0.), &spatial).unwrap().unwrap();
    assert!(town.establish(proposal(3.), &spatial).unwrap().is_none());
    assert_eq!(town.holdings().len(), 1);
    assert_eq!(town.holdings()[0].id, id);
}

#[test]
fn a_powerful_neighbor_can_annex_a_private_frontage_but_the_occupied_commons_holds_its_title() {
    use atlas_generation::town::{
        fabric::{EditOutcome, FabricEdit, FabricOwner},
        templates::Tenure,
    };
    let spatial = NativeGeos::new(0.001).unwrap();
    for (title, can_annex) in [(Tenure::Household, true), (Tenure::Common, false)] {
        let mut town = town();
        let mut hall = proposal(10.);
        hall.kind = supplied_kind(Kind::GuildHall);
        hall.slot.tenure = Tenure::Institutional;
        let institution = town.establish(hall, &spatial).unwrap().unwrap();
        town.maintain(institution, 1., 1., 1.);
        let mut home = proposal(22.);
        home.slot.tenure = title;
        let premises = town.establish(home, &spatial).unwrap().unwrap();
        town.maintain(premises, 1., 0.2, 1.);
        let decision = town
            .apply(
                FabricEdit::Enclose {
                    institution,
                    premises,
                },
                &spatial,
            )
            .unwrap();
        assert_eq!(matches!(decision, EditOutcome::Premises(_)), can_annex);
        assert_eq!(
            town.holdings()[premises.0 as usize].institution.is_some(),
            can_annex
        );
    }
}

#[test]
fn a_practice_sharing_premises_retains_the_local_craft() {
    use atlas_generation::town::{
        fabric::{EditOutcome, FabricEdit, FabricOwner},
        influence::Conditions,
    };
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let mut hall = proposal(0.);
    hall.kind = supplied_kind(Kind::ExchangeHall);
    let premises = town.establish(hall, &spatial).unwrap().unwrap();
    let practice = supplied_kind(Kind::CraftPractice);
    let outcome = town
        .apply(
            FabricEdit::Share {
                premises,
                use_: practice,
                conditions: Conditions {
                    craft: Some(7),
                    ..Default::default()
                },
            },
            &spatial,
        )
        .unwrap();
    assert!(matches!(outcome, EditOutcome::Premises(id) if id == premises));
    let shared = &town.holdings()[premises.0 as usize];
    assert_eq!(shared.secondary, Some(practice));
    assert_eq!(shared.craft, Some(7));
}

#[test]
fn access_investment_uses_operating_premises_and_the_entire_carriageway() {
    use atlas_generation::town::catalogue::AccessUse;
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let kind = supplied_kind(Kind::ExchangeHall);
    for x in [0., 40.] {
        let mut hall = proposal(x);
        hall.kind = kind;
        let id = town.establish(hall, &spatial).unwrap().unwrap();
        let roof = polygon(&rectangle([x, 1.], [1., 0.], [0., 1.], 8., 6.));
        town.fit_building(id, roof, &spatial).unwrap();
        if x == 0. {
            town.maintain(id, 0.1, 1., 0.);
        }
    }
    assert_eq!(
        town.access_destinations(kind).collect::<Vec<_>>(),
        vec![[40., 0.]]
    );
    let size = atlas_map::town::Size::Town;
    let mut street = Street::new(
        vec![[0., 0.], [40., 0.]],
        AccessUse::Freight.street_class().unwrap(),
        size,
    );
    assert!(AccessUse::Freight.permits_street(&street));
    street.widths[1] = 1.5;
    assert!(!AccessUse::Freight.permits_street(&street));
    assert!(AccessUse::Foot.permits_street(&street));
}
#[test]
fn a_project_cannot_fit_a_building_outside_its_holding_or_subdivide_an_occupied_building() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let id = town.establish(proposal(0.), &spatial).unwrap().unwrap();
    let outside = polygon(&rectangle([40., 0.], [1., 0.], [0., 1.], 8., 10.));
    assert!(!town.fit_building(id, outside, &spatial).unwrap());
    let shape = polygon(&rectangle([0., 2.], [1., 0.], [0., 1.], 8., 10.));
    assert!(town.fit_building(id, shape.clone(), &spatial).unwrap());
    assert!(!town
        .subdivide(id, &[shape.clone(), shape], &spatial)
        .unwrap());
}
#[test]
fn close_but_disconnected_streets_are_not_a_travel_connection() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let roads = [
        Street::new(
            vec![[0., 0.], [100., 0.]],
            Class::Street,
            atlas_map::town::Size::Town,
        ),
        Street::new(
            vec![[0., 10.], [100., 10.]],
            Class::Street,
            atlas_map::town::Size::Town,
        ),
    ];
    let access = Access::new(&roads, &spatial).unwrap();
    let costs = access
        .costs([0., 0.], &[[100., 0.], [100., 10.]], &spatial)
        .unwrap();
    assert_eq!(costs[0], 100.);
    assert!(costs[1].is_infinite());
}
#[test]
fn access_before_the_first_street_has_no_reachable_destinations() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let access = Access::new(&[], &spatial).unwrap();
    assert!(access.costs([0., 0.], &[[1., 1.]], &spatial).unwrap()[0].is_infinite());
}

#[test]
fn journeys_follow_only_the_used_stretches_through_junctions_and_doors() {
    use atlas_generation::town::{access::Entrance, catalogue::AccessUse};
    let spatial = NativeGeos::new(0.001).unwrap();
    let street = |a, b| Street::new(vec![a, b], Class::Street, atlas_map::town::Size::Town);
    let roads = [
        street([0., 0.], [100., 0.]),
        street([50., -20.], [50., 40.]),
        street([0., 100.], [100., 100.]),
    ];
    let places = [[25., 0.], [50., 25.], [75., 100.]].map(Entrance::external);
    let mut access = Access::new(&roads, &spatial).unwrap();
    let graph = access.bind(&places, AccessUse::Foot, &spatial).unwrap();
    let routes = graph.routes(0);
    assert_eq!(routes.cost(1), 50.);
    assert!(routes.cost(2).is_infinite());
    let mut distances = graph.distance_queries();
    distances.from(0);
    assert_eq!(distances.cost(1), 50.);
    distances.from(2);
    assert!(distances.cost(1).is_infinite());
    let mut lengths = [0.; 3];
    routes.visit(1, |leg| lengths[leg.street] += leg.length());
    assert_eq!(lengths, [25., 25., 0.]);
    access
        .add_link([30., 0.], [70., 100.], 2., &spatial)
        .unwrap();
    let graph = access.bind(&places, AccessUse::Foot, &spatial).unwrap();
    let routes = graph.routes(0);
    assert_eq!(routes.cost(2), 12.);
    let mut lengths = [0.; 3];
    routes.visit(2, |leg| lengths[leg.street] += leg.length());
    assert_eq!(lengths, [5., 0., 5.]);
}

#[test]
fn a_subprecision_vertex_on_a_street_does_not_become_a_separate_route() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let start = [757008.131124, 64098.78231255777];
    let almost = [757008.1311242179, 64098.782313];
    let end = [start[0] + 20., start[1]];
    let road = Street::new(
        vec![start, almost, end],
        Class::Lane,
        atlas_map::town::Size::Town,
    );
    let access = Access::new(&[road], &spatial).unwrap();
    assert!((access.costs(start, &[end], &spatial).unwrap()[0] - 20.).abs() < 0.01);
}

#[test]
fn widening_a_loaded_stretch_requires_its_shoulders_and_preserves_the_other_frontage() {
    use atlas_generation::town::{access::StreetLoad, ground::Ground};
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let road = Street::new(
        vec![[0., 0.], [100., 0.]],
        Class::Lane,
        atlas_map::town::Size::Town,
    );
    let original = road.width();
    town.set_approaches(vec![road]);
    town.access_effort = 100.;
    let mut ground = Ground::new([-40., -40., 140., 40.], 1.);
    let load = StreetLoad {
        street: 0,
        start: 20.,
        end: 40.,
        value: 16.,
    };
    let mut plot = proposal(30.);
    plot.slot.front = [30., 2.];
    plot.slot.corners = rectangle(plot.slot.front, [1., 0.], [0., 1.], 10., 10.);
    let id = town.establish(plot, &spatial).unwrap().unwrap();
    town.maintain(id, 1., 100., 1.);
    assert!(!town.widen(load, &mut ground, &spatial).unwrap());
    assert_eq!(town.access_effort, 100.);
    town.maintain(id, 1., 0.1, 1.);
    assert!(town.widen(load, &mut ground, &spatial).unwrap());
    let street = &town.streets()[0];
    assert_eq!(*street.widths.last().unwrap(), original);
    assert!(street.width() > original);
    assert_eq!(street.width_at(70.), original);
    let mask = street.corridor(0., &spatial).unwrap().unwrap();
    let inside = spatial
        .covers_points(
            &mask,
            &[
                atlas_map::Position::xy(30., 2.),
                atlas_map::Position::xy(70., 2.),
            ],
        )
        .unwrap();
    assert_eq!(inside, vec![true, false]);
    town.register_traffic(vec![load], 1.);
    assert!(town.frontage_wear(&proposal(30.).slot) > 0.);
    assert_eq!(town.frontage_wear(&proposal(70.).slot), 0.);
}
#[test]
fn retained_fabric_keeps_means_condition_and_identity_separate_on_loading() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.establish(proposal(0.), &spatial).unwrap();
    let id = town.holdings()[0].id;
    town.maintain(id, 0.1, 1., 0.);
    town.occupy(id, 0., 0.9, 0., 0.);
    let bytes = serde_json::to_vec(&town).unwrap();
    let read: Town = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(read.holdings()[0].id, town.holdings()[0].id);
    assert_eq!(read.holdings()[0].means, 0.9);
    assert_eq!(read.holdings()[0].condition, 0.1);
}
#[test]
fn subdivision_preserves_each_standing_building_with_one_new_owner() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let id = town.establish(proposal(0.), &spatial).unwrap().unwrap();
    let building = polygon(&rectangle([0., 1.], [1., 0.], [0., 1.], 8., 6.));
    town.fit_building(id, building.clone(), &spatial).unwrap();
    let front = polygon(&rectangle([0., 0.], [1., 0.], [0., 1.], 10., 9.));
    let rear = polygon(&rectangle([0., 10.], [1., 0.], [0., 1.], 10., 10.));
    assert!(town.subdivide(id, &[front, rear], &spatial).unwrap());
    assert_eq!(town.holdings()[0].buildings.len(), 1);
    assert!(spatial
        .relation(
            &building,
            &town.holdings()[0].buildings[0],
            atlas_map::spatial::Predicate::Covers
        )
        .unwrap());
    assert_eq!(spatial.area(&town.holdings()[0].buildings[0]).unwrap(), 48.);
    assert!(town.holdings()[1].buildings.is_empty());
    assert_eq!(town.holdings()[0].id, id);
}
#[test]
fn route_project_can_take_a_vacant_yard_but_cannot_cut_a_building() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let id = town.establish(proposal(0.), &spatial).unwrap().unwrap();
    town.fit_building(
        id,
        polygon(&rectangle([0., 1.], [1., 0.], [0., 1.], 8., 6.)),
        &spatial,
    )
    .unwrap();
    let crossing = |y| {
        Street::new(
            vec![[-20., y], [20., y]],
            Class::Lane,
            atlas_map::town::Size::Town,
        )
    };
    assert!(!town.connect_route(crossing(4.), 5., &spatial).unwrap());
    assert!(town.streets().is_empty());
    assert!(town.connect_route(crossing(15.), 5., &spatial).unwrap());
    assert_eq!(town.holdings()[0].id, id);
    assert_eq!(town.holdings()[0].buildings.len(), 1);
    assert!(!town.connect_route(crossing(15.), 5., &spatial).unwrap());
}
#[test]
fn a_surface_crossing_and_a_submerged_chamber_can_be_built_in_either_order() {
    use atlas_generation::town::templates::Habitat;
    let spatial = NativeGeos::new(0.001).unwrap();
    let crossing = || {
        Street::new(
            vec![[-20., 5.], [20., 5.]],
            Class::Lane,
            atlas_map::town::Size::Town,
        )
    };
    let roof = polygon(&rectangle([0., 4.], [1., 0.], [0., 1.], 4., 3.));
    for road_first in [false, true] {
        let mut town = town();
        let mut chamber = proposal(0.);
        chamber.slot.habitat = Habitat::Submerged;
        chamber.slot.street = None;
        if road_first {
            assert!(town.connect_route(crossing(), 5., &spatial).unwrap());
        }
        let id = town.establish(chamber, &spatial).unwrap().unwrap();
        assert!(town.fit_building(id, roof.clone(), &spatial).unwrap());
        if !road_first {
            assert!(town.connect_route(crossing(), 5., &spatial).unwrap());
        }
        assert_eq!(town.holdings()[id.0 as usize].buildings.len(), 1);
    }
}
#[test]
fn working_plot_keeps_its_identity_while_built_claims_take_land() {
    use atlas_generation::town::{fabric::Fabric, ground::Ground, land};
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.establish(proposal(0.), &spatial).unwrap();
    let footprint = town.holdings()[0].outline.clone();
    let mut fabric = Fabric {
        towns: vec![town],
        fallow: vec![],
        fields: vec![land::Field {
            id: 17,
            estate: 4,
            outline: polygon(&rectangle([0., -10.], [1., 0.], [0., 1.], 50., 60.)),
            pasture: false,
            worked: 0.7,
            suitability: 1.,
            opening_cost: 0.,
            worked_by: None,
        }],
    };
    land::develop(
        &mut fabric,
        &[],
        &Ground::new([-50., -50., 50., 100.], 5.),
        &spatial,
    )
    .unwrap();
    assert_eq!(fabric.fields[0].id, 17);
    assert_eq!(
        spatial
            .intersection_areas(&footprint, &[fabric.fields[0].outline.clone()])
            .unwrap()[0],
        0.
    );
    assert!(spatial.area(&fabric.fields[0].outline).unwrap() > 0.);
}
#[test]
fn gathering_claim_adapts_to_older_premises_instead_of_replacing_them() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.establish(proposal(0.), &spatial).unwrap();
    let older = town.holdings()[0].outline.clone();
    let mut market = proposal(12.);
    market.kind = supplied_kind(Kind::Market);
    market.slot.corners = rectangle([12., 0.], [1., 0.], [0., 1.], 40., 25.);
    let id = town.establish(market, &spatial).unwrap().unwrap();
    let shape = &town.holdings()[id.0 as usize].outline;
    assert_eq!(
        spatial
            .intersection_areas(&older, std::slice::from_ref(shape))
            .unwrap()[0],
        0.
    );
    assert!(spatial.area(shape).unwrap() < 1000.);
    assert!(spatial.area(shape).unwrap() > 200.);
}
#[test]
fn gathering_project_requires_enough_fitted_ground_near_its_anchor() {
    use atlas_generation::town::fabric::{
        Anchor, EditOutcome, FabricEdit, FabricOwner, Relationship, Specification,
    };
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.establish(proposal(0.), &spatial).unwrap();
    let kind = supplied_kind(Kind::Market);
    let gathering = Relationship::GatheringSpace { for_use: kind };
    let place = |x: f64| {
        let mut candidate = proposal(x);
        candidate.kind = kind;
        candidate.slot.frontage = 20.;
        candidate.slot.depth = 31.;
        candidate.slot.corners = rectangle([x, 0.], [1., 0.], [0., 1.], 20., 31.);
        FabricEdit::Establish {
            purpose: Some((Anchor::Settlement, gathering)),
            conditions: Default::default(),
            buildings: vec![],
            outdoor: true,
            proposal: candidate,
        }
    };
    assert!(!gathering.admits_frontage(Anchor::Settlement, &town, [500., 0.], 31.));
    assert!(matches!(
        town.apply(place(0.), &spatial).unwrap(),
        EditOutcome::Declined
    ));
    assert_eq!(town.holdings().len(), 1);
    assert!(matches!(
        town.apply(place(30.), &spatial).unwrap(),
        EditOutcome::Premises(_)
    ));
    assert!(gathering
        .satisfied(Anchor::Settlement, &town, &spatial)
        .unwrap());
}
#[test]
fn independent_foot_journeys_need_passable_land_but_no_street() {
    use atlas_generation::town::{
        access::Entrance,
        catalogue::AccessUse,
        ground::{Ground, WALL},
    };
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut ground = Ground::new([0., 0., 20., 20.], 1.);
    let doors = [
        Entrance::independent([2.5, 4.5]),
        Entrance::independent([15.5, 4.5]),
    ];
    let cost = |ground: &Ground, mode| {
        Access::new(&[], &spatial)
            .unwrap()
            .on_ground(ground)
            .bind(&doors, mode, &spatial)
            .unwrap()
            .routes(0)
            .cost(1)
    };
    let open = cost(&ground, AccessUse::Foot);
    assert!(open.is_finite());
    assert!(cost(&ground, AccessUse::Freight).is_infinite());
    for y in 0..13 {
        ground.withhold(y * 20 + 8, WALL);
    }
    let around = cost(&ground, AccessUse::Foot);
    assert!(around.is_finite() && around > open);
    let lanes = [Street::new(
        vec![[15.5, 2.5], [15.5, 8.5]],
        Class::Lane,
        atlas_map::town::Size::Town,
    )];
    let network = Access::new(&lanes, &spatial)
        .unwrap()
        .on_ground(&ground)
        .bind(&doors, AccessUse::Foot, &spatial)
        .unwrap();
    let approach = network.to_streets().approach(0).unwrap();
    assert_eq!(approach.street, 0);
    assert_eq!(approach.points[0], [2.5, 4.5]);
    assert_eq!(approach.points.last().unwrap()[0], 15.5);
    fn assert_path_clear(points: &[[f64; 2]], ground: &Ground) {
        for leg in points.windows(2) {
            for i in 0..=100 {
                let t = i as f64 / 100.;
                let p = [
                    leg[0][0] * (1. - t) + leg[1][0] * t,
                    leg[0][1] * (1. - t) + leg[1][1] * t,
                ];
                assert_ne!(ground.owner(p), WALL, "walk crosses wall at {p:?}");
            }
        }
    }
    assert_path_clear(&approach.points, &ground);
    for y in 13..20 {
        ground.withhold(y * 20 + 8, WALL);
    }
    assert!(cost(&ground, AccessUse::Foot).is_infinite());
}
#[test]
fn premises_are_numbered_along_the_street_they_front() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.establish(proposal(20.), &spatial).unwrap();
    town.establish(proposal(0.), &spatial).unwrap();
    town.set_approaches(vec![Street::new(
        vec![[-10., -5.], [40., -5.]],
        Class::Lane,
        atlas_map::town::Size::Town,
    )]);
    assert_eq!(
        atlas_generation::town::addresses::assign(&town, &spatial)
            .unwrap()
            .into_iter()
            .map(|a| a.map(|a| a.number))
            .collect::<Vec<_>>(),
        vec![Some(3), Some(1)]
    );
}

#[test]
fn a_newly_built_door_can_reach_a_named_street_around_an_exact_roof() {
    use atlas_generation::town::{
        access::{Approach, Footpath},
        ground::{Ground, PLOT},
    };
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.set_approaches(vec![Street::new(
        vec![[-30., -14.], [30., -14.]],
        Class::Lane,
        atlas_map::town::Size::Town,
    )]);
    let mut home = proposal(0.);
    home.slot.street = None;
    let entrance = home.slot.front;
    let resident = town.establish(home, &spatial).unwrap().unwrap();
    let own_roof = polygon(&rectangle([0., 0.6], [1., 0.], [0., 1.], 8., 6.));
    town.fit_building(resident, own_roof, &spatial).unwrap();
    let mut other = proposal(0.);
    other.slot.street = None;
    other.slot.front = [0., -8.];
    other.slot.depth = 7.;
    other.slot.frontage = 20.;
    other.slot.corners = rectangle(other.slot.front, [1., 0.], [0., 1.], 20., 7.);
    let id = town.establish(other, &spatial).unwrap().unwrap();
    let obstacle = polygon(&rectangle([0., -6.], [1., 0.], [0., 1.], 5., 0.2));
    assert!(town.fit_building(id, obstacle.clone(), &spatial).unwrap());
    let mouth = [0., -14.];
    town.record_walks(
        vec![Footpath {
            points: [entrance, mouth],
            wear: 4.,
        }],
        vec![Some(Approach {
            points: vec![entrance, mouth],
            street: 0,
        })],
    );
    let mut ground = Ground::new([-40., -30., 40., 30.], 1.5);
    let cell = ground.index(entrance).unwrap();
    ground.withhold(cell, PLOT);
    town.resolve_approaches(&ground, &spatial).unwrap();
    let route = town.approach(resident).unwrap();
    assert_eq!(route.points.first(), Some(&entrance));
    assert_eq!(route.points.last().unwrap()[1], -14.);
    for segment in route.points.windows(2) {
        let trace = atlas_generation::town::edits::line(segment);
        assert!(!spatial
            .relation(&trace, &obstacle, atlas_map::spatial::Predicate::Intersects)
            .unwrap());
    }
    assert!(
        atlas_generation::town::addresses::assign(&town, &spatial).unwrap()[resident.0 as usize]
            .is_some()
    );
}
#[test]
fn shared_approaches_number_the_street_they_reach_on_the_side_they_join() {
    use atlas_generation::town::{access::Approach, addresses::assign};
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.set_approaches(
        [-5., -90.]
            .map(|y| {
                Street::new(
                    vec![[-50., y], [150., y]],
                    Class::Lane,
                    atlas_map::town::Size::Town,
                )
            })
            .to_vec(),
    );
    let mut courses = Vec::new();
    for x in [10., 40., 70.] {
        let mut home = proposal(x);
        home.slot.street = None;
        town.establish(home, &spatial).unwrap().unwrap();
        courses.push(Some(Approach {
            street: 1,
            points: vec![[x, 0.], [0., -120.], [0., -90.]],
        }));
    }
    courses[2] = Some(Approach {
        street: 1,
        points: vec![[70., 0.]],
    });
    town.record_walks(vec![], courses);
    let addresses = assign(&town, &spatial).unwrap();
    for (a, n) in addresses[..2].iter().zip([2, 4]) {
        let a = a.unwrap();
        assert_eq!(
            (a.street, a.number, a.junction, a.indirect),
            (1, n, [0., -90.], true)
        );
    }
    assert!(addresses[2].is_none());
}
#[test]
fn working_land_retains_a_reachable_household_relationship() {
    use atlas_generation::town::{fabric::Fabric, ground::Ground, land};
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let mut farm = proposal(0.);
    farm.kind = supplied_kind(Kind::Farmstead);
    let id = town.establish(farm, &spatial).unwrap().unwrap();
    town.occupy(town.holdings()[0].id, 0., 0.5, 0.9, 0.);
    town.set_approaches(vec![Street::new(
        vec![[-30., -5.], [100., -5.]],
        Class::Lane,
        atlas_map::town::Size::Town,
    )]);
    let mut fabric = Fabric {
        towns: vec![town],
        fallow: vec![],
        fields: vec![land::Field {
            id: 2,
            estate: 1,
            outline: polygon(&rectangle([60., 20.], [1., 0.], [0., 1.], 20., 30.)),
            pasture: false,
            worked: 0.8,
            suitability: 1.,
            opening_cost: 0.,
            worked_by: None,
        }],
    };
    land::develop(
        &mut fabric,
        &[],
        &Ground::new([-50., -50., 150., 100.], 5.),
        &spatial,
    )
    .unwrap();
    assert_eq!(
        fabric.fields[0].worked_by,
        Some(land::Worker {
            town: "town".into(),
            holding: id
        })
    );
}
#[test]
fn a_holding_fits_the_available_parcel_without_losing_its_entrance() {
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    town.establish(proposal(0.), &spatial).unwrap();
    let older = town.holdings()[0].outline.clone();
    let id = town.establish(proposal(7.), &spatial).unwrap().unwrap();
    let held = &town.holdings()[id.0 as usize];
    assert_eq!(
        spatial
            .intersection_areas(&older, std::slice::from_ref(&held.outline))
            .unwrap()[0],
        0.
    );
    assert!(spatial.area(&held.outline).unwrap() < 200.);
    assert!(spatial
        .relation(
            &held.outline,
            &atlas_map::Geometry::Point {
                coordinates: atlas_map::Position::xy(7., 0.)
            },
            atlas_map::spatial::Predicate::Covers
        )
        .unwrap());
}
#[test]
fn sharing_an_exchange_hall_leaves_delivery_access_outstanding() {
    use atlas_generation::town::{
        catalogue::AccessUse,
        fabric::{Anchor, EditOutcome, FabricEdit, FabricOwner, Relationship, Specification},
    };
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let mut hall = proposal(0.);
    hall.kind = supplied_kind(Kind::GuildHall);
    // The delivery street below starts at x = -20; the hall fronts its midpoint.
    hall.slot.along = 20.;
    let roof = polygon(&rectangle([0., 1.], [1., 0.], [0., 1.], 8., 6.));
    let EditOutcome::Premises(id) = town
        .apply(
            FabricEdit::Establish {
                conditions: Default::default(),
                purpose: None,
                proposal: hall,
                buildings: vec![roof],
                outdoor: false,
            },
            &spatial,
        )
        .unwrap()
    else {
        panic!("expected hall")
    };
    let exchange = Relationship::Accommodation(supplied_kind(Kind::Market));
    let access = Relationship::Access {
        from: Anchor::Settlement,
        to: supplied_kind(Kind::Market),
        use_: AccessUse::Freight,
    };
    assert!(!exchange
        .satisfied(Anchor::Settlement, &town, &spatial)
        .unwrap());
    town.apply(
        FabricEdit::Share {
            conditions: Default::default(),
            premises: id,
            use_: supplied_kind(Kind::Market),
        },
        &spatial,
    )
    .unwrap();
    assert!(exchange
        .satisfied(Anchor::Settlement, &town, &spatial)
        .unwrap());
    assert!(!access
        .satisfied(Anchor::Settlement, &town, &spatial)
        .unwrap());
    let street = Street::new(
        vec![[-20., -5.], [20., -5.]],
        Class::Street,
        atlas_map::town::Size::Town,
    );
    town.apply(
        FabricEdit::Connect {
            street,
            priority: 2.,
        },
        &spatial,
    )
    .unwrap();
    assert!(access
        .satisfied(Anchor::Settlement, &town, &spatial)
        .unwrap());
}
#[test]
fn a_shared_hall_publishes_its_two_uses_ward_and_street_to_gis() {
    use atlas_generation::{
        features::{Feature, State},
        field::poi::map_records::Record,
        publication::town::{publish, TownWriter},
        town::fabric::{Fabric, FabricEdit, FabricOwner},
    };
    use std::{collections::BTreeMap, io};
    struct Catalog {
        spatial: NativeGeos,
        features: BTreeMap<String, Feature>,
    }
    impl TownWriter for Catalog {
        fn record(&mut self, r: Record<'_>) -> io::Result<Feature> {
            Ok(Feature {
                id: r.key.into(),
                name: r.name.into(),
                kind: r.kind.into(),
                layer_id: r.layer.into(),
                area_id: "surface".into(),
                geometry: r.geometry,
                attributes: r.attributes,
                state: State::Generated,
                detail: Default::default(),
                relations: vec![],
                causes: vec![],
                actor: "test".into(),
                protected: false,
                place_id: None,
                map_only: None,
                footprint: None,
                generation_id: None,
                generation_domain: None,
            })
        }
        fn save(&mut self, feature: Feature) -> io::Result<()> {
            self.features.insert(feature.id.clone(), feature);
            Ok(())
        }
        fn network(&mut self, feature: Feature) -> io::Result<()> {
            self.save(feature)
        }
        fn feature(&self, id: &str) -> io::Result<Option<Feature>> {
            Ok(self.features.get(id).cloned())
        }
        fn feature_id(&self, key: &str) -> io::Result<String> {
            Ok(key.into())
        }
        fn part_name(&self, key: &str, work: &str, _: [f64; 2], _: &Town) -> io::Result<String> {
            if key.starts_with("town:town:work:") {
                return Ok(format!("Local {work}"));
            }
            Ok(work.into())
        }
        fn spatial(&self) -> &dyn SpatialKernel {
            &self.spatial
        }
    }
    let mut catalog = Catalog {
        spatial: NativeGeos::new(0.001).unwrap(),
        features: Default::default(),
    };
    let mut t = town();
    t.set_approaches(vec![Street::new(
        vec![[-20., -5.], [20., -5.]],
        Class::Main,
        atlas_map::town::Size::Town,
    )]);
    let mut hall = proposal(0.);
    hall.kind = supplied_kind(Kind::GuildHall);
    let id = t.establish(hall, &catalog.spatial).unwrap().unwrap();
    use atlas_generation::town::major_works::{commission, InheritedWork, WorkFamily};
    commission(
        &mut t,
        17,
        &[InheritedWork {
            family: WorkFamily::Library,
            id: "parent-archive".into(),
            design: None,
            anchor: [0., 1.],
        }],
    );
    t.works.commissions[0].members.push(id);
    t.fit_building(
        id,
        polygon(&rectangle([0., 1.], [1., 0.], [0., 1.], 8., 6.)),
        &catalog.spatial,
    )
    .unwrap();
    t.apply(
        FabricEdit::Share {
            conditions: Default::default(),
            premises: id,
            use_: supplied_kind(Kind::Market),
        },
        &catalog.spatial,
    )
    .unwrap();
    use atlas_generation::town::{
        catalogue::{AccessUse, Operation},
        fabric::{Endpoint, OperatingTie},
    };
    let mut home = proposal(50.);
    home.slot.street = None;
    let customer = t.establish(home, &catalog.spatial).unwrap().unwrap();
    let cottage = polygon(&rectangle([50., 1.], [1., 0.], [0., 1.], 8., 6.));
    t.fit_building(customer, cottage.clone(), &catalog.spatial)
        .unwrap();
    let mut farm = proposal(80.);
    farm.kind = supplied_kind(Kind::Farmstead);
    let supplier = t.establish(farm, &catalog.spatial).unwrap().unwrap();
    use atlas_generation::town::access::{Approach, Footpath};
    let mut distant = proposal(110.);
    distant.slot.street = None;
    let distant = t.establish(distant, &catalog.spatial).unwrap().unwrap();
    t.fit_building(
        distant,
        polygon(&rectangle([110., 1.], [1., 0.], [0., 1.], 8., 6.)),
        &catalog.spatial,
    )
    .unwrap();
    let route = vec![[110., 0.], [110., -25.], [10., -25.], [10., -5.]];
    let paths = route
        .windows(2)
        .map(|p| Footpath {
            points: [p[0], p[1]],
            wear: 1.,
        })
        .collect();
    let mut approaches = vec![None; t.holdings().len()];
    approaches[distant.0 as usize] = Some(Approach {
        street: 0,
        points: route.clone(),
    });
    t.record_walks(paths, approaches);
    let ties = [
        (Operation::Supply, supplier, AccessUse::Freight),
        (Operation::Customers, customer, AccessUse::Foot),
    ]
    .into_iter()
    .map(|(purpose, partner, access)| OperatingTie {
        purpose,
        access,
        strength: 1.,
        entrance: t.holdings()[partner.0 as usize].slot.front,
        destination: Endpoint::Premises {
            town: t.seat.key.clone(),
            holding: partner,
        },
    })
    .collect();
    t.bind(id, ties);
    let fabric = Fabric {
        towns: vec![t],
        fallow: vec![],
        fields: vec![],
    };
    publish(&mut catalog, &fabric).unwrap();
    let premises_id = |holding: atlas_generation::town::fabric::HoldingId| {
        format!("town:town:holding:{}:yard", holding.0)
    };
    let links = &catalog.features[&premises_id(id)].relations;
    fn check_published_design(work: &Feature) {
        assert_eq!(work.kind, "majorWork");
        assert_eq!(
            work.name,
            format!(
                "Local {}",
                atlas_generation::town::major_works::WorkFamily::Library.label()
            )
        );
        assert!(work.attributes["workProgram"].is_string());
        assert!(work.attributes["workDesign"].is_object());
    }
    fn check_work(
        catalog: &Catalog,
        id: atlas_generation::town::fabric::HoldingId,
        links: &[atlas_generation::features::records::Relation],
    ) {
        let work = &catalog.features["parent-archive"];
        check_published_design(work);
        assert!(work.footprint.is_some());
        assert_eq!(work.attributes["origin"], "inherited");
        use atlas_generation::features::records::Relation;
        assert!(links.contains(&Relation {
            kind: "partOf".into(),
            target_id: work.id.clone()
        }));
        assert!(work.relations.contains(&Relation {
            kind: "contains".into(),
            target_id: format!("town:town:holding:{}:yard", id.0)
        }));
        assert_eq!(
            catalog.features["town"].attributes["settlementTemplate"],
            "ferry-commons"
        );
        assert_eq!(
            catalog.features["town"].attributes["majorWorkCommissions"][0]["builtParts"],
            1
        );
    }
    check_work(&catalog, id, links);
    let destinations: Vec<_> = links
        .iter()
        .map(|r| (r.kind.as_str(), r.target_id.clone()))
        .collect();
    assert!(destinations.contains(&("suppliedBy", premises_id(supplier))));
    assert!(destinations.contains(&("servesCustomersAt", premises_id(customer))));
    let roof = &catalog.features[&format!("town:town:holding:{}:building:0", id.0)];
    let cottage_feature =
        &catalog.features[&format!("town:town:holding:{}:building:0", customer.0)];
    fn check_cottage(
        catalog: &Catalog,
        cottage_feature: &Feature,
        yard: &Feature,
        cottage: &atlas_map::Geometry,
    ) {
        use atlas_map::spatial::Predicate::Covers;
        let published = &cottage_feature.geometry;
        assert!(catalog
            .spatial
            .relation(published, cottage, Covers)
            .unwrap());
        assert!(catalog
            .spatial
            .relation(cottage, published, Covers)
            .unwrap());
        assert!(!cottage_feature.name.trim().is_empty());
        assert_eq!(
            cottage_feature.attributes["buildingFunction"],
            "residential"
        );
        for feature in [cottage_feature, yard] {
            for key in ["address", "addressNumber", "street", "streetId"] {
                assert!(!feature.attributes.contains_key(key));
            }
            assert!(!feature.relations.iter().any(|r| r.kind == "fronts"));
        }
    }
    check_cottage(
        &catalog,
        cottage_feature,
        &catalog.features[&premises_id(customer)],
        &cottage,
    );
    assert_eq!(
        roof.attributes["placeKind"],
        serde_json::json!(Kind::GuildHall)
    );
    assert_eq!(
        roof.attributes["secondaryKind"],
        serde_json::json!(Kind::Market)
    );
    assert_eq!(roof.attributes["ward"], "ward");
    assert_eq!(roof.attributes["use"], "hall");
    assert_eq!(roof.attributes["buildingFunction"], "civic");
    let street = &roof
        .relations
        .iter()
        .find(|r| r.kind == "fronts")
        .unwrap()
        .target_id;
    assert_eq!(catalog.features[street].name, roof.attributes["street"]);
    fn check_address(
        catalog: &Catalog,
        distant: atlas_generation::town::fabric::HoldingId,
        street: &str,
        route: &[[f64; 2]],
    ) {
        let connected_roof =
            &catalog.features[&format!("town:town:holding:{}:building:0", distant.0)];
        for f in [
            connected_roof,
            &catalog.features[&format!("town:town:holding:{}:yard", distant.0)],
        ] {
            assert_eq!(f.attributes["address"], "2 High Street");
            assert_eq!(
                f.attributes["addressJunction"],
                serde_json::json!([10., -5.])
            );
            assert_eq!(f.attributes["entrance"], serde_json::json!([110., 0.]));
            assert_eq!(
                f.attributes["accessRoute"]["coordinates"],
                serde_json::json!(route)
            );
            assert!(f
                .relations
                .iter()
                .any(|r| r.kind == "accessFrom" && r.target_id == street));
        }
    }
    check_address(&catalog, distant, street, &route);
    check_paths_and_ward(&catalog);
    fn check_paths_and_ward(catalog: &Catalog) {
        let paths: Vec<_> = catalog
            .features
            .values()
            .filter(|f| f.kind == "footpath")
            .collect();
        assert_eq!(paths.len(), 3);
        assert!(paths
            .iter()
            .all(|f| f.layer_id == "roads"
                && f.attributes["widths"] == serde_json::json!([0.7, 0.7])));
        assert!(catalog
            .features
            .values()
            .any(|f| f.kind == "ward" && f.name == "ward"));
    }
}

#[test]
fn shared_sponsors_finance_distant_institutions_only_when_the_required_sites_fit() {
    use atlas_generation::town::fabric::{EditOutcome, FabricEdit, FabricOwner};
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    fn contributor(
        town: &mut Town,
        x: f64,
        spatial: &NativeGeos,
    ) -> atlas_generation::town::fabric::HoldingId {
        let id = town.establish(proposal(x), spatial).unwrap().unwrap();
        town.fit_building(
            id,
            polygon(&rectangle([x, 1.], [1., 0.], [0., 1.], 5., 6.)),
            spatial,
        )
        .unwrap();
        town.occupy(id, 1., 1., 1., 0.);
        id
    }
    let sponsors = [-150., 150.]
        .map(|x| contributor(&mut town, x, &spatial))
        .to_vec();
    let build = |x| {
        let mut claim = proposal(x);
        claim.kind = supplied_kind(Kind::Worship);
        FabricEdit::Sponsored {
            contributors: sponsors.clone(),
            placement: Box::new(FabricEdit::Establish {
                proposal: claim,
                purpose: None,
                conditions: Default::default(),
                outdoor: false,
                buildings: vec![polygon(&rectangle([x, 1.], [1., 0.], [0., 1.], 5., 6.))],
            }),
        }
    };
    let required = FabricEdit::Project(vec![build(-500.), build(-500.)]);
    assert!(matches!(
        town.apply(required, &spatial).unwrap(),
        EditOutcome::Declined
    ));
    assert_eq!(town.holdings().len(), 2);
    assert!(town.holdings().iter().all(|h| h.means == 1.));

    let connected = FabricEdit::Project(vec![
        build(-500.),
        build(500.),
        FabricEdit::Optional(Box::new(build(500.))),
    ]);
    assert!(matches!(
        town.apply(connected, &spatial).unwrap(),
        EditOutcome::Project(_)
    ));
    assert_eq!(town.holdings().len(), 4);
    assert_sponsorship_only(&town.holdings()[2..], &sponsors);
    assert!(town.holdings()[..2].iter().all(|h| h.means < 1.));
}
fn assert_sponsorship_only(
    holdings: &[atlas_generation::town::fabric::Holding],
    sponsors: &[atlas_generation::town::fabric::HoldingId],
) {
    for holding in holdings {
        assert_eq!(holding.sponsors, sponsors);
        assert!(holding.access_via.is_none());
        assert!(holding.ties.is_empty());
    }
}

#[test]
fn increasing_farm_housing_capacity_leaves_the_barn_at_its_built_height() {
    use atlas_generation::town::fabric::{EditOutcome, FabricEdit, FabricOwner};
    let spatial = NativeGeos::new(0.001).unwrap();
    let mut town = town();
    let mut farm = proposal(0.);
    farm.kind = supplied_kind(Kind::Farmstead);
    let id = town.establish(farm, &spatial).unwrap().unwrap();
    for y in [1., 12.] {
        assert!(town
            .fit_building(
                id,
                polygon(&rectangle([0., y], [1., 0.], [0., 1.], 6., 5.)),
                &spatial
            )
            .unwrap());
    }
    assert!(matches!(
        town.apply(FabricEdit::Raise { premises: id }, &spatial)
            .unwrap(),
        EditOutcome::Premises(_)
    ));
    assert_eq!(town.holdings()[id.0 as usize].storeys, vec![2, 1]);
}
