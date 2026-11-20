use crate::{
    features::{chart::Chart, context::Context},
    field::inheritance::resources::Resource,
    spatial::{Overlay, SpatialKernel},
};
use atlas_map::{Geometry, Id};
// hpc-exempt: channel-to-resource publication bindings, not numerical field storage.
use std::{collections::BTreeMap, io, rc::Rc};
pub struct Lake {
    pub id: Id,
    pub geometry: Geometry,
    pub level: f64,
}
pub struct Field {
    pub id: String,
    pub area: Id,
    pub input: bool,
    pub footprint: Geometry,
    pub resource: Rc<Resource>,
    pub ocean: Option<Geometry>,
    pub ocean_recorded: bool,
    pub lakes: Vec<Lake>,
}
pub struct Selected<'a> {
    pub fields: Vec<&'a Field>,
    // hpc-exempt: channel-to-resource publication bindings, not numerical field storage.
    pub channels: BTreeMap<String, &'a Field>,
}
impl<'a> Selected<'a> {
    pub fn new(context: &Context, area: Id, fields: &'a [Field]) -> io::Result<Self> {
        let space = context.space(area).map_err(io::Error::other)?;
        let areas = context.geography_areas(area).map_err(io::Error::other)?;
        let mut selected = Vec::new();
        for field in fields {
            if areas.contains(&field.area)
                && context.space(field.area).map_err(io::Error::other)? == space
            {
                selected.push((
                    context.lineage(field.area).map_err(io::Error::other)?.len(),
                    field,
                ));
            }
        }
        // hpc-exempt: field-reference precedence by map ownership, not numerical sample ordering.
        selected.sort_by_key(|(depth, field)| (*depth, !field.input));
        let fields = selected
            .into_iter()
            .map(|(_, field)| field)
            .collect::<Vec<_>>();
        // hpc-exempt: channel-to-resource publication bindings, not numerical field storage.
        let mut channels = BTreeMap::new();
        for field in &fields {
            for channel in field.resource.channels.keys() {
                channels.insert(channel.clone(), *field);
            }
        }
        Ok(Self { fields, channels })
    }
    pub fn companion(&self, field: &Field, channel: &str) -> Option<&'a Resource> {
        self.fields
            .iter()
            .rev()
            .find(|candidate| {
                candidate.area == field.area
                    && candidate.input == field.input
                    && candidate.resource.channels.contains_key(channel)
            })
            .map(|f| f.resource.as_ref())
    }
    pub fn groups(&self) -> Vec<(Resource, &Geometry)> {
        let mut groups: Vec<(Resource, &Geometry)> = Vec::new();
        for (channel, field) in &self.channels {
            let group = groups
                .iter()
                .position(|(resource, _)| resource.active.shares_storage(&field.resource.active));
            let index = group.unwrap_or_else(|| {
                let mut resource = field.resource.as_ref().clone();
                resource.channels.clear();
                groups.push((resource, &field.footprint));
                groups.len() - 1
            });
            groups[index]
                .0
                .channels
                .insert(channel.clone(), field.resource.channels[channel].clone());
        }
        groups
    }
}
pub fn footprint(
    context: &Context,
    area: Id,
    field: &Field,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Geometry>> {
    let area = context.area(area).map_err(io::Error::other)?;
    if area.owns_geography() {
        Ok(Some(field.footprint.clone()))
    } else {
        spatial
            .overlay(&field.footprint, &area.footprint, Overlay::Intersection)
            .map_err(io::Error::other)
    }
}
/// A refined child publishes only inside its selected outline. It generates over a wider
/// captured extent so that its edges have context; maps without one publish all they hold.
pub fn outline(context: &Context, area: Id) -> io::Result<Option<&Geometry>> {
    let area = context.area(area).map_err(io::Error::other)?;
    Ok(area
        .map
        .as_ref()
        .filter(|map| map.extent.is_some())
        .map(|_| &area.footprint))
}
/// A polygonal coverage limited to the outline; `None` when none of it lies inside.
pub fn within(
    coverage: Geometry,
    outline: Option<&Geometry>,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<Geometry>> {
    let Some(outline) = outline else {
        return Ok(Some(coverage));
    };
    if spatial
        .relation(outline, &coverage, crate::spatial::Predicate::Covers)
        .map_err(io::Error::other)?
    {
        return Ok(Some(coverage));
    }
    Ok(spatial
        .overlay(&coverage, outline, Overlay::Intersection)
        .map_err(io::Error::other)?
        .and_then(atlas_map::regions::polygon))
}
/// Published records limited to the outline: shapes are cut at its edge and records wholly
/// in the context band are left out. Geometry keeps its own dimension.
pub fn clip_records(
    mut features: Vec<atlas_map::MapFeature>,
    outline: Option<&Geometry>,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<atlas_map::MapFeature>> {
    let Some(outline) = outline else {
        return Ok(features);
    };
    let shapes: Vec<_> = features.iter().map(|f| f.geometry.clone()).collect();
    let covered = spatial
        .relations(outline, &shapes, crate::spatial::Predicate::Covers)
        .map_err(io::Error::other)?;
    let mut kept = Vec::with_capacity(features.len());
    for (mut feature, covered) in features.drain(..).zip(covered) {
        if !covered {
            let clipped = match &feature.geometry {
                Geometry::Point { .. } | Geometry::MultiPoint { .. } => None,
                Geometry::LineString { .. } | Geometry::MultiLineString { .. } => spatial
                    .clip_trace(&feature.geometry, outline)
                    .map_err(io::Error::other)?,
                _ => spatial
                    .overlay(&feature.geometry, outline, Overlay::Intersection)
                    .map_err(io::Error::other)?
                    .and_then(atlas_map::regions::polygon),
            };
            let Some(clipped) = clipped else {
                continue;
            };
            feature.geometry = clipped;
        }
        kept.push(feature);
    }
    Ok(kept)
}
pub fn chart_copy<'a>(chart: &Chart<'a>) -> Chart<'a> {
    Chart {
        domain: chart.domain,
        bounds: chart.bounds,
        cylindrical: chart.cylindrical,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_map::{Bounds, MapFeature, MapFeatureCatalog, Position};

    fn feature(name: &str, geometry: Geometry) -> MapFeature {
        MapFeature {
            id: Id::from_name(name),
            space_id: Id::from_name("surface"),
            entity_id: None,
            layer_id: "vector:test".into(),
            name: Some(name.into()),
            kind: "test".into(),
            type_id: "test".into(),
            catalog: MapFeatureCatalog {
                values: Default::default(),
                origin: "generated".into(),
                map_only: false,
            },
            geometry,
            footprint: None,
            attributes: Default::default(),
            relations: vec![],
            causes: vec![],
        }
    }

    #[test]
    fn records_in_the_context_band_are_cut_or_left_out_and_fields_keep_to_the_outline() {
        let spatial = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let ring = |points: &[(f64, f64)]| Geometry::Polygon {
            coordinates: vec![points.iter().map(|&(x, y)| Position::xy(x, y)).collect()],
        };
        // A triangle of a coast; its context band reaches beyond it.
        let outline = ring(&[(0., 0.), (10., 0.), (0., 10.), (0., 0.)]);
        let features = vec![
            feature(
                "inside",
                Geometry::Point {
                    coordinates: Position::xy(2., 2.),
                },
            ),
            feature(
                "band",
                Geometry::Point {
                    coordinates: Position::xy(8., 8.),
                },
            ),
            feature(
                "river",
                Geometry::LineString {
                    coordinates: vec![Position::xy(1., 1.), Position::xy(9., 9.)],
                },
            ),
            feature(
                "square",
                ring(&[(1., 1.), (9., 1.), (9., 9.), (1., 9.), (1., 1.)]),
            ),
        ];
        let kept = clip_records(features.clone(), Some(&outline), &spatial).unwrap();
        let names: Vec<_> = kept.iter().map(|f| f.name.clone().unwrap()).collect();
        assert_eq!(names, ["inside", "river", "square"]);
        for feature in &kept {
            assert!(spatial
                .relation(
                    &outline,
                    &feature.geometry,
                    crate::spatial::Predicate::Covers
                )
                .unwrap());
        }
        // The river ends where the outline does, at the hypotenuse.
        let Bounds(_, _, east, north) = spatial.bounds(&kept[1].geometry).unwrap();
        assert!((east - 5.).abs() < 1e-6 && (north - 5.).abs() < 1e-6);
        // A map without a captured extent publishes everything it holds.
        assert_eq!(clip_records(features, None, &spatial).unwrap().len(), 4);

        let field = ring(&[(-2., -2.), (12., -2.), (12., 12.), (-2., 12.), (-2., -2.)]);
        let limited = within(field, Some(&outline), &spatial).unwrap().unwrap();
        assert!((spatial.area(&limited).unwrap() - 50.).abs() < 1e-6);
        let away = ring(&[(20., 20.), (30., 20.), (30., 30.), (20., 20.)]);
        assert!(within(away, Some(&outline), &spatial).unwrap().is_none());
    }
}
