//! A command applied to the features it names, as a validated change. Footprints, junctions
//! and hex marks follow in the store, which knows the features around the change.
use super::{
    creator_layer, editable, in_locked_layer, locked, shape_of,
    shapes::{carry_widths, transform_geometry, vertices, widths_at},
    EditCommand, Shape, Transform,
};
use crate::{
    spatial::SpatialKernel, CreatorLayer, Geometry, Id, LayerSource, MapDescriptor, MapFeature,
    MapFeatureCatalog, RealScale,
};
use serde_json::Value;
use std::collections::BTreeMap;

/// The features one command reads before it runs.
pub enum EditTargets {
    /// These features, by id.
    Ids(Vec<Id>),
    /// Every authorable feature: layer commands find their members by creator layer.
    Authorable,
    /// Authorable features in the primary space within these bounds, and the map's
    /// settlements: town tools read the streets, plots and buildings around them.
    Around(crate::Bounds),
    /// Every feature in one located space, hexes included: a structure map's level.
    Space(Id),
    /// Every feature in the layers of one family, across all spaces (`structures`).
    Family(&'static str),
    Nothing,
}
impl EditCommand {
    pub fn targets(&self) -> EditTargets {
        use EditCommand::*;
        match self {
            Reshape { id, .. } => EditTargets::Ids(vec![*id]),
            Transform { ids, .. }
            | Duplicate { ids, .. }
            | Delete { ids }
            | SetAttributes { ids, .. }
            | MoveToLayer { ids, .. } => EditTargets::Ids(ids.clone()),
            PasteStyle { source, ids } => EditTargets::Ids([vec![*source], ids.clone()].concat()),
            MergeDown { .. } | DeleteLayer { .. } => EditTargets::Authorable,
            Create { .. }
            | Place { .. }
            | Scatter { .. }
            | AddLayer { .. }
            | RenameLayer { .. }
            | LockLayer { .. } => EditTargets::Nothing,
            DrawStreet { geometry, .. } => {
                let points: Vec<[f64; 2]> = vertices(geometry)
                    .unwrap_or_default()
                    .iter()
                    .map(|p| [p.coordinates()[0], p.coordinates()[1]])
                    .collect();
                EditTargets::Around(super::town::town_bounds(&points, super::PLACING_REACH))
            }
            PlaceBuilding { at, .. } => {
                EditTargets::Around(super::town::town_bounds(&[*at], super::PLACING_REACH))
            }
            AddLevel { .. } => EditTargets::Family("structures"),
            RemoveLevel { space_id } => EditTargets::Space(*space_id),
            Connect { id, target } | Disconnect { id, target } => match target.map_id {
                Some(_) => EditTargets::Ids(vec![*id]),
                None => EditTargets::Ids(vec![*id, target.feature_id]),
            },
        }
    }
}

/// A planned change: features as they stood and as they will stand. A feature in `before`
/// and missing from `after` is deleted; one only in `after` is created.
#[derive(Debug, Default)]
pub struct Draft {
    pub label: String,
    pub before: Vec<MapFeature>,
    pub after: Vec<MapFeature>,
    pub layers: Option<Vec<CreatorLayer>>,
    /// The map's spaces and published layers after the change, when it adds or removes some.
    pub spaces: Option<super::SpaceLayout>,
}
/// Attributes that belong to a shape or its place in the map rather than to its kind.
const SHAPE_KEYS: [&str; 6] = [
    "widths",
    "rotation",
    "creatorLayer",
    "locked",
    "placeId",
    "nameStatus",
];

/// Validate a command against the features it names and plan its change.
pub fn plan(
    map: &MapDescriptor,
    command: &EditCommand,
    targets: &[MapFeature],
    new_id: &mut dyn FnMut() -> Id,
    spatial: &dyn SpatialKernel,
) -> Result<Draft, String> {
    let real = editable(map)?;
    let edit = Planner {
        map,
        real,
        targets,
        spatial,
    };
    use EditCommand::*;
    match command {
        Create {
            layer_id,
            kind,
            name,
            geometry,
            attributes,
            creator_layer,
        } => edit.create(
            new_id(),
            layer_id,
            kind,
            name.clone(),
            geometry,
            attributes,
            *creator_layer,
        ),
        Reshape { id, geometry } => edit.reshape(*id, geometry),
        Transform { ids, transform } => edit.transform(ids, transform),
        Duplicate { ids, offset } => edit.duplicate(ids, *offset, new_id),
        Delete { ids } => edit.delete(ids),
        SetAttributes {
            ids,
            name,
            attributes,
        } => edit.set_attributes(ids, name.as_deref(), attributes),
        PasteStyle { source, ids } => edit.paste_style(*source, ids),
        AddLayer { name } => edit.add_layer(new_id(), name),
        RenameLayer { id, name } => {
            edit.layers_changed(*id, &format!("Rename layer {name}"), |l| {
                l.name = name.clone()
            })
        }
        LockLayer { id, locked } => {
            let verb = if *locked { "Lock" } else { "Unlock" };
            edit.layers_changed(*id, verb, |l| l.locked = *locked)
        }
        MoveToLayer { ids, layer } => edit.move_to_layer(ids, *layer),
        MergeDown { id } => edit.merge_down(*id),
        DeleteLayer { id } => edit.delete_layer(*id),
        Place {
            layer_id,
            kind,
            name,
            at,
            rotation,
            scale,
            creator_layer,
        } => edit.place(
            new_id(),
            super::placing::Placing {
                layer_id,
                kind,
                name: name.as_deref(),
                creator: *creator_layer,
            },
            *at,
            *rotation,
            *scale,
        ),
        Scatter {
            layer_id,
            kind,
            outline,
            spacing,
            seed,
            creator_layer,
        } => edit.scatter(
            super::placing::Placing {
                layer_id,
                kind,
                name: None,
                creator: *creator_layer,
            },
            outline,
            *spacing,
            *seed,
            new_id,
        ),
        DrawStreet {
            road_class,
            geometry,
            name,
            creator_layer,
        } => edit.draw_street(
            new_id,
            road_class,
            geometry,
            name.as_deref(),
            *creator_layer,
        ),
        PlaceBuilding {
            building_use,
            at,
            name,
            creator_layer,
        } => edit.place_building(
            (new_id(), new_id()),
            building_use,
            *at,
            name.as_deref(),
            *creator_layer,
        ),
        AddLevel { below } => super::levels::add_level(map, targets, *below, spatial),
        RemoveLevel { space_id } => super::levels::remove_level(map, targets, *space_id),
        Connect { id, target } => super::levels::connect(map, targets, *id, target, true),
        Disconnect { id, target } => super::levels::connect(map, targets, *id, target, false),
    }
}

pub(super) struct Planner<'a> {
    pub(super) map: &'a MapDescriptor,
    pub(super) real: &'a RealScale,
    pub(super) targets: &'a [MapFeature],
    pub(super) spatial: &'a dyn SpatialKernel,
}
impl Planner<'_> {
    pub(super) fn find(&self, id: Id) -> Result<&MapFeature, String> {
        self.targets
            .iter()
            .find(|feature| feature.id == id)
            .ok_or_else(|| format!("Feature {id} is not on this map"))
    }
    fn named(&self, ids: &[Id]) -> Result<Vec<&MapFeature>, String> {
        if ids.is_empty() {
            return Err("Select a feature first".into());
        }
        let features = ids
            .iter()
            .map(|id| self.find(*id))
            .collect::<Result<Vec<_>, _>>()?;
        // Hexes and other derived or generated layers are not drawn into, so not edited.
        if let Some(fixed) = features.iter().find(|f| shape_of(&f.layer_id).is_none()) {
            return Err(format!("{} cannot be edited by hand", title(fixed)));
        }
        Ok(features)
    }
    /// Features whose creator layer is unlocked; their own lock still allows non-pointer edits.
    fn open_layers(&self, ids: &[Id]) -> Result<Vec<&MapFeature>, String> {
        let features = self.named(ids)?;
        if let Some(held) = features.iter().find(|f| in_locked_layer(f, self.real)) {
            return Err(format!("{} is on a locked layer", title(held)));
        }
        Ok(features)
    }
    /// Features the pointer may change: not locked on their own or through their layer.
    fn movable(&self, ids: &[Id]) -> Result<Vec<&MapFeature>, String> {
        let features = self.named(ids)?;
        if let Some(held) = features.iter().find(|f| locked(f, self.real)) {
            return Err(format!("{} is locked", title(held)));
        }
        Ok(features)
    }
    fn layer(&self, id: Id) -> Result<usize, String> {
        self.real
            .creator_layers
            .iter()
            .position(|layer| layer.id == id)
            .ok_or_else(|| "That creator layer is not on this map".into())
    }
    /// A geometry in canonical form, of the kind's shape in its layer (a wall is a line even
    /// among outlines) and inside the map's frame.
    pub(super) fn shaped_kind(
        &self,
        layer_id: &str,
        kind: &str,
        geometry: &Geometry,
    ) -> Result<Geometry, String> {
        let shape =
            super::shape_of_kind(layer_id, kind).ok_or("Features cannot be drawn in this layer")?;
        let fits = match (shape, geometry) {
            (Shape::Line, Geometry::LineString { coordinates }) => coordinates.len() >= 2,
            (Shape::Area, Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }) => true,
            _ => false,
        };
        if !fits {
            return Err(match shape {
                Shape::Line => "This layer holds lines of two or more points".into(),
                Shape::Area => "This layer holds outlines".into(),
            });
        }
        let canonical = self.spatial.canonical(geometry)?;
        let crate::Bounds(w, s, e, n) = self.spatial.bounds(&canonical)?;
        let crate::Bounds(fw, fs, fe, fn_) = self.map.bounds;
        let slack = (fe - fw).max(fn_ - fs) * 1e-9;
        if w < fw - slack || s < fs - slack || e > fe + slack || n > fn_ + slack {
            return Err("Keep the shape inside the map's frame".into());
        }
        Ok(canonical)
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn create(
        &self,
        id: Id,
        layer_id: &str,
        kind: &str,
        name: Option<String>,
        drawn: &Geometry,
        attributes: &BTreeMap<String, Value>,
        creator: Option<Id>,
    ) -> Result<Draft, String> {
        let layer = self
            .map
            .layers
            .iter()
            .find(|layer| layer.id == layer_id && matches!(layer.source, LayerSource::Vector(_)))
            .ok_or("That layer is not on this map")?;
        let kind_type = layer
            .catalog
            .feature_types
            .iter()
            .find(|entry| entry.kind == kind)
            .ok_or_else(|| format!("{kind} is not a kind of {}", layer.name))?;
        let geometry = self.shaped_kind(layer_id, kind, drawn)?;
        let mut feature = MapFeature {
            id,
            space_id: layer.space_id,
            entity_id: None,
            layer_id: layer_id.into(),
            name: name.filter(|name| !name.trim().is_empty()),
            kind: kind.into(),
            type_id: kind_type.id.clone(),
            catalog: MapFeatureCatalog {
                values: BTreeMap::new(),
                origin: "Authored".into(),
                map_only: false,
            },
            geometry,
            footprint: None,
            attributes: BTreeMap::new(),
            relations: Vec::new(),
            causes: Vec::new(),
        };
        if let Some(creator) = creator {
            self.layer(creator)?;
            feature
                .attributes
                .insert("creatorLayer".into(), creator.into());
        }
        // Widths given for the drawn points follow them onto the canonical line.
        let mut attributes = attributes.clone();
        if let Some(widths) = numbers(attributes.get("widths")) {
            if vertices(drawn).map(<[_]>::len) == Some(widths.len()) {
                let carried = carry_widths(drawn, &widths, &feature.geometry, self.spatial)?;
                attributes.insert("widths".into(), rounded(&carried));
            }
        }
        self.assign(&mut feature, &attributes)?;
        if in_locked_layer(&feature, self.real) {
            return Err("Unlock the layer before drawing into it".into());
        }
        Ok(Draft {
            label: format!("Draw {}", title(&feature)),
            after: vec![feature],
            ..Draft::default()
        })
    }
    // owner-direction(2026-11-16): dragging a river around preserves the river in tact as a feature line
    fn reshape(&self, id: Id, geometry: &Geometry) -> Result<Draft, String> {
        let feature = self.movable(&[id])?[0];
        let mut next = feature.clone();
        next.geometry = self.shaped_kind(&feature.layer_id, &feature.kind, geometry)?;
        if let Some(widths) = numbers(feature.attributes.get("widths")) {
            let carried = carry_widths(&feature.geometry, &widths, &next.geometry, self.spatial)?;
            next.attributes.insert("widths".into(), rounded(&carried));
        }
        Ok(Draft {
            label: format!("Reshape {}", title(feature)),
            before: vec![feature.clone()],
            after: vec![next],
            layers: None,
            spaces: None,
        })
    }
    fn transform(&self, ids: &[Id], transform: &Transform) -> Result<Draft, String> {
        if !transform.scale.is_finite() || transform.scale <= 0.0 {
            return Err("Scale by a positive amount".into());
        }
        let features = self.movable(ids)?;
        let mut after = Vec::new();
        for feature in &features {
            let mut next = (*feature).clone();
            let moved = transform_geometry(&feature.geometry, transform);
            next.geometry = self.shaped_kind(&feature.layer_id, &feature.kind, &moved)?;
            if let Some(widths) = numbers(feature.attributes.get("widths")) {
                if vertices(&next.geometry).map(<[_]>::len) != Some(widths.len()) {
                    let carried = widths_at(&feature.geometry, &widths, &moved, self.spatial)?;
                    next.attributes.insert("widths".into(), rounded(&carried));
                }
            }
            turn(&mut next, transform.rotate);
            after.push(next);
        }
        let verb = if transform.rotate != 0.0 {
            "Rotate"
        } else if transform.scale != 1.0 {
            "Scale"
        } else {
            "Move"
        };
        Ok(Draft {
            label: format!("{verb} {}", titles(&features)),
            before: features.into_iter().cloned().collect(),
            after,
            layers: None,
            spaces: None,
        })
    }
    fn duplicate(
        &self,
        ids: &[Id],
        [dx, dy]: [f64; 2],
        new_id: &mut dyn FnMut() -> Id,
    ) -> Result<Draft, String> {
        let features = self.open_layers(ids)?;
        let shift = Transform {
            translate: [dx, dy],
            rotate: 0.0,
            scale: 1.0,
            about: [0.0, 0.0],
        };
        let mut after = Vec::new();
        for feature in &features {
            let mut copy = (*feature).clone();
            copy.id = new_id();
            copy.entity_id = None;
            copy.attributes.remove("placeId");
            copy.attributes.remove("locked");
            copy.catalog.origin = "Authored".into();
            copy.geometry = self.shaped_kind(
                &feature.layer_id,
                &feature.kind,
                &transform_geometry(&feature.geometry, &shift),
            )?;
            after.push(copy);
        }
        Ok(Draft {
            label: format!("Duplicate {}", titles(&features)),
            after,
            ..Draft::default()
        })
    }
    fn delete(&self, ids: &[Id]) -> Result<Draft, String> {
        let features = self.movable(ids)?;
        Ok(Draft {
            label: format!("Delete {}", titles(&features)),
            before: features.into_iter().cloned().collect(),
            ..Draft::default()
        })
    }
    fn set_attributes(
        &self,
        ids: &[Id],
        name: Option<&str>,
        attributes: &BTreeMap<String, Value>,
    ) -> Result<Draft, String> {
        if let Some(draft) = self.hex_classes(ids, name, attributes)? {
            return Ok(draft);
        }
        let features = self.open_layers(ids)?;
        let mut after = Vec::new();
        for feature in &features {
            let mut next = (*feature).clone();
            if let Some(name) = name {
                next.name = Some(name.trim().to_owned()).filter(|name| !name.is_empty());
            }
            self.assign(&mut next, attributes)?;
            after.push(next);
        }
        Ok(Draft {
            label: format!("Edit {}", titles(&features)),
            before: features.into_iter().cloned().collect(),
            after,
            layers: None,
            spaces: None,
        })
    }
    /// Apply attribute values; null removes. Shape-bound values are checked against the shape.
    fn assign(
        &self,
        feature: &mut MapFeature,
        attributes: &BTreeMap<String, Value>,
    ) -> Result<(), String> {
        for (key, value) in attributes {
            match (key.as_str(), value) {
                (_, Value::Null) => {
                    feature.attributes.remove(key);
                    continue;
                }
                ("widths", _) => check_widths(feature, value)?,
                ("creatorLayer", Value::String(id)) => {
                    self.layer(id.parse().map_err(|_| "creatorLayer is not a layer")?)?;
                }
                ("locked", Value::Bool(_)) => {}
                ("creatorLayer" | "locked", _) => return Err(format!("{key} has the wrong type")),
                _ => {}
            }
            feature.attributes.insert(key.clone(), value.clone());
        }
        Ok(())
    }
    fn paste_style(&self, source: Id, ids: &[Id]) -> Result<Draft, String> {
        let source = self.find(source)?;
        let features = self.movable(ids)?;
        let style: BTreeMap<_, _> = source
            .attributes
            .iter()
            .filter(|(key, _)| !SHAPE_KEYS.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        let widths = numbers(source.attributes.get("widths"));
        let mut after = Vec::new();
        for feature in &features {
            if feature.layer_id != source.layer_id {
                return Err(format!(
                    "{} is not in the same layer as {}",
                    title(feature),
                    title(source)
                ));
            }
            let mut next = (*feature).clone();
            next.attributes
                .retain(|key, _| SHAPE_KEYS.contains(&key.as_str()));
            next.attributes.extend(style.clone());
            if let (Some(widths), Some(_)) = (&widths, vertices(&next.geometry)) {
                let read = widths_at(&source.geometry, widths, &next.geometry, self.spatial)?;
                next.attributes.insert("widths".into(), rounded(&read));
            }
            after.push(next);
        }
        Ok(Draft {
            label: format!("Paste style onto {}", titles(&features)),
            before: features.into_iter().cloned().collect(),
            after,
            layers: None,
            spaces: None,
        })
    }
    fn add_layer(&self, id: Id, name: &str) -> Result<Draft, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Name the layer".into());
        }
        let mut layers = self.real.creator_layers.clone();
        layers.push(CreatorLayer {
            id,
            name: name.into(),
            locked: false,
        });
        Ok(Draft {
            label: format!("Add layer {name}"),
            layers: Some(layers),
            ..Draft::default()
        })
    }
    fn layers_changed(
        &self,
        id: Id,
        verb: &str,
        change: impl FnOnce(&mut CreatorLayer),
    ) -> Result<Draft, String> {
        let index = self.layer(id)?;
        let mut layers = self.real.creator_layers.clone();
        let name = layers[index].name.clone();
        change(&mut layers[index]);
        let label = if verb.starts_with("Rename") {
            verb.into()
        } else {
            format!("{verb} layer {name}")
        };
        Ok(Draft {
            label,
            layers: Some(layers),
            ..Draft::default()
        })
    }
    fn move_to_layer(&self, ids: &[Id], layer: Id) -> Result<Draft, String> {
        let index = self.layer(layer)?;
        if self.real.creator_layers[index].locked {
            return Err(format!(
                "Unlock {} before moving shapes into it",
                self.real.creator_layers[index].name
            ));
        }
        let features = self.open_layers(ids)?;
        let after = features
            .iter()
            .map(|feature| {
                let mut next = (*feature).clone();
                next.attributes.insert("creatorLayer".into(), layer.into());
                next
            })
            .collect();
        Ok(Draft {
            label: format!(
                "Move {} to {}",
                titles(&features),
                self.real.creator_layers[index].name
            ),
            before: features.into_iter().cloned().collect(),
            after,
            layers: None,
            spaces: None,
        })
    }
    fn members(&self, id: Id) -> Vec<&MapFeature> {
        self.targets
            .iter()
            .filter(|feature| creator_layer(feature, self.real) == Some(id))
            .collect()
    }
    fn merge_down(&self, id: Id) -> Result<Draft, String> {
        let index = self.layer(id)?;
        if index == 0 {
            return Err("The bottom layer has no layer beneath it".into());
        }
        let layers = &self.real.creator_layers;
        if layers[index].locked || layers[index - 1].locked {
            return Err("Unlock both layers before merging them".into());
        }
        let below = layers[index - 1].id;
        let members = self.members(id);
        let after = members
            .iter()
            .map(|feature| {
                let mut next = (*feature).clone();
                next.attributes.insert("creatorLayer".into(), below.into());
                next
            })
            .collect();
        let mut next = layers.clone();
        let removed = next.remove(index);
        Ok(Draft {
            label: format!("Merge layer {} down", removed.name),
            before: members.into_iter().cloned().collect(),
            after,
            layers: Some(next),
            spaces: None,
        })
    }
    fn delete_layer(&self, id: Id) -> Result<Draft, String> {
        let index = self.layer(id)?;
        let layers = &self.real.creator_layers;
        if layers.len() == 1 {
            return Err("A map keeps at least one layer".into());
        }
        if layers[index].locked {
            return Err("Unlock the layer before deleting it".into());
        }
        let mut next = layers.clone();
        let removed = next.remove(index);
        Ok(Draft {
            label: format!("Delete layer {}", removed.name),
            before: self.members(id).into_iter().cloned().collect(),
            after: Vec::new(),
            layers: Some(next),
            spaces: None,
        })
    }
}
fn check_widths(feature: &MapFeature, value: &Value) -> Result<(), String> {
    let widths = numbers(Some(value)).ok_or("Widths are a list of numbers")?;
    let count = vertices(&feature.geometry).map(<[_]>::len);
    if count != Some(widths.len()) {
        return Err("Give one width for each point of the line".into());
    }
    if widths.iter().any(|w| !w.is_finite() || *w <= 0.0) {
        return Err("Widths must be positive".into());
    }
    Ok(())
}
fn numbers(value: Option<&Value>) -> Option<Vec<f64>> {
    value?.as_array()?.iter().map(Value::as_f64).collect()
}
fn rounded(widths: &[f64]) -> Value {
    widths
        .iter()
        .map(|w| (w * 1000.0).round() / 1000.0)
        .collect::<Vec<_>>()
        .into()
}
/// Outlines record their turn; a rotated outline's angle stays in 0–360°.
pub(super) fn turn(feature: &mut MapFeature, degrees: f64) {
    if degrees == 0.0 || super::shape_of_kind(&feature.layer_id, &feature.kind) != Some(Shape::Area)
    {
        return;
    }
    let current = feature
        .attributes
        .get("rotation")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let next = (current + degrees).rem_euclid(360.0);
    feature
        .attributes
        .insert("rotation".into(), ((next * 100.0).round() / 100.0).into());
}
pub(super) fn title(feature: &MapFeature) -> String {
    feature.name.clone().unwrap_or_else(|| feature.kind.clone())
}
fn titles(features: &[&MapFeature]) -> String {
    match features {
        [one] => title(one),
        many => format!("{} features", many.len()),
    }
}
