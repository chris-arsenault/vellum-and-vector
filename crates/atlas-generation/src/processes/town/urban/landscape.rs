//! Construction realizes broad occupied ground, public precincts and their open courts.
use super::{
    buildable,
    fields::{policy, position},
    geometry::pos,
    Element, Urban,
};
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

pub(super) const USES: [&str; 5] = [
    "Settled ground",
    "Crowded housing",
    "Garden housing",
    "Trade frontage",
    "Working ground",
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
pub(super) fn develop(
    state: &mut State,
    u: &mut Urban,
    frame: &Geometry,
    reserved: &[Feature],
) -> io::Result<()> {
    state
        .regional
        .as_mut()
        .unwrap()
        .city
        .walls
        .append(&mut u.defense);
    let mesh = state.field().mesh();
    let k = state.spatial.as_ref();
    let template = policy(state)?;
    let n = mesh.len();
    u.blocks.clear();
    u.open.clear();
    u.landmarks.clear();
    let mut layers = vec![vec![0.; n]; USES.len()];
    let mut main = vec![0.; n];
    for c in 0..n {
        let x = u.fields.claims[c];
        let access = u.fields.access[c];
        let civic = u.fields.civic[c];
        let reserve = 1. + x.farm * 2. + x.ruin * 3.;
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
        // Gardens require maintained grounds and leave substantially more land open.
        // Workshops follow useful transport, while crowded housing draws from the
        // ratio of households to standing fabric across the neighborhood.
        layers[0][c] = occupied;
        layers[1][c] = occupied * (x.crowd / (0.55 + x.investment)).min(2.);
        layers[2][c] = occupied * (x.investment / (0.35 + x.crowd)).min(1.7) * (1. - 0.55 * access);
        layers[3][c] = occupied * (x.work + 0.2) * access;
        layers[4][c] = occupied * x.work / (0.55 + x.home) * (0.4 + 0.6 * access);
        use super::programs::Role;
        if let Some(p) = program {
            let distance = mesh.physical_distance(c, p.cell) / p.reach;
            let local = (1. - distance).clamp(0., 1.);
            let privileged = occupied * strength;
            match p.role {
                Role::Tenements => {
                    layers[1][c] += privileged * (2.0 + x.crowd);
                    layers[3][c] *= 0.35;
                }
                Role::Estates => {
                    layers[2][c] += privileged * (2.3 + x.investment);
                    layers[1][c] *= 0.16;
                    layers[3][c] *= 0.25;
                }
                Role::Exchange => layers[3][c] += privileged * (0.35 + 1.7 * access),
                Role::Workshops => {
                    layers[4][c] += privileged * (1. + x.work);
                    layers[3][c] *= 0.30;
                }
                Role::Civic | Role::Fortified => {
                    layers[0][c] *= 1. - 0.75 * local * strength.min(1.);
                    layers[1][c] *= 0.30;
                }
            }
        }
    }
    let mut masks: Vec<Geometry> = reserved.iter().map(|f| f.geometry.clone()).collect();
    for (i, s) in u.sponsors.iter().enumerate() {
        let strength: Vec<_> = (0..n)
            .map(|c| {
                if u.fields.sponsor[c] == Some(i) && u.fields.inside[c] {
                    u.fields.civic[c]
                } else {
                    0.
                }
            })
            .collect();
        if let Some(shape) = contour(state, &strength, 0.37)? {
            if let Some(shape) = buildable(k, shape, reserved)? {
                let mut area = ground(shape.clone(), "Civic precinct");
                area.name = format!("{} precinct", s.name);
                area.attributes
                    .insert("sponsor".into(), s.source.clone().into());
                u.blocks.push(area);
                masks.push(shape);
                if let Some(court) = contour(state, &strength, 0.72)? {
                    let mut court = Element::new(court, "square", &format!("{} court", s.name));
                    court
                        .attributes
                        .insert("sponsor".into(), s.source.clone().into());
                    u.open.push(court);
                }
            }
        }
    }
    let reserved_land = k.union_all(&masks).map_err(io::Error::other)?;
    let mut occupied = None;
    // Draw the specialized grounds first and remove them from the general occupation.
    for (kind, threshold) in [(3, 0.8), (1, 1.15), (2, 0.72), (4, 0.75), (0, 0.40)] {
        let Some(mut geometry) = contour(state, &layers[kind], threshold)? else {
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
        let surfaces = parts(&geometry);
        for shape in &surfaces {
            let mut tract = ground(shape.clone(), USES[kind]);
            let at = k.interior_position(shape).map_err(io::Error::other)?;
            if let Some(c) =
                crate::field::refinement::courses::cell_at(mesh, super::geometry::xy(at))
            {
                let q = u.fields.claims[c];
                tract.attributes.insert("density".into(), q.people.into());
                tract.attributes.insert("builtShare".into(), q.built.into());
            }
            tract
                .attributes
                .insert("settlementTemplate".into(), template.selected.name().into());
            u.blocks.push(tract);
        }
        let mut merge = surfaces;
        merge.extend(occupied.take());
        occupied = k.union_all(&merge).map_err(io::Error::other)?;
    }
    // Districts organize only the principal connected settlement. A walk across a
    // small gap can join neighborhoods without filling the same gap with buildings.
    u.domain = None;
    if let Some(shape) = contour(state, &main, 0.68)? {
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
        let reserve = k.union_all(&holes).map_err(io::Error::other)?;
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
            let mut largest = 0.;
            for part in parts(&land) {
                let area = k.area(&part).map_err(io::Error::other)?;
                if area > largest {
                    u.domain = Some(part);
                    largest = area;
                }
            }
        }
    }
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
