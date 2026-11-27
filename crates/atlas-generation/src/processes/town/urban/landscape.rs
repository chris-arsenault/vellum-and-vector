//! Construction realizes broad occupied ground, public precincts and their open courts.
use super::{
    buildable,
    fields::{policy, position},
    geometry::pos,
    Element, Urban,
};
use crate::spatial::{Overlay, SpatialKernel};
use crate::{
    atlas::state::State,
    features::Feature,
    field::geographic_contours,
    town::catalogue::{Activity, PlaceRules, PLACES},
};
use atlas_map::{
    regions::{parts, point},
    Geometry,
};
use std::io;

pub(super) const USES: [&str; 6] = [
    "Settled ground",
    "Crowded housing",
    "Garden housing",
    "Trade frontage",
    "Working ground",
    "Common ground",
];
/// The built share of the ground round a cell from which the City maps a land use there.
const TRACT_BUILT: f64 = 0.25;
/// The built share from which ground belongs to a district: more of it built than not.
pub(super) const DISTRICT_BUILT: f64 = 0.5;
pub(super) struct SettlementGround {
    centre: atlas_map::Position,
    radius: f64,
    /// The settlement's own census.
    people: f64,
    /// Each neighbouring settlement's place and census.
    neighbours: Vec<(Geometry, f64)>,
}
/// The census a settlement record carries. A record without one counts as a single
/// household.
fn census(settlement: &Feature) -> f64 {
    ["settlementPopulation", "population"]
        .iter()
        .filter_map(|key| settlement.attributes.get(*key)?.as_f64())
        .find(|people| *people > 0.)
        .unwrap_or(5.)
}
/// How strongly a settlement of `people` draws ground `distance` away to itself: by its
/// size, falling with the square of the distance, as trade between two towns divides the
/// country between them. Ground within a quarter of it is at its door.
fn pull(people: f64, distance: f64, quarter: f64) -> f64 {
    people / distance.max(quarter).powi(2)
}
impl SettlementGround {
    pub(super) fn captured(state: &State) -> io::Result<Self> {
        let policy = policy(state)?;
        let city = crate::atlas::regional::city::captured_settlement(state)?;
        let radius = city
            .as_ref()
            .and_then(|f| f.attributes.get("builtKm2"))
            .and_then(serde_json::Value::as_f64)
            .filter(|&km2| km2 > 0.)
            .map_or(policy.quarter(), |km2| {
                (km2 * 1e6 / std::f64::consts::PI).sqrt()
            });
        let id = state.scope.city.as_ref().map(|c| c.settlement);
        let neighbours = super::values(state, "settlement")?
            .into_iter()
            .filter(|f| Some(f.id) != id && crate::field::poi::reads::inhabited(f))
            .map(|f| {
                let people = census(&f);
                (f.geometry, people)
            })
            .collect();
        Ok(Self {
            centre: pos(policy.site.centre),
            radius,
            people: city.as_ref().map_or(5., census),
            neighbours,
        })
    }
}

/// Whether a neighbouring settlement draws a body `distance` from the seat more strongly
/// than this settlement does. A city keeps a quarter that has grown to reach a village;
/// a town of like size keeps the ground nearer to itself.
fn drawn_away(
    kernel: &dyn SpatialKernel,
    body: &Geometry,
    distance: f64,
    settlement: &SettlementGround,
    quarter: f64,
) -> io::Result<bool> {
    let own = pull(settlement.people, distance, quarter);
    for (place, people) in &settlement.neighbours {
        let away = kernel.distance(body, place).map_err(io::Error::other)?;
        if pull(*people, away, quarter) > own {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Nearby occupied banks and banks connected by a surveyed bridge belong to one
/// settlement. The space used to find those neighbours stays outside its land.
pub(super) fn principal_ground(
    kernel: &dyn SpatialKernel,
    ground: &Geometry,
    settlement: &SettlementGround,
    quarter: f64,
    crossings: &[Geometry],
) -> io::Result<Option<Geometry>> {
    let mut joins = vec![ground.clone()];
    joins.extend_from_slice(crossings);
    let Some(joined) = kernel.union_all(&joins).map_err(io::Error::other)? else {
        return Ok(None);
    };
    let Some(neighborhoods) = kernel
        .buffer(&joined, quarter / 2.)
        .map_err(io::Error::other)?
    else {
        return Ok(None);
    };
    let seat = point(settlement.centre);
    let mut bodies = Vec::new();
    for area in parts(&neighborhoods) {
        if let Some(occupied) = kernel
            .overlay(ground, &area, Overlay::Intersection)
            .map_err(io::Error::other)?
            .and_then(atlas_map::regions::polygon)
        {
            let distance = kernel
                .distance(&occupied, &seat)
                .map_err(io::Error::other)?;
            bodies.push((occupied, distance));
        }
    }
    // The body nearest the seat, within the settlement's own radius, is the settlement's
    // whoever its neighbours are: the seat may stand on a court inside it, and a small town
    // beside a great one still has its own ground.
    let home = bodies
        .iter()
        .map(|(_, distance)| *distance)
        .fold(f64::INFINITY, f64::min)
        .min(settlement.radius);
    let mut settled = Vec::new();
    let mut principal = None;
    let mut best = 0.;
    for (occupied, distance) in bodies {
        let m2 = kernel.area(&occupied).map_err(io::Error::other)?;
        if distance > home && drawn_away(kernel, &occupied, distance, settlement, quarter)? {
            continue;
        }
        if distance <= settlement.radius {
            settled.push(occupied);
            continue;
        }
        let score = m2 / (1. + distance / quarter).powi(2);
        if score > best {
            best = score;
            principal = Some(occupied);
        }
    }
    if settled.is_empty() {
        return Ok(principal);
    }
    kernel.union_all(&settled).map_err(io::Error::other)
}

pub(super) fn crossings(u: &Urban, mesh: &crate::lattice::TriangularLattice) -> Vec<Geometry> {
    u.bridge_links(mesh)
        .into_iter()
        .map(|deck| super::geometry::line(&[position(mesh, deck.a), position(mesh, deck.b)]))
        .collect()
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod district_ground_tests {
    use super::*;
    use atlas_map::{regions::rectangle, Bounds, Position};

    #[test]
    fn a_precinct_holds_only_ground_households_do_not_want_more() {
        // At its door, on ordinary settled ground, a sponsor holds its precinct.
        assert!(precinct_margin(1., 1., 0.72) > 0.);
        // The same claim a long walk away loses to ordinary housing.
        assert!(precinct_margin(0.6, 1., 0.72) < 0.);
        // Crowded housing outbids the sponsor even at its door.
        assert!(precinct_margin(1., 1., 1.4) < 0.);
        // A work that asks less of its surroundings holds less of them.
        assert!(precinct_margin(0.85, 1., 0.72) > 0.);
        assert!(precinct_margin(0.85, 0.55, 0.72) < 0.);
    }

    #[test]
    fn district_ground_is_claimed_and_mostly_built() {
        let housing = super::super::fields::Claims {
            home: 0.7,
            people: 1400.,
            built: 0.9,
            ..Default::default()
        };
        let farmland = super::super::fields::Claims {
            home: 0.02,
            people: 30.,
            farm: 0.65,
            ..Default::default()
        };
        let eligible = |claim: super::super::fields::Claims| {
            let occupied = occupation(claim, 0.4, 0., 0., true);
            district_margin(occupied, 1., claim.built) > 0.
        };
        assert!(eligible(housing));
        assert!(!eligible(farmland));
        // People on ground that is mostly open do not make it a district.
        assert!(!eligible(super::super::fields::Claims {
            built: 0.2,
            ..housing
        }));
        assert!(!eligible(super::super::fields::Claims {
            reserved: true,
            ..housing
        }));
    }

    #[test]
    fn principal_city_keeps_detached_homes_and_a_bridged_bank_without_taking_a_neighboring_town() {
        let k = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let a = rectangle(Bounds(-70., -40., 60., 40.));
        let b = rectangle(Bounds(240., -40., 340., 40.));
        let detached = rectangle(Bounds(-15., 105., 15., 135.));
        let other_town = rectangle(Bounds(480., -40., 560., 40.));
        let ground = k.union_all(&[a, b, detached, other_town]).unwrap().unwrap();
        let settlement = SettlementGround {
            centre: Position::xy(0., 0.),
            radius: 150.,
            people: 2_000.,
            neighbours: vec![(point(Position::xy(520., 0.)), 1_500.)],
        };
        let sites = [[0., 0.], [290., 0.], [0., 120.], [520., 0.], [150., 0.]].map(pos);
        let membership = |crossings: &[Geometry]| {
            let g = principal_ground(&k, &ground, &settlement, 30., crossings)
                .unwrap()
                .unwrap();
            k.covers_points(&g, &sites).unwrap()
        };
        assert_eq!(membership(&[]), [true, false, true, false, false]);
        let mesh = crate::lattice::WorldLatticeOptions::default()
            .build(Bounds(-150., -150., 750., 200.), 100., 0., |_, _| true)
            .unwrap();
        let mut u = Urban::default();
        let deck = super::super::geometry::line(&[[50., 0.], [250., 0.]]);
        let mut bridge = Element::way(deck, "thoroughfare", "Avenue", 8.);
        bridge.attributes.insert(
            "roadFeatures".into(),
            serde_json::json!([{"kind":"bridge", "segment":0}]),
        );
        u.routes.push(bridge);
        assert_eq!(
            membership(&crossings(&u, &mesh)),
            [true, true, true, false, false]
        );
    }

    #[test]
    fn built_bodies_go_to_the_settlement_whose_people_draw_them_most() {
        let k = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        // The seat stands on an open court. Its home quarter lies to the west, a second
        // quarter to the east with a hamlet's marker inside it, and a third body further
        // east round another settlement's marker. A quarter is 300 m.
        let home = rectangle(Bounds(-2_000., -400., -350., 400.));
        let east = rectangle(Bounds(500., -400., 2_000., 400.));
        let far = rectangle(Bounds(3_000., -300., 3_600., 300.));
        let ground = k.union_all(&[home, east, far]).unwrap().unwrap();
        let sites = [[-1_000., 0.], [1_000., 0.], [3_300., 0.]].map(pos);
        let hamlet = point(Position::xy(1_500., 0.));
        let other = point(Position::xy(3_300., 0.));
        let membership = |people: f64, neighbours: Vec<(Geometry, f64)>| {
            let settlement = SettlementGround {
                centre: Position::xy(0., 0.),
                radius: 4_000.,
                people,
                neighbours,
            };
            let g = principal_ground(&k, &ground, &settlement, 300., &[])
                .unwrap()
                .unwrap();
            k.covers_points(&g, &sites).unwrap()
        };
        // A city keeps the quarter a hamlet stands in; a town of its own size keeps its
        // ground.
        let town = vec![(hamlet.clone(), 400.), (other.clone(), 150_000.)];
        assert_eq!(membership(200_000., town), [true, true, false]);
        // A village the city has grown to reach becomes one of its quarters.
        let village = vec![(hamlet.clone(), 400.), (other.clone(), 500.)];
        assert_eq!(membership(200_000., village), [true, true, true]);
        // Places of like size divide the ground between them by distance.
        let peers = vec![(hamlet.clone(), 600.), (other.clone(), 600.)];
        assert_eq!(membership(600., peers), [true, false, false]);
        // A small town keeps its home body with a great neighbour's marker inside it.
        let great = vec![
            (point(Position::xy(-1_200., 0.)), 20_000.),
            (hamlet, 400.),
            (other, 20_000.),
        ];
        assert_eq!(membership(800., great), [true, false, false]);
    }
}

pub(super) fn contour(state: &State, values: &[f64], level: f64) -> io::Result<Option<Geometry>> {
    let members: Vec<_> = values
        .iter()
        .enumerate()
        .filter_map(|(i, v)| (*v > level).then_some(i))
        .collect();
    if members.is_empty() {
        return Ok(None);
    }
    let shape = geographic_contours::membership(state, &members, &|i| Ok(0.5 + values[i] - level))?;
    geographic_contours::clip(state, shape)
}
fn ground(shape: Geometry, usage: &str) -> Element {
    let mut e = Element::new(shape, "urbanGround", usage);
    e.attributes.insert("groundUse".into(), usage.into());
    e
}
/// Split housing only where a second activity forms a coherent concentration.
/// Both sides remain ordinary tracts and carry their own mix into Street.
fn mixed_housing(
    kernel: &dyn crate::spatial::SpatialKernel,
    surface: &Geometry,
    masks: &[Option<Geometry>; 2],
) -> io::Result<Vec<(Geometry, Option<usize>)>> {
    let mut tracts = Vec::new();
    let mut remaining = Some(surface.clone());
    for (kind, mask) in [3, 4].into_iter().zip(masks) {
        let (Some(mask), Some(area)) = (mask, remaining.as_ref()) else {
            continue;
        };
        if !kernel
            .relation(area, mask, crate::spatial::Predicate::Intersects)
            .map_err(io::Error::other)?
        {
            continue;
        }
        if let Some(pocket) = kernel
            .overlay(area, mask, Overlay::Intersection)
            .map_err(io::Error::other)?
        {
            tracts.extend(parts(&pocket).into_iter().map(|g| (g, Some(kind))));
            remaining = kernel
                .overlay(area, mask, Overlay::Difference)
                .map_err(io::Error::other)?;
        }
    }
    if let Some(rest) = remaining {
        tracts.extend(parts(&rest).into_iter().map(|g| (g, None)));
    }
    Ok(tracts)
}
pub(super) fn develop(
    state: &mut State,
    u: &mut Urban,
    frame: &Geometry,
    reserved: &[Feature],
    activity: super::activity::Settings,
) -> io::Result<()> {
    state.regional.as_mut().unwrap().city.walls = std::mem::take(&mut u.defense);
    let mesh = state.field().mesh();
    let k = state.spatial.as_ref();
    let union = |shapes: &[Geometry]| {
        if shapes.is_empty() {
            Ok(None)
        } else {
            k.union_all(shapes).map_err(io::Error::other)
        }
    };
    let template = policy(state)?;
    let n = mesh.len();
    u.blocks.clear();
    u.open.clear();
    u.landmarks.clear();
    let mut layers = vec![vec![0.; n]; USES.len()];
    let mut secondary = [vec![0.; n], vec![0.; n]];
    let mut mix = vec![[0.; 3]; n];
    u.fields.activity = super::activity::develop(state, u, template.quarter(), activity)?;
    let (main, rival) = land_use_bids(u, mesh, template, &mut layers, &mut secondary, &mut mix);
    let households = Households {
        claim: &rival,
        sponsor_weight: activity.precincts,
    };
    let reserved_land = reserve_public_ground(state, u, reserved, k, union, households)?;
    let secondary_masks = [
        contour(state, &secondary[0], 0.)?,
        contour(state, &secondary[1], 0.)?,
    ];
    let mut sampler = crate::lattice::sampling::Sampler::new(mesh);
    let [ox, oy] = mesh.origin();
    let mut build_mixed_tracts = |kind: usize,
                                  geometry: Geometry|
     -> Result<Vec<Geometry>, io::Error> {
        let surfaces = parts(&geometry);
        for surface in &surfaces {
            let tracts = if kind <= 2 {
                mixed_housing(k, surface, &secondary_masks)?
            } else {
                vec![(surface.clone(), None)]
            };
            for (shape, secondary_use) in tracts {
                let at = k.interior_position(&shape).map_err(io::Error::other)?;
                let mut tract = ground(shape, USES[kind]);
                if let Some(use_) = secondary_use {
                    tract
                        .attributes
                        .insert("secondaryUse".into(), USES[use_].into());
                }
                if let Some(c) =
                    crate::field::refinement::courses::cell_at(mesh, super::geometry::xy(at))
                {
                    let q = u.fields.claims[c];
                    tract.attributes.insert("density".into(), q.people.into());
                    tract.attributes.insert("builtShare".into(), q.built.into());
                    if kind != 5 {
                        let [px, py] = super::geometry::xy(at);
                        let mut weight = |use_: usize| {
                            sampler.sample([px - ox, py - oy], |cell| Ok(mix[cell][use_]))
                        };
                        tract.attributes.insert(
                            "useMix".into(),
                            serde_json::json!({"housing":weight(0)?,"trade":weight(1)?,"workshops":weight(2)?}),
                        );
                    }
                }
                tract
                    .attributes
                    .insert("settlementTemplate".into(), template.selected.name().into());
                u.blocks.push(tract);
            }
        }
        Ok(surfaces)
    };
    let mut occupied = None;
    // Local bids decide contested uses. General settlement fills the residual ground.
    for kind in [1, 2, 3, 4, 5, 0] {
        let Some(mut geometry) = contour(state, &layers[kind], 0.)? else {
            continue;
        };
        for mask in [reserved_land.as_ref(), occupied.as_ref()]
            .into_iter()
            .flatten()
        {
            let Some(g) = k
                .overlay(&geometry, mask, crate::spatial::Overlay::Difference)
                .map_err(io::Error::other)?
            else {
                geometry = Geometry::GeometryCollection { geometries: vec![] };
                break;
            };
            geometry = g;
        }
        let surfaces = build_mixed_tracts(kind, geometry)?;
        let mut merge = surfaces;
        merge.extend(occupied.take());
        occupied = union(&merge)?;
    }
    districtable_ground(state, u, frame, reserved, union, &main)?;
    place_outlying_sites(u, mesh, k)?;
    Ok(())
}

fn occupation(
    x: super::fields::Claims,
    access: f64,
    civic: f64,
    commons: f64,
    inside: bool,
) -> f64 {
    if x.reserved || !inside {
        return 0.;
    }
    let reserve = 1. + x.farm * 2. + x.ruin * 3. + civic * commons;
    (x.home * (0.70 + 0.42 * access) + x.work * 0.65 + x.built * 3. + civic * 0.5) / reserve
}

// owner-direction(2026-11-27): city districts should have near 100 percent urban coverage
/// Ground belongs to a district where claims occupy it and more of it is built than not.
/// The interior prior strengthens local claims; it cannot claim unoccupied land on its own.
fn district_margin(occupied: f64, demand: f64, built: f64) -> f64 {
    (occupied + 1.25 * demand * occupied.min(1.) - 0.68).min(built - DISTRICT_BUILT)
}

fn land_use_bids(
    u: &mut Urban,
    mesh: &crate::lattice::TriangularLattice,
    template: &crate::town::templates::Selection,
    layers: &mut [Vec<f64>],
    secondary: &mut [Vec<f64>; 2],
    mix: &mut [[f64; 3]],
) -> (Vec<f64>, Vec<f64>) {
    let n = mesh.len();
    let mut main = vec![0.; n];
    // The strongest claim households make on each cell, as settled, crowded or garden
    // housing.
    let mut rival = vec![0.; n];
    for c in 0..n {
        let x = u.fields.claims[c];
        let access = u.fields.access[c];
        let civic = u.fields.civic[c];
        let work = u.work_at(c);
        // Actual occupied land can follow an approach well beyond the contiguous core.
        let occupied = occupation(x, access, civic, work.commons, u.fields.inside[c]);
        u.fields.developed[c] = occupied;
        // Land use describes ground that is built on.
        let tract_margin = (occupied - 0.40).min(x.built - TRACT_BUILT);
        let program = super::programs::at(u, c);
        let prior = u.fields.stencil[c];
        let demand = if x.reserved || x.people + x.built <= 0. {
            0.
        } else {
            prior
        };
        main[c] = district_margin(occupied, demand, x.built);
        let strength = program.map_or(0., |p| p.strength) * demand;
        let demands = x.demands;
        let local = program.map_or(0., |p| {
            1. / (1. + (mesh.physical_distance(c, p.cell) / p.reach).powi(2))
        });
        let strength = strength * (0.4 + 0.6 * local);
        let density = x.crowd / (0.4 + x.crowd + x.investment);
        let affluent = x.investment / (0.35 + x.investment + x.crowd);
        let [px, py] = position(mesh, c);
        let texture = crate::noise::unit_noise(px, py, 71, template.quarter() * 3., 2);
        let bids = [
            0.72 + 0.4 * (1. - demand),
            density * (0.8 + 0.3 * texture) + strength * demands.housing * (0.45 + 0.55 * density),
            civic * work.gardens
                + affluent * (0.7 + 0.45 * texture)
                + strength * demands.gardens * (0.45 + affluent * 0.6),
            u.fields.activity[c][0],
            u.fields.activity[c][1],
            strength * demands.commons * (0.4 + 0.6 * texture + 0.4 * x.farm) / (1. + x.built),
        ];
        let housing = bids[0].max(bids[1]).max(bids[2]);
        rival[c] = housing;
        let weights = [housing, bids[3], bids[4]].map(|v| v.max(0.).powi(3));
        let total = weights.iter().sum::<f64>();
        mix[c] = weights.map(|w| w / total);
        for (layer, (bid, other)) in secondary
            .iter_mut()
            .zip([(bids[3], bids[4]), (bids[4], bids[3])])
        {
            layer[c] = tract_margin.min(bid - (0.80 * housing).max(other));
        }
        layers[0][c] = tract_margin;
        for kind in 1..bids.len() {
            let other = bids
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != kind)
                .map(|(_, v)| *v)
                .fold(0., f64::max);
            layers[kind][c] = tract_margin.min(bids[kind] - other);
        }
    }
    (main, rival)
}

/// A sponsor holds the ground round it as its precinct where its claim is stronger than the
/// households'. Its claim falls with the walk from its door; theirs rises where housing is
/// crowded or sought after and on ground outside the city's interior, so a precinct is
/// small in a crowded quarter and a sponsor that asks little of its surroundings keeps its
/// own grounds alone. Trades and workshops work inside a precinct as they do among homes.
fn precinct_margin(civic: f64, sponsor_demand: f64, households: f64) -> f64 {
    civic * sponsor_demand - households
}

/// The households' claim on each cell and how a sponsor's claim weighs against it.
#[derive(Clone, Copy)]
struct Households<'a> {
    claim: &'a [f64],
    sponsor_weight: f64,
}

fn reserve_public_ground(
    state: &State,
    u: &mut Urban,
    reserved: &[Feature],
    k: &dyn SpatialKernel,
    union: impl Fn(&[Geometry]) -> Result<Option<Geometry>, io::Error>,
    households: Households<'_>,
) -> Result<Option<Geometry>, io::Error> {
    let mut masks: Vec<Geometry> = reserved.iter().map(|f| f.geometry.clone()).collect();
    let park_shapes: Vec<_> = u.parks.iter().map(|p| p.geometry.clone()).collect();
    let park_mask = union(&park_shapes)?;
    for (i, s) in u.sponsors.iter().enumerate() {
        if let Some(grounds) = &s.grounds {
            if let Some(area) = buildable(k, grounds.clone(), reserved)? {
                let mut ground =
                    Element::new(area.clone(), "square", &format!("{} grounds", s.name));
                ground
                    .attributes
                    .insert("sponsor".into(), s.source.clone().into());
                u.open.push(ground);
                masks.push(area);
            }
        }
        let demand =
            households.sponsor_weight * s.work.map_or(1., |(family, _)| family.demands().civic);
        let rival = households.claim;
        let strength: Vec<_> = (0..rival.len())
            .map(|c| {
                if u.fields.sponsor[c] == Some(i) && u.fields.inside[c] {
                    precinct_margin(u.fields.civic[c], demand, rival[c])
                } else {
                    -1.
                }
            })
            .collect();
        if let Some(shape) = contour(state, &strength, 0.)? {
            if let Some(shape) = buildable(k, shape, reserved)? {
                let shape = if let Some(mask) = &park_mask {
                    let Some(shape) = k
                        .overlay(&shape, mask, Overlay::Difference)
                        .map_err(io::Error::other)?
                        .and_then(atlas_map::regions::polygon)
                    else {
                        continue;
                    };
                    shape
                } else {
                    shape
                };
                let mut area = ground(shape.clone(), "Civic precinct");
                area.name = format!("{} precinct", s.name);
                let at = k.interior_position(&shape).map_err(io::Error::other)?;
                if let Some(c) = crate::field::refinement::courses::cell_at(
                    state.field().mesh(),
                    super::geometry::xy(at),
                ) {
                    let claims = u.fields.claims[c];
                    area.attributes
                        .insert("density".into(), claims.people.into());
                    area.attributes
                        .insert("builtShare".into(), claims.built.into());
                }
                area.attributes
                    .insert("sponsor".into(), s.source.clone().into());
                u.blocks.push(area);
                masks.push(shape.clone());
            }
        }
    }
    for park in &u.parks {
        masks.push(park.geometry.clone());
        u.open.push(park.clone());
    }
    let reserved_land = union(&masks)?;
    Ok(reserved_land)
}

fn districtable_ground(
    state: &State,
    u: &mut Urban,
    frame: &Geometry,
    reserved: &[Feature],
    union: impl Fn(&[Geometry]) -> io::Result<Option<Geometry>>,
    main: &[f64],
) -> io::Result<()> {
    let k = state.spatial.as_ref();
    let mesh = state.field().mesh();
    let template = policy(state)?;
    u.domain = None;
    if let Some(shape) = contour(state, main, 0.)? {
        let reach = template.quarter().max(mesh.spacing()) * 0.60;
        if let Some(expanded) = k.buffer(&shape, reach).map_err(io::Error::other)? {
            if let Some(closed) = k.buffer(&expanded, -reach).map_err(io::Error::other)? {
                let mut settled = Vec::new();
                for g in parts(&closed) {
                    if k.relation(
                        &g,
                        state.scope.settled_outline(),
                        crate::spatial::Predicate::Intersects,
                    )
                    .map_err(io::Error::other)?
                    {
                        settled.push(g);
                    }
                }
                if let Some(occupied) = union(&settled)? {
                    u.domain = principal_ground(
                        k,
                        &occupied,
                        &SettlementGround::captured(state)?,
                        template.quarter(),
                        &crossings(u, mesh),
                    )?;
                }
            }
        }
    }
    if let Some(g) = u.domain.take() {
        // Civic precincts belong to districts; only their public courts remain voids.
        let mut holes: Vec<_> = reserved.iter().map(|f| f.geometry.clone()).collect();
        holes.extend(u.open.iter().map(|e| e.geometry.clone()));
        let protected: Vec<_> = u
            .fields
            .claims
            .iter()
            .map(|claim| f64::from(claim.reserved as u8))
            .collect();
        holes.extend(contour(state, &protected, 0.5)?);
        let reserve = union(&holes)?;
        let core = k
            .overlay(&g, frame, crate::spatial::Overlay::Intersection)
            .map_err(io::Error::other)?;
        let eligible = match (core, reserve) {
            (Some(g), Some(h)) => k
                .overlay(&g, &h, crate::spatial::Overlay::Difference)
                .map_err(io::Error::other)?,
            (g, _) => g,
        };
        if let Some(land) = eligible {
            // A park or public court may cut the principal settlement in two.
            // Both inhabited banks still need districts.
            u.domain = union(&parts(&land))?;
        }
    }
    Ok(())
}

fn place_outlying_sites(
    u: &mut Urban,
    mesh: &crate::lattice::TriangularLattice,
    k: &dyn SpatialKernel,
) -> Result<(), io::Error> {
    for &c in &u.destinations {
        let x = u.fields.claims[c];
        let access = u.fields.access[c];
        let at = pos(position(mesh, c));
        let peripheral = u
            .domain
            .as_ref()
            .map(|g| k.covers_points(g, &[at]))
            .transpose()
            .map_err(io::Error::other)?
            .is_none_or(|v| !v[0]);
        if peripheral && x.people > 180. && x.built > 0.006 && (x.farm > 0.12 || access > 0.45) {
            let use_ = if x.trade > 0.5 && x.work > x.home && access > 0.65 {
                "Market hamlet"
            } else if x.farm > 0.12 {
                "Farmstead"
            } else {
                "Waystation"
            };
            let mut site = Element::new(point(at), "cityPlace", use_);
            site.attributes.insert("use".into(), use_.into());
            u.landmarks.push(site);
            continue;
        }
        if !peripheral {
            continue;
        }
        let use_ = if peripheral && x.farm > 0.12 {
            Activity::Agriculture
        } else if peripheral && access > 0.4 {
            Activity::Hospitality
        } else if x.work > x.home {
            Activity::Production
        } else {
            continue;
        };
        let reading = crate::town::city::CityReading {
            density: x.people / (1000. + x.people),
            built: x.built,
            wealth: x.investment / (1. + x.investment),
            standing: x.investment / (1. + x.investment),
            fringe: f64::from(peripheral as u8),
            ways: (access * 3.).round() as u32,
            ..Default::default()
        };
        if let Some((_, name, symbol)) = PLACES
            .iter()
            .map(|p| p.definition())
            .filter(|p| p.activity == use_)
            .filter_map(|p| {
                let appearance = p.city.appearance()?;
                let score = (appearance.raised_by)(&reading) * p.prominence;
                (score > 0.).then_some((score, p.label, appearance.symbol))
            })
            .max_by(|a, b| a.0.total_cmp(&b.0))
        {
            let mut site = Element::new(point(at), "cityPlace", name);
            site.attributes.insert("symbol".into(), symbol.into());
            u.landmarks.push(site);
        }
    }
    Ok(())
}
