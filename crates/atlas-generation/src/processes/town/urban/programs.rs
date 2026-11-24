//! Districts compete for sites before investment, movement and construction resolve their geography.
use super::{
    fields::{neighborhood, policy, position},
    geometry::{pos, xy},
    partition::target,
    Urban,
};
use crate::{
    atlas::state::State,
    features::Feature,
    field::{people::work::habitable, refinement::courses::cell_at},
    human::{
        catalogue::{LayerId, FULL_STANDING_PER_BUILT_KM2},
        HumanField,
    },
    town::{catalogue::Activity, templates::Selection},
};
use serde::{Deserialize, Serialize};
use std::io;

pub(super) use crate::town::templates::district::Role;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Program {
    pub role: Role,
    pub cell: usize,
    pub name: String,
    pub reach: f64,
    pub strength: f64,
}
pub(super) fn at(urban: &Urban, cell: usize) -> Option<&Program> {
    urban
        .fields
        .program
        .get(cell)
        .and_then(|&index| urban.programs.get(index as usize))
}
#[derive(Clone)]
struct Offer {
    role: Role,
    cell: usize,
    quality: f64,
    name: Option<String>,
}

pub(super) fn compete(state: &State, u: &mut Urban, sponsors: Vec<Feature>) -> io::Result<()> {
    let mesh = state.field().mesh();
    let template = policy(state)?;
    let n = mesh.len();
    if u.fields.stencil.is_empty() {
        let positions: Vec<_> = (0..n).map(|c| pos(position(mesh, c))).collect();
        // owner-direction(2026-11-24): retain the City stencil as a very strong interior development prior with supported outskirts
        let membership: Vec<_> = state
            .spatial
            .covers_points(state.scope.settled_outline(), &positions)
            .map_err(io::Error::other)?
            .into_iter()
            .map(|v| f64::from(v as u8))
            .collect();
        let reach = (template.quarter() * 1.5).max(mesh.spacing() * 2.);
        u.fields.stencil = (0..n)
            .map(|c| neighborhood(mesh, [&membership], c, reach)[0])
            .collect();
    }
    if u.programs.is_empty() {
        let census = crate::atlas::regional::city::settlement(state)?
            .and_then(|s| s.people)
            .unwrap_or(0.);
        let count = target(census);
        let area = state
            .spatial
            .area(state.scope.settled_outline())
            .map_err(io::Error::other)?;
        let reach = (area / count as f64).sqrt().max(mesh.spacing());
        let offers = offers(state, u, template, sponsors, reach)?;
        // A supported use can repeat where it has a separate constituency and site.
        for _ in 0..count {
            let mut best = None;
            let mut high = 0.;
            for offer in &offers {
                let mut peers = 0;
                let mut near: f64 = 2.;
                for program in &u.programs {
                    if program.role == offer.role {
                        peers += 1;
                    }
                    near = near.min(mesh.physical_distance(program.cell, offer.cell) / reach);
                }
                let score = offer.quality * near.min(1.6).powi(2) / (1. + peers as f64 * 0.8);
                if score > high {
                    best = Some(offer);
                    high = score;
                }
            }
            let Some(best) = best else { break };
            u.programs.push(Program {
                role: best.role,
                cell: best.cell,
                name: best.name.clone().unwrap_or_else(|| best.role.name().into()),
                reach,
                strength: 1.,
            });
        }
    }
    for program in &mut u.programs {
        if let Some(claim) = u.fields.claims.get(program.cell) {
            program.strength =
                0.85 + 0.28 * (claim.home + claim.work + u.fields.access[program.cell]).tanh();
        }
    }
    let seeds: Vec<_> = u.programs.iter().map(|p| p.cell).collect();
    let f = state.field();
    let mut cost = Vec::with_capacity(n);
    for c in 0..n {
        let access = u.fields.access.get(c).copied().unwrap_or(0.);
        cost.push(if habitable(f, c)? {
            (1. + f
                .shared()
                .scalar(crate::field::shared::Scalar::Slope)
                .get(c)?
                .max(0.)
                * 4.)
                / (1. + 0.3 * access)
        } else {
            12.
        });
    }
    // This is provisional influence on the shared lattice. The final partition uses
    // the resolved roads, works and geographic boundaries of the city.
    u.fields.program = crate::town::city::districts(
        &seeds,
        n,
        |a, b| mesh.physical_distance(a, b) * (cost[a] + cost[b]) * 0.5,
        |c| [0, 1, 2].map(|e| mesh.neighbor(c, e)),
    );
    Ok(())
}
fn offers(
    state: &State,
    u: &Urban,
    template: &Selection,
    sponsors: Vec<Feature>,
    reach: f64,
) -> io::Result<Vec<Offer>> {
    let f = state.field();
    let mesh = f.mesh();
    let built = f.people().view(HumanField::Layer(LayerId::BuiltUp));
    let standing = f.people().view(HumanField::Layer(LayerId::Standing));
    let ways = f.people().view(HumanField::KeptLine);
    let mut choices = Vec::new();
    for c in 0..mesh.len() {
        if u.fields.stencil[c] < 0.65 || !habitable(f, c)? {
            continue;
        }
        let p = position(mesh, c);
        let people = f.people().people(c)?;
        let stock = built.get(c)?;
        if people <= 0. || stock <= 0. {
            continue;
        }
        let condition = standing.get(c)? / FULL_STANDING_PER_BUILT_KM2 / (0.015 + stock);
        let crowd = people / (500. + 6500. * stock);
        let trade = f.goods_turnover(c)?;
        for (role, need) in [
            (Role::Tenements, crowd / (0.45 + condition)),
            (Role::Estates, condition / (0.25 + crowd)),
            (Role::Workshops, stock.sqrt() * (0.5 + condition) * 2.),
            (Role::Exchange, (trade + ways.get(c)?.sqrt()).sqrt()),
        ] {
            if need <= 0. {
                continue;
            }
            let affinity = template.district_affinity(role, p);
            let quality = need.min(2.5) * affinity.sqrt() * u.fields.stencil[c];
            choices.push(Offer {
                role,
                cell: c,
                quality,
                name: None,
            });
        }
    }
    let mut anchored = |role, at, name: String| {
        if let Some(c) = cell_at(mesh, at).filter(|&c| u.fields.stencil[c] > 0.5) {
            choices.push(Offer {
                role,
                cell: c,
                quality: 5.,
                name: Some(name),
            });
        }
    };
    for s in sponsors {
        let p = state
            .spatial
            .interior_position(&s.geometry)
            .map_err(io::Error::other)?;
        anchored(Role::Civic, xy(p), format!("{} precinct", s.name));
    }
    for &(work, c) in &state.regional.as_ref().unwrap().city.works {
        anchored(
            Role::Civic,
            position(mesh, c as usize),
            format!("{} precinct", work.label()),
        );
    }
    if let Some(p) = template
        .enclosed_seat()
        .and_then(|a| template.site.point(a))
    {
        anchored(Role::Fortified, p, "Citadel ward".into());
    }
    use crate::town::{catalogue::PlaceRules, templates::FounderUse};
    for founder in template.kernel() {
        let Some(at) = template.site.founding_point(founder.anchor, reach) else {
            continue;
        };
        if let FounderUse::Place(kind) = founder.use_ {
            let place = kind.definition();
            if matches!(place.activity, Activity::Trade | Activity::Production) {
                let role = if place.activity == Activity::Trade {
                    Role::Exchange
                } else {
                    Role::Workshops
                };
                if let Some(c) = cell_at(mesh, at) {
                    if f.people().people(c)? > 0. && built.get(c)? > 0. {
                        anchored(role, at, format!("{} quarter", place.label));
                    }
                }
            }
        }
    }
    Ok(choices)
}
