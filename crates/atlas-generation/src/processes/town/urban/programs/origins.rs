use super::{habitable, Program, State, Trope, CATALOG};
use crate::{field::shared::Scalar, noise::hash_unit};
use atlas_map::{Geometry, Position};
use serde_json::{json, Value};
use std::io;

/// Record the origin of a trait that has one once its district has permanent ground.
/// This detail belongs to the district record. POIs and works have their own siting.
pub(in super::super) fn district_origins(
    state: &State,
    program: &Program,
    ground: &Geometry,
    positions: &[Position],
    culture: Option<&str>,
) -> io::Result<Vec<Value>> {
    let kinds = CATALOG
        .iter()
        .filter(|e| e.localized_origin && program.traits.contains(&e.id));
    if kinds.clone().next().is_none() {
        return Ok(Vec::new());
    }
    let inside = state
        .spatial
        .covers_points(ground, positions)
        .map_err(io::Error::other)?;
    let field = state.field();
    let wet = field.shared().scalar(Scalar::WetlandCover);
    let flood = field.shared().scalar(Scalar::FloodplainIntensity);
    let slope = field.shared().scalar(Scalar::Slope);
    let mut origins = Vec::new();
    for kind in kinds {
        let mut source = None;
        let mut at = None;
        for (id, point, key) in &program.origin_candidates {
            if *id == kind.id
                && state
                    .spatial
                    .covers_points(ground, &[super::pos(*point)])
                    .map_err(io::Error::other)?[0]
            {
                source = Some(key);
                at = Some(*point);
                break;
            }
        }
        if at.is_none() {
            let mut best = f64::INFINITY;
            for (c, _) in inside.iter().enumerate().filter(|(_, held)| **held) {
                if !habitable(field, c)? {
                    continue;
                }
                let [x, y, _] = positions[c].coordinates();
                let weight = match kind.id {
                    Trope::Spring => {
                        (0.1 + 3. * wet.get(c)? + flood.get(c)? / 1000.) / (1. + slope.get(c)?)
                    }
                    Trope::Resident => field.people().people(c)?.ln_1p(),
                    _ => unreachable!("unknown localized district origin"),
                };
                if weight <= 0. {
                    continue;
                }
                let score = -hash_unit(program.cell as i32 ^ kind.id as i32, x, y)
                    .max(f64::MIN_POSITIVE)
                    .ln()
                    / weight;
                if score < best {
                    best = score;
                    at = Some([x, y]);
                }
            }
        }
        let point = match at {
            Some(point) => point,
            None => super::super::geometry::xy(
                state
                    .spatial
                    .interior_position(ground)
                    .map_err(io::Error::other)?,
            ),
        };
        let mut origin = json!({"trait": kind.id, "at": point});
        if let Some(key) = source {
            origin["featureId"] = json!(key);
        }
        if kind.id == Trope::Resident {
            let occupation = match program.economic {
                Trope::Bazaar => "merchant",
                Trope::Artificer => "master artisan",
                Trope::Freight => "caravan master",
                Trope::Granary => "grain factor",
                Trope::Inn => "innkeeper",
                Trope::Scribe => "scholar",
                _ => unreachable!("A founded district has an economic role"),
            };
            let key = format!("district-trait-{}-Resident-resident", program.cell);
            let resident = state
                .naming
                .work(&state.scope, &key, occupation, point, culture)?
                .name;
            origin["resident"] = json!({"name": resident, "role": occupation});
        }
        origins.push(origin);
    }
    Ok(origins)
}
