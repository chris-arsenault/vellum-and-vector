use super::{uuid, Params};
use crate::map_store::{AttributeFilter, RegistryQuery, RegistryRequest, Scope};
use atlas_map::{Bounds, Id, MapRef};
use std::io;
/// The features a registry request reads, with their registry values as `v` and their
/// feature type's row key and path.
pub(super) fn scope(
    r: &MapRef,
    world: Id,
    request: &RegistryRequest,
) -> io::Result<(String, Params)> {
    let mut params = Params::default();
    params.bind(uuid(r.map_id));
    params.bind(uuid(r.revision));
    let mut predicate = "(f.map_id=$1 AND f.revision=$2)".to_owned();
    if matches!(request.scope, Scope::World) {
        let world = params.bind(uuid(world));
        predicate = format!("({predicate} OR (f.map_id<>$1 AND m.world_id={world} AND EXISTS(SELECT 1 FROM map.heads h WHERE h.map_id=f.map_id AND h.revision=f.revision)))");
    }
    if let Some(bounds) = request.bounds {
        bounds.validate_window().map_err(io::Error::other)?;
        let Bounds(w, s, e, n) = bounds;
        let args = [w, s, e, n]
            .into_iter()
            .map(|v| params.bind(v))
            .collect::<Vec<_>>()
            .join(",");
        let rectangle = format!("ST_MakeEnvelope({args},0)");
        predicate.push_str(&format!(
            " AND (ST_Intersects(f.geometry,{rectangle}) OR ST_Intersects(f.footprint,{rectangle}))"
        ));
    }
    Ok((
        format!(
            "WITH scoped AS (SELECT f.*,f.catalog->'values' AS v,t.layer AS type_layer,t.path AS type_path
             FROM map.features f JOIN map.revisions m USING(map_id,revision)
             JOIN map.layers l ON l.map_id=f.map_id AND l.revision=f.revision AND l.id=f.layer_id
             JOIN map.feature_types t ON t.map_id=f.map_id AND t.revision=f.revision AND t.layer=l.ordinal AND t.id=f.type_id
             WHERE {predicate})"
        ),
        params,
    ))
}
pub(super) fn filter(query: &RegistryQuery, params: &mut Params) -> io::Result<String> {
    let mut clauses = Vec::new();
    if query.named {
        clauses.push("coalesce(attributes->>'nameStatus','')<>'label'".into());
    }
    if query.protected_only {
        clauses.push("v->'protected'='true'::jsonb".into());
    }
    if !query.kind.is_empty() {
        clauses.push(format!("type_id={}", params.bind(query.kind.clone())));
    }
    if !query.search.is_empty() {
        clauses.push(format!(
            "strpos(lower(coalesce(name,'')||' '||array_to_string(type_path,' ')),lower({}))>0",
            params.bind(query.search.clone())
        ));
    }
    for (key, value) in [
        ("status", &query.status),
        ("state", &query.state),
        ("profile", &query.profile),
        ("space", &query.space),
    ] {
        if !value.is_empty() {
            clauses.push(format!(
                "v->>{}={}",
                params.bind(key.to_owned()),
                params.bind(value.clone())
            ));
        }
    }
    for item in &query.attributes {
        attribute(item, &mut clauses, params)?;
    }
    Ok(if clauses.is_empty() {
        "true".into()
    } else {
        clauses.join(" AND ")
    })
}
fn attribute(
    filter: &AttributeFilter,
    clauses: &mut Vec<String>,
    params: &mut Params,
) -> io::Result<()> {
    let key = params.bind(filter.key.clone());
    clauses.push(format!("v->>{key} IS NOT NULL"));
    if !filter.text.is_empty() {
        clauses.push(format!(
            "strpos(lower(v->>{key}),lower({}))>0",
            params.bind(filter.text.clone())
        ));
    }
    for (value, operator) in [(&filter.min, ">="), (&filter.max, "<=")] {
        if value.is_empty() {
            continue;
        }
        let value = if value.trim().is_empty() {
            0.0
        } else {
            value.parse::<f64>().map_err(io::Error::other)?
        };
        if !value.is_finite() {
            return Err(io::Error::other("Choose a finite registry filter"));
        }
        clauses.push(format!("CASE WHEN jsonb_typeof(v->{key})='number' THEN (v->>{key})::numeric{operator}{}::double precision ELSE false END",params.bind(value)));
    }
    Ok(())
}
