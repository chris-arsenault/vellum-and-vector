use super::{
    geometry::{divide, ring, sample, xy},
    Element, Urban,
};
use crate::{
    atlas::state::State,
    features::Feature,
    spatial::{Overlay, Predicate},
    town::{
        geometry::{add, distance, dot, left, scale, sub, unit},
        settings::DEVELOPMENT_ROUNDS,
    },
};
use atlas_map::{
    regions::{boundary_lines, point, polygon},
    Geometry,
};
use std::io;

/// Open one wave of inherited blocks onto their fixed street edges. Both the local
/// cut and its junction with the continuing City road belong to movement.
pub(super) fn circulation(
    state: &State,
    urban: &mut Urban,
    frame: &Geometry,
    roads: &[Geometry],
) -> io::Result<()> {
    let kernel = state.spatial.as_ref();
    let road_index = kernel.index(roads).map_err(io::Error::other)?;
    let has_blocks = urban.captured.iter().any(|f| f.kind == "cityBlock");
    let blocks: Vec<_> = urban
        .captured
        .iter()
        .filter(|f| {
            if has_blocks {
                f.kind == "cityBlock"
            } else {
                f.kind == "urbanGround"
                    && f.attributes.get("groundUse").and_then(|v| v.as_str())
                        != Some("Common ground")
            }
        })
        .collect();
    let start = blocks.len() * urban.street_round / DEVELOPMENT_ROUNDS;
    let end = blocks.len() * (urban.street_round + 1) / DEVELOPMENT_ROUNDS;
    for (i, block) in blocks.iter().enumerate().take(end).skip(start) {
        let at = kernel
            .interior_position(&block.geometry)
            .map_err(io::Error::other)?;
        let policy = state
            .regional
            .as_ref()
            .and_then(|r| r.city.template.as_ref());
        let aligned = policy
            .and_then(|p| p.align(xy(at)))
            .map(|v| v[1].atan2(v[0]));
        let density = number(block, "density", 1200.);
        let angle = aligned.unwrap_or_else(|| number(block, "orientation", 0.));
        let spacing = 50. + 32. / (1. + density / 1600.);
        let pieces = if has_blocks {
            vec![block.geometry.clone()]
        } else {
            street_ground(kernel, block, frame, roads, &urban.captured)?
        };
        for piece in pieces {
            let division = divide(kernel, &piece, spacing * spacing, angle, i as u64 + 317)?;
            for way in division.ways {
                for mut trace in boundary_lines(&way) {
                    if trace.len() < 2 {
                        continue;
                    }
                    snap_lane(kernel, road_index.as_ref(), roads, frame, &mut trace)?;
                    urban.routes.push(Element::way(
                        Geometry::LineString { coordinates: trace },
                        "thoroughfare",
                        "Local lane",
                        3.5,
                    ));
                }
            }
            for shape in division.faces {
                if !has_blocks {
                    let mut local = Element::new(shape.clone(), "cityBlock", "Street block");
                    local.attributes = block.attributes.clone();
                    local
                        .attributes
                        .insert("parentGround".into(), block.id.to_string().into());
                    urban.blocks.push(local);
                }
                let mut lot = Element::new(shape, "yard", "Frontage");
                lot.attributes = block.attributes.clone();
                lot.attributes.insert(
                    if has_blocks {
                        "parentBlock"
                    } else {
                        "parentGround"
                    }
                    .into(),
                    block.id.to_string().into(),
                );
                urban.frontages.push(lot);
            }
        }
    }
    urban.street_round += 1;
    Ok(())
}
fn snap_lane(
    kernel: &dyn crate::spatial::SpatialKernel,
    road_index: &dyn atlas_map::spatial::SpatialIndex,
    roads: &[Geometry],
    frame: &Geometry,
    trace: &mut [atlas_map::Position],
) -> io::Result<()> {
    for at in [0, trace.len() - 1] {
        let p = trace[at];
        let Some(j) = road_index.nearest(p).map_err(io::Error::other)? else {
            continue;
        };
        let [_, on] = kernel
            .nearest_points(&point(p), &roads[j])
            .map_err(io::Error::other)?;
        if distance(xy(p), xy(on)) <= 6.
            && kernel
                .covers_points(frame, &[on])
                .map_err(io::Error::other)?[0]
        {
            trace[at] = on;
        }
    }
    Ok(())
}

fn street_ground(
    kernel: &dyn crate::spatial::SpatialKernel,
    block: &Feature,
    frame: &Geometry,
    roads: &[Geometry],
    captured: &[Feature],
) -> io::Result<Vec<Geometry>> {
    let frame_land = kernel
        .overlay(&block.geometry, frame, Overlay::Intersection)
        .map_err(io::Error::other)?;
    let Some(mut land) = frame_land else {
        return Ok(Vec::new());
    };
    for r in captured
        .iter()
        .filter(|r| matches!(r.kind.as_str(), "square" | "park" | "cityWall"))
    {
        let reserve = if r.kind == "cityWall" {
            kernel.buffer(&r.geometry, 3.).map_err(io::Error::other)?
        } else {
            Some(r.geometry.clone())
        };
        if let Some(g) = reserve {
            land = kernel
                .overlay(&land, &g, Overlay::Difference)
                .map_err(io::Error::other)?
                .unwrap_or(Geometry::GeometryCollection { geometries: vec![] });
        }
    }
    super::geometry::faces(kernel, &land, roads)
}

fn number(f: &Feature, key: &str, or: f64) -> f64 {
    f.attributes.get(key).and_then(|v| v.as_f64()).unwrap_or(or)
}

#[derive(Clone, Copy)]
enum Premises {
    House,
    Shop,
    Workshop,
    Hall,
}
impl Premises {
    fn layout(self) -> (&'static str, &'static str, f64) {
        match self {
            Self::House => ("House", "residential", 7.5),
            Self::Shop => ("Shop", "economic", 10.),
            Self::Workshop => ("Workshop", "economic", 16.),
            Self::Hall => ("Hall", "civic", 20.),
        }
    }
}

fn premises_mix(usage: &str, mix: Option<&serde_json::Value>) -> [f64; 4] {
    if matches!(usage, "Civic precinct" | "civic") {
        return [0., 0., 0., 1.];
    }
    if let Some(mix) = mix {
        let weights =
            ["housing", "trade", "workshops"].map(|key| mix[key].as_f64().unwrap_or(0.).max(0.));
        let total = weights.iter().sum::<f64>();
        if total > 0. {
            let [h, t, w] = weights.map(|v| v / total);
            return [h, t, w, 0.];
        }
    }
    match usage {
        "business" | "Trade frontage" => [0., 1., 0., 0.],
        "industry" | "Working ground" => [0., 0., 1., 0.],
        _ => [1., 0., 0., 0.],
    }
}

fn premise(weights: [f64; 4], roll: f64) -> Premises {
    let [home, shop, work, _] = weights;
    if roll < home {
        Premises::House
    } else if roll < home + shop {
        Premises::Shop
    } else if weights[3] == 0. || roll < home + shop + work {
        Premises::Workshop
    } else {
        Premises::Hall
    }
}

/// Frontages face the nearest street. Each house takes a rectangular site with a
/// rear yard, leaving the remaining land available to the other street frontages.
pub(super) fn premises(
    state: &State,
    urban: &mut Urban,
    frame: &Geometry,
    reserved: &[Feature],
) -> io::Result<()> {
    let kernel = state.spatial.as_ref();
    let regional_routes = super::ground_routes(state)?;
    let roads: Vec<_> = urban
        .captured
        .iter()
        .filter(|f| f.kind == "thoroughfare")
        .chain(&regional_routes)
        .map(|f| (&f.geometry, &f.attributes, f.kind.as_str()))
        .chain(
            urban
                .routes
                .iter()
                .map(|r| (&r.geometry, &r.attributes, r.kind.as_str())),
        )
        .map(|(line, a, kind)| {
            (
                line,
                a.get("widths")
                    .and_then(|v| v.get(0))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(match kind {
                        "road" => 8.,
                        "trail" => 2.5,
                        _ => 7.,
                    }),
            )
        })
        .collect();
    let mut corridors = Vec::new();
    for (line, width) in &roads {
        if let Some(strip) = kernel
            .buffer(line, width / 2. + 0.8)
            .map_err(io::Error::other)?
        {
            corridors.push(strip);
        }
    }
    let corridor_index = kernel.index(&corridors).map_err(io::Error::other)?;
    let street_lines: Vec<_> = roads.iter().map(|(g, _)| (*g).clone()).collect();
    let street_index = kernel.index(&street_lines).map_err(io::Error::other)?;
    for (i, lot) in std::mem::take(&mut urban.frontages).into_iter().enumerate() {
        let Some(land) = super::buildable(kernel, lot.geometry.clone(), reserved)? else {
            continue;
        };
        let Some(inset) = kernel
            .buffer(&land, -2.)
            .map_err(io::Error::other)?
            .and_then(polygon)
        else {
            continue;
        };
        let usage = lot
            .attributes
            .get("groundUse")
            .or_else(|| lot.attributes.get("use"))
            .and_then(|v| v.as_str())
            .unwrap_or("residential");
        let density = lot
            .attributes
            .get("density")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.);
        let built = lot
            .attributes
            .get("builtShare")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.);
        let seed = (urban.street_round * 7919 + i * 157) as u64;
        let weights = premises_mix(usage, lot.attributes.get("useMix"));
        let frontage_width: f64 = [
            Premises::House,
            Premises::Shop,
            Premises::Workshop,
            Premises::Hall,
        ]
        .into_iter()
        .zip(weights)
        .map(|(p, w)| p.layout().2 * w)
        .sum();
        let coverage = (0.12 + 0.48 * density / (density + 1200.) + 0.4 * built / (built + 0.09))
            .clamp(0., 1.);
        for piece in atlas_map::regions::parts(&inset) {
            let mut available =
                off_street_land(kernel, &piece, corridor_index.as_ref(), &corridors)?;
            let centre = xy(kernel.interior_position(&piece).map_err(io::Error::other)?);
            let Some(edges) = boundary_lines(&piece).into_iter().next() else {
                continue;
            };
            let mut frontages: Vec<_> = edges.windows(2).enumerate().collect();
            let length = |ends: &[atlas_map::Position]| distance(xy(ends[0]), xy(ends[1]));
            // hpc-exempt: order the sides of this parcel for frontage allocation.
            frontages.sort_by(|(_, a), (_, b)| length(b).total_cmp(&length(a)));
            for (edge, ends) in frontages {
                let (a, b) = (xy(ends[0]), xy(ends[1]));
                let length = distance(a, b);
                let direction = unit(sub(b, a));
                let normal_distance = dot(sub(centre, a), left(direction)).abs();
                let count = (length / frontage_width).floor() as usize;
                if normal_distance < 6. || count == 0 {
                    continue;
                }
                for n in 0..count {
                    let key = seed + (edge * 457 + n) as u64;
                    if sample(key) > coverage {
                        continue;
                    }
                    let (name, function, width) = premise(weights, sample(key ^ 0x5a6d)).layout();
                    let pitch = length / count as f64;
                    let frontage = add(a, scale(direction, pitch * (n as f64 + 0.5)));
                    let inward = scale(
                        left(direction),
                        dot(sub(centre, frontage), left(direction)).signum(),
                    );
                    let Some((r, distance)) = street_index
                        .nearest_with_distance(super::geometry::pos(frontage))
                        .map_err(io::Error::other)?
                    else {
                        continue;
                    };
                    let road_width = roads[r].1;
                    if distance > road_width / 2. + width {
                        continue;
                    }
                    let setback = (road_width / 2. + 1.3 - distance).max(0.8) + sample(key ^ 53);
                    let front = add(frontage, scale(inward, setback));
                    let depth =
                        (width * (0.85 + 0.55 * sample(key ^ 117))).min(normal_distance * 0.85);
                    let rectangle = |w, d| {
                        let corners =
                            crate::town::geometry::rectangle(front, direction, inward, w, d);
                        ring(&corners[..4])
                    };
                    let shape = rectangle(pitch * (0.68 + 0.23 * sample(key ^ 19)), depth);
                    let Some(ground) = &available else { break };
                    let Some(lot_shape) = fit_plot(state, frame, ground, &shape, || {
                        rectangle(pitch * 0.98, depth + width * 0.55)
                    })?
                    else {
                        continue;
                    };
                    available = kernel
                        .overlay(ground, &lot_shape, Overlay::Difference)
                        .map_err(io::Error::other)?
                        .and_then(polygon);
                    let mut yard = Element::new(lot_shape, "yard", "Premises");
                    yard.attributes = lot.attributes.clone();
                    urban.plots.push(yard);
                    let mut building = Element::new(shape, "building", name);
                    building.attributes = lot.attributes.clone();
                    // The secondary land use belongs to the surrounding frontage.
                    building.attributes.remove("secondaryUse");
                    building
                        .attributes
                        .insert("buildingFunction".into(), function.into());
                    building
                        .attributes
                        .insert("entrance".into(), serde_json::json!(front));
                    urban.buildings.push(building);
                }
            }
        }
    }
    Ok(())
}

fn fit_plot(
    state: &State,
    frame: &Geometry,
    ground: &Geometry,
    shape: &Geometry,
    plot: impl FnOnce() -> Geometry,
) -> io::Result<Option<Geometry>> {
    let kernel = state.spatial.as_ref();
    if !kernel
        .relation(ground, shape, Predicate::Covers)
        .map_err(io::Error::other)?
    {
        return Ok(None);
    }
    let plot = plot();
    let Some(lot_shape) = kernel
        .overlay(&plot, ground, Overlay::Intersection)
        .map_err(io::Error::other)?
        .and_then(polygon)
    else {
        return Ok(None);
    };
    if !habitable_premise(state, frame, shape)? {
        return Ok(None);
    }
    Ok(Some(lot_shape))
}

fn habitable_premise(state: &State, frame: &Geometry, shape: &Geometry) -> io::Result<bool> {
    let kernel = state.spatial.as_ref();
    let centre = kernel.interior_position(shape).map_err(io::Error::other)?;
    if !kernel
        .covers_points(frame, &[centre])
        .map_err(io::Error::other)?[0]
    {
        return Ok(false);
    }
    match crate::field::refinement::courses::cell_at(state.field().mesh(), xy(centre)) {
        Some(cell) => crate::field::people::work::habitable(state.field(), cell),
        None => Ok(true),
    }
}

fn off_street_land(
    kernel: &dyn crate::spatial::SpatialKernel,
    piece: &Geometry,
    corridor_index: &dyn atlas_map::spatial::SpatialIndex,
    corridors: &[Geometry],
) -> io::Result<Option<Geometry>> {
    let mut available = Some(piece.clone());
    for r in corridor_index
        .query(kernel.bounds(piece).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
    {
        if let Some(ground) = available.take() {
            available = kernel
                .overlay(&ground, &corridors[r], Overlay::Difference)
                .map_err(io::Error::other)?
                .and_then(polygon);
        }
    }
    Ok(available)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn premises_use_the_local_mix_and_recognize_city_tracts() {
        let mix = serde_json::json!({"housing":6,"trade":3,"workshops":1});
        let weights = premises_mix("Crowded housing", Some(&mix));
        assert_eq!(
            [0.1, 0.75, 0.95].map(|v| premise(weights, v).layout().0),
            ["House", "Shop", "Workshop"]
        );
        for (label, expected) in [
            ("Trade frontage", "Shop"),
            ("Working ground", "Workshop"),
            ("Civic precinct", "Hall"),
        ] {
            assert_eq!(premise(premises_mix(label, None), 0.3).layout().0, expected);
        }
        assert_eq!(
            premise(premises_mix("Civic precinct", Some(&mix)), 0.45)
                .layout()
                .0,
            "Hall"
        );
    }
}
