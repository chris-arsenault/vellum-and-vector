//! Located civic sponsors commit ground and access. Defense is a separate investment decision.
use super::{
    fields::{policy, position},
    geometry::xy,
    within_frame, Urban,
};
use crate::{
    atlas::{regional::city, state::State},
    features::Feature,
    field::{people::work::working, refinement::courses::cell_at, shared::Scalar},
    metric::search::search,
    town::catalogue::Activity,
};
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Site {
    pub name: String,
    pub source: String,
    pub cell: usize,
    pub ground: f64,
}
pub(super) fn civic(
    state: &State,
    urban: &mut Urban,
    frame: &Geometry,
    institutions: Vec<Feature>,
) -> io::Result<()> {
    let mesh = state.field().mesh();
    let template = policy(state)?;
    urban.sponsors.clear();
    for f in institutions {
        let Some(f) = within_frame(state.spatial.as_ref(), f, frame)? else {
            continue;
        };
        let at = state
            .spatial
            .interior_position(&f.geometry)
            .map_err(io::Error::other)?;
        if let Some(cell) = cell_at(mesh, xy(at)) {
            urban.sponsors.push(Site {
                name: f.name,
                source: f.id.to_string(),
                cell,
                ground: f
                    .attributes
                    .get("groundM2")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(12_000.),
            });
        }
    }
    for commissioned in &state.regional.as_ref().unwrap().city.works {
        let (work, cell) = (commissioned.family, commissioned.cell);
        urban.sponsors.push(Site {
            name: work.label().into(),
            source: work.key().into(),
            cell: cell as usize,
            ground: work.city().ground,
        });
    }
    let fields = &mut urban.fields;
    fields.civic = vec![0.; mesh.len()];
    fields.sponsor = vec![None; mesh.len()];
    let slope = state.field().shared().scalar(Scalar::Slope);
    for (index, s) in urban.sponsors.iter().enumerate() {
        let claim = fields.claims[s.cell];
        if !fields.inside[s.cell] {
            continue;
        }
        let demand = (claim.home + claim.work + claim.investment).max(0.);
        let constituency = fields
            .program
            .get(s.cell)
            .and_then(|&i| urban.programs.get(i))
            .map_or(0., |p| {
                let demand = p.demands_at(position(mesh, s.cell));
                s.ground.sqrt() * (demand.civic + demand.commons)
            });
        let reach = constituency
            + (s.ground.sqrt() + mesh.spacing())
                * (1. + demand.sqrt())
                * template
                    .affinity(
                        Activity::Institution,
                        position(mesh, s.cell),
                        template.quarter(),
                    )
                    .max(0.25)
                    .sqrt();
        let mut cost = working(state.field());
        for c in 0..mesh.len() {
            cost.set(c, f64::INFINITY)?;
        }
        cost.set(s.cell, 0.)?;
        search(
            mesh,
            [s.cell],
            &mut cost,
            reach * 2.,
            |_, _| Ok(()),
            |a, b, e| {
                if fields.claims[b].reserved {
                    return Ok(f64::INFINITY);
                }
                Ok(mesh.edge_length(a, e)
                    * (1. + slope.get(b)?.max(0.) * 4. + fields.claims[b].farm)
                    / (1. + fields.access[b] * 0.65))
            },
        )?;
        for c in 0..mesh.len() {
            let value = (1. - cost.get(c)? / (reach * 2.)).max(0.);
            if value > fields.civic[c] {
                fields.civic[c] = value;
                fields.sponsor[c] = Some(index);
            }
        }
    }
    if urban.parks.is_empty() {
        urban.parks = commons(state, urban)?;
    }
    Ok(())
}

fn commons(state: &State, u: &Urban) -> io::Result<Vec<super::Element>> {
    let mesh = state.field().mesh();
    let points: Vec<_> = (0..mesh.len())
        .map(|c| super::geometry::pos(position(mesh, c)))
        .collect();
    let mut wooded = vec![false; mesh.len()];
    for forest in super::values(state, "forest")? {
        for (inside, present) in wooded.iter_mut().zip(
            state
                .spatial
                .covers_points(&forest.geometry, &points)
                .map_err(io::Error::other)?,
        ) {
            *inside |= present;
        }
    }
    let template = policy(state)?;
    let town = city::captured_settlement(state)?;
    let city_radius = (state
        .spatial
        .area(state.scope.settled_outline())
        .map_err(io::Error::other)?
        / std::f64::consts::PI)
        .sqrt();
    let mut parks = Vec::new();
    for (index, p) in u.programs.iter().enumerate() {
        let civic = u
            .sponsors
            .iter()
            .any(|s| mesh.physical_distance(p.cell, s.cell) < p.reach);
        let stewardship =
            p.demands.commons + f64::from(civic) * 0.9 + f64::from(template.site.free_tenure) * 0.4;
        if stewardship == 0. && p.sites.is_empty() {
            continue;
        }
        let mut scores = vec![0.; mesh.len()];
        for c in mesh.cells_within(mesh.position(p.cell), p.reach) {
            let x = u.fields.claims[c];
            if u.fields.program[c] != index
                || !u.fields.inside[c]
                || x.reserved
                || u.fields.stencil[c] < 0.65
                || u.fields.civic[c] > 0.35
            {
                continue;
            }
            let distance = mesh.physical_distance(p.cell, c) / p.reach;
            let care = stewardship + (p.demands_at(position(mesh, c)).commons - p.demands.commons);
            scores[c] = care
                * (0.1 + f64::from(wooded[c]) + x.farm.sqrt())
                * (0.3 + x.investment)
                * (1. - distance * 0.55)
                / (1. + x.built * 4.);
        }
        let Some((site, &bid)) = scores.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)) else {
            continue;
        };
        if bid <= 0.15 {
            continue;
        }
        let radius = (template.quarter() + mesh.spacing()) * (1. + stewardship.sqrt());
        for (c, score) in scores.iter_mut().enumerate() {
            *score = (*score / bid).sqrt()
                * (1. - (mesh.physical_distance(c, site) / radius).powi(2)).max(0.);
        }
        if let Some(g) = super::landscape::contour(state, &scores, 0.36)? {
            for part in atlas_map::regions::parts(&g) {
                let mut park = super::Element::new(
                    part,
                    "park",
                    if wooded[site] {
                        "Woodland common"
                    } else {
                        "Assembly green"
                    },
                );
                park.attributes.insert(
                    "stewardship".into(),
                    if civic {
                        "Civic endowment"
                    } else {
                        "District commons"
                    }
                    .into(),
                );
                park.attributes.insert(
                    "districtAnchor".into(),
                    serde_json::json!(position(mesh, p.cell)),
                );
                let [x, y] = position(mesh, site);
                let at = template.site.centre;
                if let Some(era) = town.as_ref().and_then(|t| {
                    city::occupation_era(t, city_radius, (at[0] - x).hypot(at[1] - y), 100.)
                }) {
                    park.attributes
                        .insert("establishedInEra".into(), era.into());
                }
                let claim = u.fields.claims[site];
                let disused = claim.ruin > claim.built && !civic;
                park.attributes.insert(
                    "condition".into(),
                    if disused { "overgrown" } else { "maintained" }.into(),
                );
                if disused {
                    park.name = "Overgrown common".into();
                }
                parks.push(park);
            }
        }
    }
    Ok(parks)
}
pub(super) fn defense(
    state: &State,
    urban: &mut Urban,
    frame: &Geometry,
    walls: Vec<Feature>,
) -> io::Result<()> {
    urban.inherited_defenses.clear();
    for f in walls {
        let Some(f) = within_frame(state.spatial.as_ref(), f, frame)? else {
            continue;
        };
        urban.inherited_defenses.push(f.geometry.clone());
        if !urban.captured.iter().any(|old| old.id == f.id) {
            urban.captured.push(f);
        }
    }
    urban.defense = city::propose_walls(
        state,
        policy(state)?,
        state.regional.as_ref().unwrap().round,
    )?;
    let existing = state.regional.as_ref().unwrap().city.walls.len();
    let mesh = state.field().mesh();
    for (i, wall) in urban.defense.iter().enumerate().filter(|(_, w)| w.outgrown) {
        let source = format!("city-wall-{}", existing + i);
        let sites: Vec<_> = wall
            .inside
            .iter()
            .map(|&c| c as usize)
            .filter(|&c| {
                (0..3).any(|edge| mesh.neighbor(c, edge).is_some_and(|n| !wall.encloses(n)))
            })
            .map(|c| atlas_map::regions::point(super::geometry::pos(position(mesh, c))))
            .collect();
        if sites.is_empty() {
            continue;
        }
        let index = state.spatial.index(&sites).map_err(io::Error::other)?;
        for program in &mut urban.programs {
            use crate::town::templates::district::Trope;
            let [x, y] = position(mesh, program.cell);
            let Some((nearest, distance)) = index
                .nearest_with_distance(atlas_map::Position::xy(x, y))
                .map_err(io::Error::other)?
            else {
                continue;
            };
            let influence = (1. - distance / program.reach).max(0.);
            if program.traits.contains(&Trope::Wall)
                || crate::noise::hash_unit(i as i32, x, y) >= influence
            {
                continue;
            }
            let Geometry::Point { coordinates } = &sites[nearest] else {
                continue;
            };
            program.traits.push(Trope::Wall);
            program.sites.push((Trope::Wall, xy(*coordinates)));
            program.evidence["traitSites"] = serde_json::json!(program.sites);
            if let Some(facts) = program.evidence["sources"].as_array_mut() {
                facts.push(serde_json::json!([Trope::Wall, source]));
            }
        }
    }
    Ok(())
}
