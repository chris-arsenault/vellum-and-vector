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
pub fn chart_copy<'a>(chart: &Chart<'a>) -> Chart<'a> {
    Chart {
        domain: chart.domain,
        bounds: chart.bounds,
        cylindrical: chart.cylindrical,
    }
}
