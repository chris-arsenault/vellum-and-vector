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
    let main = land_use_bids(u, mesh, template, &mut layers, &mut secondary, &mut mix);
    let reserved_land = reserve_public_ground(state, u, reserved, k, union, n)?;
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

fn land_use_bids(
    u: &mut Urban,
    mesh: &crate::lattice::TriangularLattice,
    template: &crate::town::templates::Selection,
    layers: &mut [Vec<f64>],
    secondary: &mut [Vec<f64>; 2],
    mix: &mut [[f64; 3]],
) -> Vec<f64> {
    let n = mesh.len();
    let mut main = vec![0.; n];
    for c in 0..n {
        let x = u.fields.claims[c];
        let access = u.fields.access[c];
        let civic = u.fields.civic[c];
        let work = u.work_at(c);
        let reserve = 1. + x.farm * 2. + x.ruin * 3. + civic * work.commons;
        // Actual occupied land can follow an approach well beyond the contiguous core.
        let occupied = if x.reserved || !u.fields.inside[c] {
            0.
        } else {
            (x.home * (0.70 + 0.42 * access) + x.work * 0.65 + x.built * 3. + civic * 0.5) / reserve
        };
        u.fields.developed[c] = occupied;
        let program = super::programs::at(u, c);
        let prior = u.fields.stencil[c];
        let demand = if x.reserved || x.people + x.built <= 0. {
            0.
        } else {
            prior
        };
        main[c] = occupied + 1.25 * demand;
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
        let weights = [housing, bids[3], bids[4]].map(|v| v.max(0.).powi(3));
        let total = weights.iter().sum::<f64>();
        mix[c] = weights.map(|w| w / total);
        for (layer, (bid, other)) in secondary
            .iter_mut()
            .zip([(bids[3], bids[4]), (bids[4], bids[3])])
        {
            layer[c] = (occupied - 0.4).min(bid - (0.80 * housing).max(other));
        }
        layers[0][c] = occupied - 0.40;
        for kind in 1..bids.len() {
            let other = bids
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != kind)
                .map(|(_, v)| *v)
                .fold(0., f64::max);
            layers[kind][c] = (occupied - 0.4).min(bids[kind] - other);
        }
    }
    main
}

fn reserve_public_ground(
    state: &State,
    u: &mut Urban,
    reserved: &[Feature],
    k: &dyn SpatialKernel,
    union: impl Fn(&[Geometry]) -> Result<Option<Geometry>, io::Error>,
    n: usize,
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
        let strength: Vec<_> = (0..n)
            .map(|c| {
                if u.fields.sponsor[c] == Some(i) && u.fields.inside[c] {
                    u.fields.civic[c] * s.work.map_or(1., |(family, _)| family.demands().civic)
                } else {
                    0.
                }
            })
            .collect();
        if let Some(shape) = contour(state, &strength, 0.37)? {
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
    if let Some(shape) = contour(state, main, 0.68)? {
        let reach = template.quarter().max(mesh.spacing()) * 0.60;
        if let Some(expanded) = k.buffer(&shape, reach).map_err(io::Error::other)? {
            if let Some(closed) = k.buffer(&expanded, -reach).map_err(io::Error::other)? {
                let pieces = parts(&closed);
                let centre = point(pos(template.site.centre));
                let mut best = 0.;
                for g in pieces {
                    let area = k.area(&g).map_err(io::Error::other)?;
                    let distance = k.distance(&g, &centre).map_err(io::Error::other)?;
                    let score = area * (1. + 1. / (1. + distance / reach));
                    if score > best {
                        best = score;
                        u.domain = Some(g);
                    }
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
