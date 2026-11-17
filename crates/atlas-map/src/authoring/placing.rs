//! Placing objects, scattering clutter over an outline, and setting a hex's ground or cover.
use super::{
    choices::cover_classes,
    objects::{kind_size, object_outline, poisson_points, Seeded},
    plan::{title, Planner},
    Draft,
};
use crate::{Bounds, Geometry, MapFeature, Position, RealScale};
use serde_json::Value;
use std::collections::BTreeMap;

/// More objects than this in one scatter is a spacing typed wrong, not a scatter.
const MOST_SCATTERED: f64 = 5000.0;

/// The surface hex grid and the caves' grid.
pub fn is_hex_layer(layer_id: &str) -> bool {
    matches!(super::family(layer_id), "hexes" | "caveHexes")
}
/// The layer, kind, name and creator layer of what is placed.
pub(super) struct Placing<'a> {
    pub layer_id: &'a str,
    pub kind: &'a str,
    pub name: Option<&'a str>,
    pub creator: Option<&'a str>,
}
impl Planner<'_> {
    pub(super) fn place(
        &self,
        id: String,
        what: Placing<'_>,
        at: [f64; 2],
        rotation: f64,
        scale: f64,
    ) -> Result<Draft, String> {
        if !scale.is_finite() || scale <= 0.0 || !rotation.is_finite() {
            return Err("Place an object at a positive scale and a finite angle".into());
        }
        let mut draft = self.object(id, &what, at, rotation, scale)?;
        draft.label = format!("Place {}", title(&draft.after[0]));
        Ok(draft)
    }
    fn object(
        &self,
        id: String,
        what: &Placing<'_>,
        at: [f64; 2],
        rotation: f64,
        scale: f64,
    ) -> Result<Draft, String> {
        let size = kind_size(self.map, what.layer_id, what.kind)
            .ok_or_else(|| format!("{} has no true size in this map's catalogue", what.kind))?;
        let rotation = (rotation.rem_euclid(360.0) * 100.0).round() / 100.0;
        let attributes = BTreeMap::from([("rotation".to_string(), Value::from(rotation))]);
        self.create(
            id,
            what.layer_id,
            what.kind,
            what.name.map(str::to_owned),
            &object_outline(&size, at, rotation, scale),
            &attributes,
            what.creator,
        )
    }
    pub(super) fn scatter(
        &self,
        what: Placing<'_>,
        outline: &Geometry,
        spacing: f64,
        seed: u32,
        new_id: &mut dyn FnMut() -> String,
    ) -> Result<Draft, String> {
        if !spacing.is_finite() || spacing <= 0.0 {
            return Err("Scatter at a positive spacing".into());
        }
        if !matches!(
            outline,
            Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
        ) {
            return Err("Draw an outline to scatter into".into());
        }
        let outline = self.spatial.canonical(outline)?;
        let Bounds(w, s, e, n) = self.spatial.bounds(&outline)?;
        let estimate = (e - w) * (n - s) / (spacing * spacing);
        if estimate > MOST_SCATTERED {
            return Err(format!(
                "That spacing would scatter about {} objects; use a wider spacing",
                estimate.round()
            ));
        }
        self.check_kind(&what)?;
        let points = poisson_points(Bounds(w, s, e, n), spacing, u64::from(seed));
        let positions: Vec<Position> = points.iter().map(|&[x, y]| Position::xy(x, y)).collect();
        let inside = self.spatial.covers_points(&outline, &positions)?;
        // A second stream from the same seed turns and sizes each object, so they repeat too.
        let mut turns = Seeded::new(u64::from(seed) ^ 0x5ca7_7e12);
        let mut after = Vec::new();
        for (point, keep) in points.into_iter().zip(inside) {
            let (rotation, scale) = (turns.draw() * 360.0, 0.8 + turns.draw() * 0.4);
            if !keep {
                continue;
            }
            // An object that would hang over the map's edge is left out of the scatter.
            if let Ok(draft) = self.object(new_id(), &what, point, rotation, scale) {
                after.extend(draft.after);
            }
        }
        if after.is_empty() {
            return Err("The outline is too small for that spacing".into());
        }
        Ok(Draft {
            label: format!("Scatter {} {}", after.len(), title(&after[0])),
            after,
            ..Draft::default()
        })
    }
    /// The layer, kind and creator layer accept objects: one tiny object at the frame's
    /// centre is tried, so a scatter reports a wrong kind rather than an empty outline.
    fn check_kind(&self, what: &Placing<'_>) -> Result<(), String> {
        let Bounds(w, s, e, n) = self.map.bounds;
        let centre = [(w + e) / 2.0, (s + n) / 2.0];
        self.object(String::new(), what, centre, 0.0, 1e-3)
            .map(|_| ())
    }
    /// A hex takes only its ground or cover class; other attributes and its name stay derived.
    pub(super) fn hex_classes(
        &self,
        ids: &[String],
        name: Option<&str>,
        attributes: &BTreeMap<String, Value>,
    ) -> Result<Option<Draft>, String> {
        let features = ids
            .iter()
            .map(|id| self.find(id))
            .collect::<Result<Vec<_>, _>>()?;
        let hexes = features
            .iter()
            .filter(|feature| is_hex_layer(&feature.layer_id))
            .count();
        if hexes == 0 {
            return Ok(None);
        }
        if hexes != features.len() {
            return Err("Set hexes apart from other shapes".into());
        }
        if name.is_some() {
            return Err("A hex keeps its grid name".into());
        }
        check_classes(self.real, attributes)?;
        let after: Vec<MapFeature> = features
            .iter()
            .map(|hex| {
                let mut next = (*hex).clone();
                for (key, value) in attributes {
                    match value {
                        Value::Null => next.attributes.remove(key),
                        value => next.attributes.insert(key.clone(), value.clone()),
                    };
                }
                next
            })
            .collect();
        let what = attributes
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(" and ");
        let count = match after.len() {
            1 => "1 hex".to_string(),
            many => format!("{many} hexes"),
        };
        Ok(Some(Draft {
            label: format!("Set {what} of {count}"),
            before: features.into_iter().cloned().collect(),
            after,
            layers: None,
            spaces: None,
        }))
    }
}
/// A creator sets only a hex's ground and cover; everything else on a hex is derived from the
/// shapes. Ground is one of the map's published ground classes; cover one of the cover classes.
fn check_classes(real: &RealScale, attributes: &BTreeMap<String, Value>) -> Result<(), String> {
    if attributes.is_empty() {
        return Err("Choose a ground or cover class".into());
    }
    let covers: Vec<String> = cover_classes().into_iter().map(|class| class.id).collect();
    let grounds: Vec<&str> = real
        .authoring
        .ground_classes
        .iter()
        .map(|class| class.id.as_str())
        .collect();
    for (key, value) in attributes {
        let allowed: Vec<&str> = match key.as_str() {
            "ground" => grounds.clone(),
            "cover" => covers.iter().map(String::as_str).collect(),
            _ => {
                return Err(format!(
                    "A hex takes only a ground or cover class, not {key}"
                ))
            }
        };
        match value {
            Value::Null => {}
            Value::String(class) if allowed.contains(&class.as_str()) => {}
            _ if allowed.is_empty() => {
                return Err(format!("This map publishes no {key} classes"));
            }
            _ => return Err(format!("A hex's {key} is one of {}", allowed.join(", "))),
        }
    }
    Ok(())
}
