//! Placing a building by use (ADR 0016): it fronts the street of the empty plot it is placed
//! in, fitted to that plot, or the nearest street, standing turned to it at the use's
//! footprint on a plot of its own. A new plot records the street it fronts and keeps off
//! water, ways and other plots.
use super::{
    clearance::{covered, is_water, overlaps},
    family,
    frontage::{frontage, is_building, is_street, is_yard, street_of, Frontage, FRONTS},
    plan::Planner,
    town::{labelled, rectangle, text, town_attributes, xy, Settlement},
    Draft,
};
use crate::{
    regions::point,
    spatial::{Overlay, Predicate},
    town::{fitted, plot_size, setback, Side, Size, Use, VERGE},
    Geometry, MapFeature, MapRelation, Position,
};
use serde_json::Value;
use std::collections::BTreeMap;

/// Where a building stands: its outline, and the plot it brings when it has none.
struct Placement {
    outline: Geometry,
    plot: Option<Geometry>,
    direction: [f64; 2],
}
impl Planner<'_> {
    pub(super) fn place_building(
        &self,
        (building_id, plot_id): (crate::Id, crate::Id),
        use_: &str,
        [x, y]: [f64; 2],
        name: Option<&str>,
        creator: Option<crate::Id>,
    ) -> Result<Draft, String> {
        let use_ = Use::parse(use_).ok_or_else(|| format!("{use_} is not a building use"))?;
        let yard = self.empty_yard(Position::xy(x, y))?;
        let anchor = match yard {
            Some(yard) => self.spatial.interior_position(&yard.geometry)?,
            None => Position::xy(x, y),
        };
        let street = self.fronted_street(yard, anchor)?;
        let settlement = self.settlement(text(street, "settlement"), anchor)?;
        let front = frontage(street, anchor, self.spatial)?;
        let placed = self.placement(&front, yard, use_, settlement.size)?;
        let attributes = building_attributes(use_, &settlement, placed.direction, name);
        let structures = self.layer_of("structures")?;
        let mut draft = self.create(
            building_id,
            &structures,
            "building",
            name.map(str::to_owned),
            &placed.outline,
            &attributes,
            creator,
        )?;
        let fronts = MapRelation {
            target_id: street.id,
            target_map_id: None,
            target_name: street.name.clone().unwrap_or_default(),
            kind: FRONTS.into(),
        };
        draft.after[0].relations.push(fronts.clone());
        if let Some(plot) = placed.plot {
            let mut values = BTreeMap::from([("nameStatus".to_string(), Value::from("label"))]);
            town_attributes(&mut values, &settlement, None);
            let ground = self.clear_plot(plot)?;
            let plots = self.layer_of("plots")?;
            let mut made = self.create(plot_id, &plots, "yard", None, &ground, &values, creator)?;
            // The new plot fronts the street its building does.
            if let Some(yard) = made.after.first_mut() {
                yard.relations.push(fronts);
            }
            draft.after.extend(made.after);
        }
        draft.label = labelled(&format!("Place {}", use_.label()), name);
        Ok(draft)
    }
    /// The building fitted to the empty plot it is placed in, or on a new plot at the street.
    fn placement(
        &self,
        front: &Frontage,
        yard: Option<&MapFeature>,
        use_: Use,
        size: Size,
    ) -> Result<Placement, String> {
        let sign = if front.side == Side::Left { 1.0 } else { -1.0 };
        let direction = front.direction;
        let inward = [-direction[1] * sign, direction[0] * sign];
        let at = |along: f64, back: f64| {
            [
                front.point[0] + direction[0] * along + inward[0] * back,
                front.point[1] + direction[1] * along + inward[1] * back,
            ]
        };
        let back = setback(size);
        if let Some(yard) = yard {
            let [low, high, near, far] = extent(&yard.geometry, front.point, direction, inward);
            let (wide, deep) = fitted(use_, size, high - low, far - near);
            return Ok(Placement {
                outline: rectangle(
                    at((low + high) / 2.0, near + back),
                    direction,
                    inward,
                    wide,
                    deep,
                ),
                plot: None,
                direction,
            });
        }
        let edge = front.half_width + VERGE;
        let (plot_wide, plot_deep) = plot_for(use_, size);
        let (wide, deep) = fitted(use_, size, plot_wide, plot_deep);
        Ok(Placement {
            outline: rectangle(at(0.0, edge + back), direction, inward, wide, deep),
            plot: Some(rectangle(
                at(0.0, edge),
                direction,
                inward,
                plot_wide,
                plot_deep,
            )),
            direction,
        })
    }
    /// A new plot within the map's frame, cut back from water, ways and other plots.
    fn clear_plot(&self, plot: Geometry) -> Result<Geometry, String> {
        let mut ground = self
            .spatial
            .clip_by_rect(&plot, self.map.bounds)?
            .ok_or("Place the building inside the map's frame")?;
        let holds = |f: &MapFeature| {
            is_water(f) || matches!(family(&f.layer_id), "roads" | "plots") || is_building(f)
        };
        for other in self.targets.iter().filter(|f| holds(f)) {
            let taken = covered(other, self.spatial)?;
            if !matches!(
                taken,
                Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
            ) || !overlaps(&ground, &taken, self.spatial)?
            {
                continue;
            }
            ground = self
                .spatial
                .overlay(&ground, &taken, Overlay::Difference)?
                .ok_or("There is no open ground here for the building's plot")?;
        }
        Ok(ground)
    }
    /// The plot a building is placed in, when no building stands on it yet.
    fn empty_yard(&self, at: Position) -> Result<Option<&MapFeature>, String> {
        for yard in self.targets.iter().filter(|f| is_yard(f)) {
            if !self
                .spatial
                .relation(&yard.geometry, &point(at), Predicate::Intersects)?
            {
                continue;
            }
            let mut built = false;
            for building in self.targets.iter().filter(|f| is_building(f)) {
                let inside = self.spatial.interior_position(&building.geometry)?;
                built |=
                    self.spatial
                        .relation(&yard.geometry, &point(inside), Predicate::Intersects)?;
            }
            if !built {
                return Ok(Some(yard));
            }
        }
        Ok(None)
    }
    /// A plot's own street, else the nearest street within reach.
    fn fronted_street(
        &self,
        yard: Option<&MapFeature>,
        anchor: Position,
    ) -> Result<&MapFeature, String> {
        let streets: Vec<&MapFeature> = self.targets.iter().filter(|f| is_street(f)).collect();
        if let Some(own) = yard
            .and_then(street_of)
            .and_then(|id| streets.iter().find(|s| s.id == id))
        {
            return Ok(own);
        }
        match self.nearest(&streets, anchor)? {
            Some((street, distance)) if distance <= super::frontage::FRONTAGE_REACH => Ok(street),
            _ => Err(format!(
                "Place the building within {} m of a street",
                super::frontage::FRONTAGE_REACH
            )),
        }
    }
}
/// A plot's extent along the street from `origin` and back from it: least and most along,
/// nearest and furthest back.
fn extent(plot: &Geometry, origin: [f64; 2], direction: [f64; 2], inward: [f64; 2]) -> [f64; 4] {
    let mut bounds = [
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    ];
    let rings: &[Vec<Position>] = match plot {
        Geometry::Polygon { coordinates } => coordinates,
        _ => &[],
    };
    for p in rings.iter().flatten() {
        let [x, y] = xy(*p);
        let (dx, dy) = (x - origin[0], y - origin[1]);
        let (along, back) = (
            dx * direction[0] + dy * direction[1],
            dx * inward[0] + dy * inward[1],
        );
        bounds = [
            bounds[0].min(along),
            bounds[1].max(along),
            bounds[2].min(back),
            bounds[3].max(back),
        ];
    }
    bounds
}
fn building_attributes(
    use_: Use,
    settlement: &Settlement,
    [dx, dy]: [f64; 2],
    name: Option<&str>,
) -> BTreeMap<String, Value> {
    let mut attributes = BTreeMap::from([
        ("use".to_string(), Value::from(use_.as_str())),
        (
            "buildingFunction".into(),
            Value::from(use_.building_function().as_str()),
        ),
        ("occupants".into(), occupants(use_, settlement.size).into()),
        ("storeys".into(), use_.storeys(settlement.size).into()),
        (
            "rotation".into(),
            ((dy.atan2(dx).to_degrees() * 100.0).round() / 100.0).into(),
        ),
    ]);
    let keeper = if use_.household() {
        "household"
    } else {
        "business"
    };
    if let Some(name) = name.filter(|n| !n.trim().is_empty()) {
        attributes.insert(keeper.into(), name.trim().into());
    }
    town_attributes(
        &mut attributes,
        settlement,
        name.is_none().then_some(use_.work()),
    );
    attributes
}
/// The plot a building of this use takes: an ordinary plot, or one wide enough for it.
fn plot_for(use_: Use, size: Size) -> (f64, f64) {
    let (frontage, depth) = plot_size(size);
    let (wide, deep) = use_.footprint(size);
    if wide.is_finite() {
        ((wide + 2.0).max(frontage), (deep + 4.0).max(depth))
    } else {
        (frontage, depth)
    }
}
fn occupants(use_: Use, size: Size) -> u32 {
    let base = use_.occupants(size);
    if base > 0.0 {
        base.round().max(1.0) as u32
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wide_uses_take_wider_plots_and_houses_take_ordinary_ones() {
        assert_eq!(plot_for(Use::House, Size::Village), (14.0, 30.0));
        assert_eq!(plot_for(Use::Inn, Size::Village), (16.0, 30.0));
        assert_eq!(plot_for(Use::Temple, Size::Town), (14.0, 28.0));
        assert_eq!(occupants(Use::Inn, Size::Village), 5);
        assert_eq!(occupants(Use::Warehouse, Size::Town), 0);
    }
    #[test]
    fn a_plot_is_measured_along_and_back_from_its_street() {
        let plot = Geometry::Polygon {
            coordinates: vec![[
                [39.0, 16.5],
                [51.0, 16.5],
                [51.0, 36.5],
                [39.0, 36.5],
                [39.0, 16.5],
            ]
            .iter()
            .map(|&[x, y]| Position::xy(x, y))
            .collect()],
        };
        let [low, high, near, far] = extent(&plot, [45.0, 40.0], [1.0, 0.0], [0.0, -1.0]);
        assert_eq!((low, high, near, far), (-6.0, 6.0, 3.5, 23.5));
    }
}
