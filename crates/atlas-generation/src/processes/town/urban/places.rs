//! Occupied neighbourhoods offer significant destinations to movement before routes settle.
use super::{
    fields::{policy, position},
    geometry::pos,
    Element, Urban,
};
use crate::human::identity::{Tradition, IDENTITY_SLOTS};
use crate::{
    atlas::state::State,
    noise::hash_unit,
    town::{
        catalogue::{PlaceRules, PLACES},
        city::{hot_spots, CityReading},
    },
};
use atlas_map::regions::point;
use std::io;

pub(super) fn destinations(state: &State, u: &mut Urban) -> io::Result<()> {
    if !u.interior.is_empty() {
        return Ok(());
    }
    let template = policy(state)?;
    let mesh = state.field().mesh();
    let town = crate::atlas::regional::city::captured_settlement(state)?;
    let radius = (state
        .spatial
        .area(state.scope.settled_outline())
        .map_err(io::Error::other)?
        / std::f64::consts::PI)
        .sqrt();
    let points: Vec<_> = (0..mesh.len()).map(|c| position(mesh, c)).collect();
    let quality = site_quality(state, u, mesh, &points)?;
    let reach = u.programs.first().map_or(template.quarter(), |p| p.reach);
    let mut kinds = vec![vec![0u32; PLACES.len()]; u.programs.len()];
    let seed = state
        .scope
        .city
        .as_ref()
        .map_or(0, |s| s.settlement.0 as i32);
    for c in hot_spots(
        &quality,
        &points,
        (reach * 0.4).max(mesh.spacing() * 2.),
        usize::MAX,
    ) {
        let Some(&idx) = u.fields.program.get(c) else {
            continue;
        };
        let Some(program) = u.programs.get(idx) else {
            continue;
        };
        if u.sponsors
            .iter()
            .any(|s| mesh.physical_distance(c, s.cell) < mesh.spacing() + s.ground.sqrt())
        {
            continue;
        }
        let x = u.fields.claims[c];
        let [px, py] = points[c];
        let near = |p: [f64; 2]| (px - p[0]).hypot(py - p[1]) < template.quarter();

        let mut craft = 0.;
        let mut faith = 0.;
        let (age, people) = local_traditions(state, c, &mut craft, &mut faith)?;
        let ways = state
            .field()
            .people()
            .view(crate::human::HumanField::KeptLine)
            .get(c)?
            .max(0.);
        let reading = CityReading {
            density: x.people / (1000. + x.people),
            built: x.built.clamp(0., 1.),
            standing: age / (50. + age),
            wealth: x.investment / (0.5 + x.investment + x.crowd),
            craft: craft / people,
            faith: faith / people,
            fringe: 1. - u.fields.stencil[c],
            ways: (3. * u.fields.access[c]).round() as u32 + u32::from(ways > 0.),
            shore: template.site.shore.is_some_and(near),
            seat: template.site.seat && near(template.site.centre),
            walls: crate::town::walls::enclosure(&state.regional.as_ref().unwrap().city.walls, c),
            ..Default::default()
        };
        let best = PLACES
            .iter()
            .enumerate()
            .filter_map(|(i, kind)| {
                let d = kind.definition();
                let appearance = d.city.appearance()?;
                if appearance.symbol == "park" {
                    return None;
                }
                let affinity = if d.activity == program.economic.activity() {
                    3.
                } else {
                    1.
                };
                let suitability = (appearance.raised_by)(&reading)
                    * d.prominence
                    * affinity
                    * template.affinity(d.activity, points[c], template.quarter());
                let weight = suitability / (1. + f64::from(kinds[idx][i])).powi(2);
                let roll = hash_unit(seed ^ i as i32, px, py).max(f64::MIN_POSITIVE);
                (weight > 0.).then(|| (-roll.ln() / weight, i, d.label, appearance))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0));
        if let Some((_, i, label, appearance)) = best {
            kinds[idx][i] += 1;
            let mut place = Element::new(point(pos(points[c])), "cityPlace", label);
            place
                .attributes
                .insert("catalogueUse".into(), serde_json::json!(PLACES[i]));
            place.attributes.insert(
                "districtEconomic".into(),
                serde_json::json!(program.economic),
            );
            place
                .attributes
                .insert("districtSocial".into(), serde_json::json!(program.social));
            place
                .attributes
                .insert("symbol".into(), appearance.symbol.into());
            place
                .attributes
                .insert("groundM2".into(), appearance.ground.into());
            place.attributes.insert(
                "districtAnchor".into(),
                serde_json::json!(points[program.cell]),
            );
            if let Some(era) = town.as_ref().and_then(|town| {
                crate::atlas::regional::city::occupation_era(
                    town,
                    radius,
                    (template.site.centre[0] - px).hypot(template.site.centre[1] - py),
                    appearance.ground.sqrt(),
                )
            }) {
                place
                    .attributes
                    .insert("establishedInEra".into(), era.into());
            }
            u.interior.push((c, place));
        }
    }
    Ok(())
}

fn site_quality(
    state: &State,
    u: &mut Urban,
    mesh: &crate::lattice::TriangularLattice,
    points: &[[f64; 2]],
) -> Result<Vec<f64>, io::Error> {
    let mut quality = vec![0.; mesh.len()];
    for (c, v) in quality.iter_mut().enumerate() {
        let x = u.fields.claims[c];
        if u.fields.inside[c]
            && u.fields.stencil[c] > 0.55
            && !x.reserved
            && x.people > 0.
            && x.built > 0.
            && u.fields.civic[c] < 0.7
        {
            *v = (x.home + x.work).sqrt() * (0.6 + u.fields.access[c]) + x.investment;
        }
    }
    let positions: Vec<_> = points.iter().copied().map(pos).collect();
    for park in &u.parks {
        for (v, in_park) in quality.iter_mut().zip(
            state
                .spatial
                .covers_points(&park.geometry, &positions)
                .map_err(io::Error::other)?,
        ) {
            if in_park {
                *v = 0.;
            }
        }
    }
    Ok(quality)
}

fn local_traditions(
    state: &State,
    c: usize,
    craft: &mut f64,
    faith: &mut f64,
) -> Result<(f64, f64), io::Error> {
    let mut age: f64 = 0.;
    for slot in 0..IDENTITY_SLOTS {
        let group = state.field().people().identity(slot);
        let people = group.people.get(c)?;
        if people > 0. {
            age = age.max(group.age.get(c)?);
            if group.traditions[Tradition::Craft as usize].get(c)? > 0 {
                *craft += people;
            }
            if group.traditions[Tradition::Faith as usize].get(c)? > 0 {
                *faith += people;
            }
        }
    }
    let people = state.field().people().people(c)?.max(1.);
    Ok((age, people))
}
