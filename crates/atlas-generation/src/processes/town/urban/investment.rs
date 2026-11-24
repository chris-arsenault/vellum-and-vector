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
    for &(work, cell) in &state.regional.as_ref().unwrap().city.works {
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
        let constituency = urban
            .programs
            .iter()
            .filter(|p| p.role == super::programs::Role::Civic)
            .map(|p| (p, mesh.physical_distance(s.cell, p.cell)))
            .filter(|(p, d)| *d < p.reach * 0.5)
            .map(|(p, d)| p.reach * (1. - 2. * d / p.reach) * 0.42)
            .fold(0., f64::max);
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
    Ok(())
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
    Ok(())
}
