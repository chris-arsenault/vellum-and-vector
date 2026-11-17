//! Biome provinces publish the class raster's margins, cut by the finished water outlines.
use super::{
    kinds::Kind,
    map_records::{self, MapState, PlaceRecord},
    values::Place,
};
use crate::{
    ecology::regions,
    features::{records::Attributes, Feature},
    field::{
        geographic_contours,
        geographic_regions::{self, Components},
        shared::CellCode,
        significance::{measure, LANDSCAPE_MINIMUM_AREA},
    },
    lattice::sampling::Sampler as MembershipSampler,
    reconstruction::{classes, Grid},
    spatial::Overlay,
    storage::{Band, ReadBand},
};
use atlas_map::Geometry;
use std::{io, rc::Rc};

pub trait LandscapeState: MapState {
    fn surface_grid(&self) -> &Grid;
    fn surface_active(&self) -> ReadBand<u8>;
    fn surface_samples(&self) -> ReadBand<i32>;
    fn surface_water_shapes(&self) -> Vec<Geometry>;
    fn retained_continental_domains(&self, count: usize);
}
pub fn is_family(state: &impl MapState, family: &str, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    Ok(field.water().column.kind.get(cell)? == 0
        && regions::family(field.shared.code(CellCode::BiomeCodes).get(cell)?) == Some(family))
}
pub fn places(
    state: &impl LandscapeState,
    kind: Kind,
    family: &str,
    rank: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<Vec<Place>> {
    Ok(state
        .held()
        .get(&format!("places:{}", kind.as_str()), || {
            let regions = geographic_regions::components(
                state,
                &|cell| is_family(state, family, cell),
                Components {
                    polygonal: false,
                    splits: true,
                },
                None,
            )?;
            if regions.retained_continental_domains > 0 {
                state.retained_continental_domains(regions.retained_continental_domains);
            }
            regions
                .regions
                .into_iter()
                .map(|region| {
                    let mut anchor = region.members[0];
                    for &cell in &region.members {
                        if rank(cell)? > rank(anchor)? {
                            anchor = cell;
                        }
                    }
                    Ok(Place::at(kind, anchor, region.members))
                })
                .collect::<io::Result<Vec<_>>>()
        })?
        .as_ref()
        .clone())
}
struct Labels {
    cells: Band<i32>,
    identities: Vec<String>,
}
fn labels(
    state: &impl LandscapeState,
    kind: Kind,
    places: impl FnOnce() -> io::Result<Vec<Place>>,
) -> io::Result<Rc<Labels>> {
    state.held().get(&format!("labels:{}", kind.as_str()), || {
        let mut cells = state.field()?.coverage.borrow_mut().allocate(-1);
        let mut identities = Vec::new();
        for (at, place) in places()?.into_iter().enumerate() {
            identities.push(place.id);
            for cell in place.cells {
                cells.set(cell, at as i32)?;
            }
        }
        Ok(Labels { cells, identities })
    })
}
struct Surface {
    codes: Band<f64>,
    water: Option<Geometry>,
    small_hole: f64,
}
fn surface(state: &impl LandscapeState) -> io::Result<Rc<Surface>> {
    state.held().get("landscape:surface", || {
        let field = state.field()?;
        let samples = state.surface_samples();
        let biome = field.shared.code(CellCode::BiomeCodes);
        let mut codes = field.coverage.borrow_mut().scratch(samples.len(), 0.0);
        for at in 0..samples.len() {
            let cell = usize::try_from(samples.get(at)?).map_err(io::Error::other)?;
            codes.set(at, biome.get(cell)? as f64)?;
        }
        let shapes = state.surface_water_shapes();
        let water = if shapes.is_empty() {
            None
        } else {
            state
                .spatial()
                .union_all(&shapes)
                .map_err(io::Error::other)?
        };
        Ok(Surface {
            codes,
            water,
            small_hole: measure(&field.scale, LANDSCAPE_MINIMUM_AREA, 2, 1.0)?,
        })
    })
}
fn extent(
    state: &impl LandscapeState,
    family: &str,
    place: &Place,
    labels: &Labels,
    surface: &Surface,
) -> io::Result<Option<Geometry>> {
    let field = state.field()?;
    let own = labels
        .identities
        .iter()
        .position(|id| *id == place.id)
        .map_or(-1, |at| at as i32);
    let class_surface = classes::Surface {
        support: None,
        grid: state.surface_grid(),
        values: surface.codes.read_only().into(),
        active: state.surface_active(),
        overlays: Vec::new(),
    };
    let mut margin = classes::Sampler::new(&class_surface, &field.coverage);
    let mut own_share = MembershipSampler::new(&field.mesh);
    let mut other_share = MembershipSampler::new(&field.mesh);
    let [ox, oy] = field.mesh.origin();
    let mut at = |point: [f64; 2]| {
        let class_margin =
            margin.sample(point, Some(&|code| regions::family(code) == Some(family)))?;
        let local = [point[0] - ox, point[1] - oy];
        let own_value =
            own_share.sample(local, |cell| Ok(f64::from(labels.cells.get(cell)? == own)))?;
        let other = other_share.sample(local, |cell| {
            let label = labels.cells.get(cell)?;
            Ok(f64::from(label >= 0 && label != own))
        })?;
        Ok(class_margin.min(own_value - other.max(0.1)))
    };
    let Some(shape) = geographic_contours::geographic(state, &place.cells, &mut at, 0.0)? else {
        return Ok(None);
    };
    let shape = geographic_contours::fill_small_holes(state, shape, surface.small_hole, &|cell| {
        Ok(field.water().column.kind.get(cell)? != 0)
    })?;
    let Some(shape) = geographic_contours::clip(state, Some(shape))? else {
        return Ok(None);
    };
    match &surface.water {
        None => Ok(Some(shape)),
        Some(water) => geographic_contours::area_geometry(
            state.spatial(),
            state
                .spatial()
                .overlay(&shape, water, Overlay::Difference)
                .map_err(io::Error::other)?,
        ),
    }
}
pub fn record(
    state: &impl LandscapeState,
    kind: Kind,
    family: &str,
    place: &Place,
    places: impl FnOnce() -> io::Result<Vec<Place>>,
) -> io::Result<Option<Feature>> {
    if place.cells.len() < super::records::MINIMUM_AREA_CELLS {
        return Ok(None);
    }
    let rules = state.held().get("landscape:rules", || {
        Ok(regions::rules(state.magic().as_deref().unwrap_or(&[])))
    })?;
    let Some(rule) = rules.iter().find(|rule| rule.kind == family) else {
        return Ok(None);
    };
    let labels = labels(state, kind, places)?;
    let surface = surface(state)?;
    let Some(extent) = extent(state, family, place, &labels, &surface)? else {
        return Ok(None);
    };
    let field = state.field()?;
    let summary = regions::summarize(field, &place.cells, state.magic().as_deref().unwrap_or(&[]))?;
    let name = rule.name(&summary, &field.scale)?;
    let mut attributes = Attributes::new();
    attributes.insert("sourceAlgorithm".into(), "atlas-world-geography-1".into());
    attributes.insert("biome".into(), name.into());
    attributes.insert(
        "system".into(),
        rule.system(&summary)
            .map_or(serde_json::Value::Null, Into::into),
    );
    for (key, value) in [
        ("treeCover", summary.broadleaf + summary.conifer),
        ("grassCover", summary.grass),
        ("wetlandCover", summary.wetland),
        ("temperature", summary.temperature),
        ("moisture", summary.moisture),
    ] {
        attributes.insert(key.into(), value.into());
    }
    map_records::place_feature(
        state,
        PlaceRecord {
            kind: family,
            name,
            members: &place.cells,
            layer: "ecology",
            attributes,
            extent: Some(extent),
            placement: None,
            relations: Vec::new(),
        },
    )
}
