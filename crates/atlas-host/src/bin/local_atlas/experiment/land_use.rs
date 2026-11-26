//! Inspect City land use on a retained trial without running generation.
use atlas_generation::features::Feature;
use atlas_gis::{
    geometry::NativeGeos,
    map_store::codec,
    sql::{column, Database},
};
use atlas_map::spatial::{Overlay, SpatialKernel};
use serde_json::json;
use std::{collections::BTreeMap, io, path::Path};

pub(super) fn inspect(folder: &Path, near: f64) -> io::Result<()> {
    if !near.is_finite() || near <= 0. {
        return Err(io::Error::other(
            "Road distance must be positive and finite",
        ));
    }
    let path = folder.join("records.sqlite").canonicalize()?;
    let db = Database::open(path)?;
    let read = |kind: &str| -> io::Result<Vec<Feature>> {
        db.query(
            "SELECT data FROM working_features WHERE kind=?",
            &[kind.into()],
        )?
        .iter()
        .map(|row| codec::decode(column(row, "data")?.bytes()?))
        .collect()
    };
    let k = NativeGeos::new(1e-6).map_err(io::Error::other)?;
    let roads: Vec<_> = read("thoroughfare")?
        .into_iter()
        .map(|f| f.geometry)
        .collect();
    let near_roads = if roads.is_empty() {
        None
    } else {
        k.union_all(&roads)
            .map_err(io::Error::other)?
            .map(|g| k.buffer(&g, near))
            .transpose()
            .map_err(io::Error::other)?
            .flatten()
    };
    let tracts = read("urbanGround")?;
    let districts = read("district")?;
    if districts.is_empty() || tracts.is_empty() {
        return Err(io::Error::other(
            "Expected a completed City trial with districts and urban ground",
        ));
    }
    let shapes: Vec<_> = tracts.iter().map(|t| t.geometry.clone()).collect();
    let mut results = Vec::new();
    for district in districts {
        let mut primary = BTreeMap::<String, [f64; 2]>::new();
        let mut secondary = BTreeMap::<String, [f64; 2]>::new();
        let near_district = near_roads
            .as_ref()
            .map(|g| k.overlay(g, &district.geometry, Overlay::Intersection))
            .transpose()
            .map_err(io::Error::other)?
            .flatten();
        let areas = k
            .intersection_areas(&district.geometry, &shapes)
            .map_err(io::Error::other)?;
        let nearby = near_district
            .as_ref()
            .map(|g| k.intersection_areas(g, &shapes))
            .transpose()
            .map_err(io::Error::other)?;
        for (j, total) in areas.into_iter().enumerate() {
            if total <= 0. {
                continue;
            }
            for (key, totals) in [
                ("groundUse", &mut primary),
                ("secondaryUse", &mut secondary),
            ] {
                if let Some(label) = tracts[j].attributes.get(key).and_then(|v| v.as_str()) {
                    let entry = totals.entry(label.to_owned()).or_default();
                    entry[0] += total / 1e6;
                    entry[1] += nearby.as_ref().map_or(0., |areas| areas[j]) / 1e6;
                }
            }
        }
        results.push(json!({"district":district.name,"primary":primary,"secondary":secondary}));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"roadDistanceMetres":near,"columns":["areaKm2","nearRoadKm2"],"districts":results})
        )?
    );
    Ok(())
}
