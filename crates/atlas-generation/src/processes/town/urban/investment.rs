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
    hpc::{Direction, KeyedHeap},
    metric::search::search,
    town::catalogue::Activity,
};
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::io;

pub(super) const PARCEL_WEIGHT: crate::parameters::NumericParameter =
    crate::parameters::NumericParameter {
        name: "commonsParcelPreference",
        unit: "weight",
        default: 2.,
        minimum: Some(0.),
        maximum: None,
        strategy: Some("civic-precincts"),
        map_types: &[crate::processes::strategies::MapType::City],
    };

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Site {
    pub name: String,
    pub source: String,
    pub cell: usize,
    pub ground: f64,
    #[serde(default)]
    pub work: Option<(crate::town::major_works::WorkFamily, f64)>,
    #[serde(default)]
    pub grounds: Option<Geometry>,
}
fn grounds(at: [f64; 2], design: &crate::town::major_works::WorkDesign) -> Geometry {
    let [x, y] = at;
    let (sin, cos) = design.bearing.sin_cos();
    super::geometry::ring(
        &design
            .reserve
            .iter()
            .map(|[a, b]| [x + a * cos - b * sin, y + a * sin + b * cos])
            .collect::<Vec<_>>(),
    )
}
pub(super) fn civic(
    state: &State,
    urban: &mut Urban,
    frame: &Geometry,
    institutions: Vec<Feature>,
    parcel_weight: f64,
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
            let family = f
                .attributes
                .get("majorWorkFamily")
                .and_then(|v| v.as_str())
                .and_then(crate::town::major_works::WorkFamily::from_key);
            let design = f
                .attributes
                .get("workDesign")
                .map(|v| serde_json::from_value::<crate::town::major_works::WorkDesign>(v.clone()))
                .transpose()
                .map_err(io::Error::other)?;
            urban.sponsors.push(Site {
                name: f.name,
                source: f.id.to_string(),
                work: family.map(|w| (w, design.as_ref().map_or(0., |d| d.bearing))),
                grounds: design.as_ref().map(|d| grounds(xy(at), d)),
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
            work: Some((work, commissioned.design.bearing)),
            grounds: Some(grounds(position(mesh, cell as usize), &commissioned.design)),
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
            .map_or(0., |_| {
                let demand = claim.demands;
                s.ground.sqrt() * (demand.civic + demand.commons)
            });
        let institutional_reach = constituency
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
        let (reach, transverse, bearing) =
            s.work
                .map_or((institutional_reach, 1., 0.), |(work, bearing)| {
                    let (length, breadth) = work.influence();
                    (s.ground.sqrt() * length, length / breadth, bearing)
                });
        let axis = [bearing.cos(), bearing.sin()];
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
                let [dx, dy] = crate::town::geometry::unit(crate::town::geometry::sub(
                    mesh.position(b),
                    mesh.position(a),
                ));
                let across = (dx * axis[1] - dy * axis[0]).abs();
                Ok(mesh.edge_length(a, e)
                    * (1. + (transverse - 1.) * across)
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
        urban.parks = commons(state, urban, parcel_weight)?;
    }
    Ok(())
}

fn commons(state: &State, u: &Urban, parcel_weight: f64) -> io::Result<Vec<super::Element>> {
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
    let trees = state.field().shared().scalar(Scalar::TreeCover);
    let elevation = state
        .field()
        .ground()
        .view(crate::rock::ground::GroundField::Elevation);
    for (index, p) in u.programs.iter().enumerate() {
        let civic = u
            .sponsors
            .iter()
            .any(|s| mesh.physical_distance(p.cell, s.cell) < p.reach);
        let stewardship =
            p.demands.commons + f64::from(civic) * 0.9 + f64::from(template.site.free_tenure) * 0.4;
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
            let care = stewardship + (x.demands.commons - p.demands.commons);
            let [xpos, ypos] = position(mesh, c);
            // Variation in unrecorded field parcels matters most on uniform ground.
            let fallow = crate::noise::unit_noise(xpos, ypos, 4829, template.quarter(), 2);
            scores[c] = care
                * (0.1 + f64::from(wooded[c]) + trees.get(c)?.max(0.).sqrt() + x.farm.sqrt())
                * (0.3 + x.investment)
                * (0.55 + fallow)
                / (1. + x.built * 4. + u.fields.access[c]);
        }
        let Some((site, &bid)) = scores.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)) else {
            continue;
        };
        if bid <= 0.15 {
            continue;
        }
        // The endowment buys adjoining land. Favor the affordable field or terrace
        // at the boundary of the common, wherever that boundary currently lies.
        let extent = (template.quarter() + mesh.spacing()) * (1. + stewardship.sqrt());
        let mut budget = 1.6 * extent.powi(2);
        let mut footprint = vec![0.; mesh.len()];
        let mut frontier = KeyedHeap::new([Direction::Descending], Direction::Ascending);
        let height = elevation.get(site)?;
        scores[site] = 0.;
        let mut offer = |cell: usize| -> io::Result<Option<f64>> {
            let local = std::mem::take(&mut scores[cell]);
            if local <= 0. {
                return Ok(None);
            }
            let rise = crate::scale::MapScale::metres(
                (elevation.get(cell)? - height).abs(),
                crate::scale::LengthUnit::Native,
            );
            let access = mesh.physical_distance(cell, site) / extent;
            let terrace = rise / (template.quarter() * 0.06);
            Ok(Some(
                (local / bid).powf(parcel_weight) / (1. + terrace + 0.25 * access * access),
            ))
        };
        frontier.push(site as u32, [1.]);
        while let Some((cell, [value])) = frontier.pop() {
            let cell = cell as usize;
            let price = mesh.area(cell) / value;
            if price > budget {
                break;
            }
            budget -= price;
            footprint[cell] = 1.;
            for neighbor in (0..3).filter_map(|edge| mesh.neighbor(cell, edge)) {
                if let Some(value) = offer(neighbor)? {
                    frontier.push(neighbor as u32, [value]);
                }
            }
        }
        if let Some(g) = super::landscape::contour(state, &footprint, 0.5)? {
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
    urban.defense = super::defenses::invest(state, urban)?;
    Ok(())
}
