//! Prepare a generation chart from map-owned geography and pinned selection metadata.
use crate::{
    generation_request::MapFrame,
    numerical_resource::{FieldScope, Scope as Located},
};
use atlas_generation::{
    atlas::{configuration::Input, resolution::Profile, state::Scope},
    features::{
        chart::{self, Chart},
        context::{Area, Context},
    },
    reconstruction::traits::Trait,
    spatial::SpatialKernel,
};
use atlas_map::{regions::rectangle, Bounds, Geometry, Id};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: Id,
    pub domain: Geometry,
    pub boundary_mode: Option<String>,
    pub precision: Option<f64>,
}
pub use atlas_generation::atlas::validation::interfaces::Crossing;
#[derive(Serialize, Deserialize)]
pub struct Boundary {
    pub crossings: Vec<Crossing>,
    pub samples: Vec<BoundarySample>,
}
#[derive(Serialize, Deserialize)]
pub struct BoundarySample {
    pub point: atlas_generation::features::context::Origin,
    pub values: BTreeMap<String, f64>,
}
#[derive(Serialize, Deserialize)]
pub struct MappedArea {
    #[serde(flatten)]
    pub area: Area,
    pub boundary: Option<Boundary>,
    pub traits: Vec<Trait>,
}
pub use atlas_generation::publication::catalogue::Layer;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub id: String,
    pub area_id: Id,
    pub layer_id: String,
    #[serde(default)]
    pub input: bool,
    pub channels: Option<Vec<String>>,
    pub footprint: Option<Geometry>,
    pub resource_id: Option<String>,
    pub space_id: Option<Id>,
    pub state: Option<atlas_generation::features::records::State>,
}
#[derive(Serialize, Deserialize)]
pub struct Geography {
    pub id: Id,
    pub version: u64,
    pub reference: Reference,
    pub areas: BTreeMap<Id, MappedArea>,
    pub layers: BTreeMap<String, Layer>,
    pub fields: Vec<Field>,
    pub generations: Vec<GenerationRecord>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRecord {
    pub area_id: Option<Id>,
}
pub struct Prepared {
    pub frame: MapFrame,
    pub scope: FieldScope,
    pub ancestors: Vec<Id>,
    pub area_spaces: BTreeMap<Id, Id>,
    pub contracted: BTreeSet<Id>,
}
impl Geography {
    pub fn has_generated_geography(&self) -> bool {
        self.generations.iter().any(|run| {
            run.area_id
                .as_ref()
                .and_then(|id| self.areas.get(id))
                .is_none_or(|area| area.area.profile != Profile::Interior)
        })
    }
    pub fn context(&self) -> Context {
        Context {
            id: self.id,
            areas: self
                .areas
                .iter()
                .map(|(id, area)| (*id, area.area.clone()))
                .collect(),
        }
    }
    pub fn prepare(&self, input: &Input, spatial: &dyn SpatialKernel) -> io::Result<Prepared> {
        let context = self.context();
        let selected = self
            .areas
            .get(&input.area_id)
            .ok_or_else(|| io::Error::other("Choose an existing mapped area"))?;
        let area = &selected.area;
        let domain_bounds = spatial
            .bounds(&self.reference.domain)
            .map_err(io::Error::other)?;
        let cylindrical = self.reference.boundary_mode.as_deref() == Some("cylinder");
        let chart = Chart {
            domain: &self.reference.domain,
            bounds: domain_bounds,
            cylindrical,
        };
        let footprint = if area.map.is_some() {
            self.regional_frame(area, &chart, spatial)?
        } else {
            area.footprint.clone()
        };
        let bounds = chart
            .compact_bounds(&footprint, spatial)
            .map_err(io::Error::other)?;
        let span = match (&area.parent_id, &area.map) {
            (Some(_), Some(map)) if map.real_scale.is_some() => {
                map.real_scale.map_or(0.0, |real| real.cell_span())
            }
            (Some(_), Some(map)) => input
                .quality
                .regional_span(map.refinement_level.max(1))
                .map_err(io::Error::other)?,
            _ => input
                .quality
                .cell_span(area.profile)
                .map_err(io::Error::other)?,
        };
        let interior = interior(selected, &footprint, bounds, span, spatial)?;
        let space = context.space(area.id).map_err(io::Error::other)?;
        let coordinate_width = cylindrical.then_some(domain_bounds.2 - domain_bounds.0);
        let contracted = self
            .areas
            .values()
            .filter_map(|area| area.boundary.as_ref())
            .flat_map(|b| b.crossings.iter().map(|c| c.feature_id))
            .collect::<BTreeSet<_>>();
        let scope = Scope {
            world: self.id,
            area: area.id,
            area_name: area.name.clone(),
            space,
            world_geography: area.profile == Profile::World,
            owns_map_geography: area.owns_geography(),
            area_parents: self
                .areas
                .iter()
                .map(|(id, area)| (*id, area.area.parent_id))
                .collect(),
            domain: self.reference.domain.clone(),
            domain_bounds,
            footprint: footprint.clone(),
            cylindrical,
            has_boundary: selected.boundary.is_some(),
            precision: self.reference.precision.unwrap_or(1e-6),
            generation_domains: self
                .layers
                .values()
                .filter_map(|layer| {
                    layer
                        .generator
                        .as_ref()
                        .map(|domain| (layer.id.clone(), domain.clone()))
                })
                .collect(),
            contracted: contracted.clone(),
            real_scale: area.map.as_ref().and_then(|map| map.real_scale),
        };
        Ok(Prepared {
            frame: MapFrame {
                scope,
                chart: chart::working(&interior, bounds, coordinate_width, spatial)
                    .map_err(io::Error::other)?,
                bounds,
                quality: input.quality,
                profile: area.profile,
                has_parent: area.parent_id.is_some(),
                child_resolution: area.parent_id.as_ref().map(|_| span),
                coordinate_width,
                boundary_mode: match self.reference.boundary_mode.as_deref() {
                    Some("cylinder") => 1.0,
                    Some("ocean") => 2.0,
                    _ => 0.0,
                },
            },
            scope: FieldScope {
                located: Located {
                    world_id: self.id,
                    area_id: area.id,
                    space_id: space,
                },
                footprint,
                crs_id: self.reference.id,
                resolution: Some(span),
                revision: self.version,
                time: "present".into(),
            },
            ancestors: context
                .lineage(area.id)
                .map_err(io::Error::other)?
                .into_iter()
                .skip(1)
                .map(|a| a.id)
                .collect(),
            area_spaces: self
                .areas
                .keys()
                .map(|&id| Ok((id, context.space(id).map_err(io::Error::other)?)))
                .collect::<io::Result<_>>()?,
            contracted,
        })
    }
    fn regional_frame(
        &self,
        area: &Area,
        chart: &Chart<'_>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Geometry> {
        let pinned = area.map.as_ref().and_then(|map| map.extent.as_ref());
        let subject = pinned
            .or_else(|| {
                self.fields
                    .iter()
                    .find(|field| {
                        field.area_id == area.id
                            && field.input
                            && field
                                .channels
                                .as_ref()
                                .is_some_and(|names| names.iter().any(|name| name == "Elevation"))
                            && field.footprint.is_some()
                    })
                    .and_then(|field| field.footprint.as_ref())
            })
            .unwrap_or(&area.footprint);
        let mut bounds = chart
            .compact_bounds(subject, spatial)
            .map_err(io::Error::other)?;
        if pinned.is_none() {
            let margin = (bounds.2 - bounds.0).max(bounds.3 - bounds.1) * 0.1;
            bounds = Bounds(
                bounds.0 - margin,
                bounds.1 - margin,
                bounds.2 + margin,
                bounds.3 + margin,
            );
        }
        bounds.1 = bounds.1.max(chart.bounds.1);
        bounds.3 = bounds.3.min(chart.bounds.3);
        if !chart.cylindrical {
            bounds.0 = bounds.0.max(chart.bounds.0);
            bounds.2 = bounds.2.min(chart.bounds.2);
        } else if bounds.2 - bounds.0 >= chart.bounds.2 - chart.bounds.0 {
            bounds.0 = chart.bounds.0;
            bounds.2 = chart.bounds.2;
        }
        chart
            .geometry(&rectangle(bounds), spatial)
            .map_err(io::Error::other)
    }
}
fn interior(
    area: &MappedArea,
    footprint: &Geometry,
    bounds: Bounds,
    span: f64,
    spatial: &dyn SpatialKernel,
) -> io::Result<Geometry> {
    let band = span
        .min((bounds.2 - bounds.0) / 4.0)
        .min((bounds.3 - bounds.1) / 4.0);
    let interior = if area.boundary.is_some()
        && ![Profile::Region, Profile::Local].contains(&area.area.profile)
    {
        spatial.buffer(footprint, -band).map_err(io::Error::other)?
    } else {
        Some(footprint.clone())
    };
    let interior = interior
        .ok_or_else(|| io::Error::other("Choose an extent with room for interior field samples"))?;
    if spatial.area(&interior).map_err(io::Error::other)? <= 0.0 {
        return Err(io::Error::other(
            "Choose an extent with room for interior field samples",
        ));
    }
    Ok(interior)
}
