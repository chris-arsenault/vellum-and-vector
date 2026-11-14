use super::{
    map_records::{place_feature, MapState, PlaceRecord, Placement},
    place_geometry, reads,
    values::Place,
    water_reads,
};
use crate::{
    features::{records::Attributes, Feature},
    field::{
        geographic_contours::ReadCell,
        geographic_regions::{self, Components},
        region_evidence::region_evidence,
        significance::{self, Extent},
    },
    magic::{channels::Channel, configuration::Cartography, confluences, state::MagicField},
};
use std::io;

pub struct Shape<'a> {
    pub kind: &'a str,
    pub layer: &'a str,
    pub name: &'a str,
    pub attributes: Attributes,
}
pub const MINIMUM_SITE_CELLS: usize = 1;
pub const MINIMUM_COURSE_CELLS: usize = 2;
pub const MINIMUM_AREA_CELLS: usize = 3;
pub fn area(
    state: &impl MapState,
    place: &Place,
    shape: Shape<'_>,
    weight: Option<ReadCell<'_>>,
) -> io::Result<Option<Feature>> {
    if place.cells.len() < MINIMUM_AREA_CELLS {
        return Ok(None);
    }
    let Some(extent) = geographic_regions::outline(state, &place.cells, weight)? else {
        return Ok(None);
    };
    place_feature(
        state,
        PlaceRecord {
            kind: shape.kind,
            name: shape.name,
            members: &place.cells,
            layer: shape.layer,
            attributes: shape.attributes,
            extent: Some(extent),
            placement: None,
            relations: Vec::new(),
        },
    )
}
pub fn course(
    state: &impl MapState,
    place: &Place,
    shape: Shape<'_>,
) -> io::Result<Option<Feature>> {
    if place.cells.len() < MINIMUM_COURSE_CELLS {
        return Ok(None);
    }
    let Some(geometry) = place_geometry::linked_course(
        state,
        &place.cells,
        |cell| water_reads::flow_target(state.field()?, cell),
        true,
    )?
    else {
        return Ok(None);
    };
    place_feature(
        state,
        PlaceRecord {
            kind: shape.kind,
            name: shape.name,
            members: &place.cells,
            layer: shape.layer,
            attributes: shape.attributes,
            extent: None,
            relations: Vec::new(),
            placement: Some(Placement {
                geometry,
                anchor: place.anchor,
                meaning: "incised drainage course",
            }),
        },
    )
}
fn rule_attributes(
    state: &impl MapState,
    field: &MagicField,
    rule: &str,
    place: &Place,
) -> io::Result<Attributes> {
    let mesh = &state.field()?.mesh;
    let (mut area, mut maximum, mut activity) = (0.0, 0.0f64, 0.0);
    let intensity = field.channel(Channel::Intensity);
    let history = field.channel(Channel::History);
    for &cell in &place.cells {
        let size = mesh.area(cell);
        area += size;
        maximum = maximum.max(intensity.get(cell)?);
        activity += history.get(cell)? * size;
    }
    let mut attributes = Attributes::new();
    attributes.insert("system".into(), field.definition().id.clone().into());
    attributes.insert("rule".into(), rule.into());
    attributes.insert("maximumIntensity".into(), maximum.into());
    attributes.insert("accumulatedActivity".into(), (activity / area).into());
    Ok(attributes)
}
pub fn rule(
    state: &impl MapState,
    place: &Place,
    system: &str,
    rule: &str,
) -> io::Result<Option<Feature>> {
    let Some(field) = reads::magic_field(state, system) else {
        return Ok(None);
    };
    let Some((index, definition)) = field
        .definition()
        .features
        .iter()
        .enumerate()
        .find(|(_, feature)| feature.id == rule)
    else {
        return Ok(None);
    };
    let cartography = definition.cartography.unwrap_or(Cartography::Area);
    let minimum = match cartography {
        Cartography::Area => MINIMUM_AREA_CELLS,
        Cartography::Site => MINIMUM_SITE_CELLS,
        Cartography::Course => MINIMUM_COURSE_CELLS,
    };
    if place.cells.len() < minimum {
        return Ok(None);
    }
    let coverage = field.feature(index).1;
    let extent =
        geographic_regions::outline(state, &place.cells, Some(&|cell| coverage.get(cell)))?;
    let placement = extent
        .as_ref()
        .map(|extent| place_geometry::magic_place(state, &field, definition, &place.cells, extent))
        .transpose()?
        .flatten();
    if matches!(cartography, Cartography::Course) && placement.is_none() {
        return Ok(None);
    }
    place_feature(
        state,
        PlaceRecord {
            kind: &format!("{system}:{rule}"),
            name: &definition.name,
            members: &place.cells,
            layer: "magic",
            attributes: rule_attributes(state, &field, rule, place)?,
            extent,
            placement,
            relations: Vec::new(),
        },
    )
}
/// Meetings remain processes between systems, with their own feature identities and coverage.
pub fn confluence_records(
    state: &impl MapState,
    workspace: &confluences::Workspace,
    extent: &Extent,
) -> io::Result<Vec<Feature>> {
    let mut features = Vec::new();
    for held in &workspace.states {
        let definition = &workspace.definitions[held.definition];
        let weight = |cell| held.coverage.get(cell);
        let regions = geographic_regions::components(
            state,
            &|cell| Ok(held.members.get(cell)? != 0.0 && held.coverage.get(cell)? > 0.0),
            Components {
                polygonal: true,
                splits: false,
            },
            Some(&weight),
        )?;
        for region in regions.regions {
            if region.members.len() < MINIMUM_AREA_CELLS {
                continue;
            }
            let evidence = region_evidence(state.field()?, &region.members, weight, |_| true)?;
            if !significance::landscape(extent, "magic", &evidence, &state.field()?.scale)?.publish
            {
                continue;
            }
            let mut mean = 0.0;
            let mut strain = 0.0f64;
            for &cell in &region.members {
                mean += held.coverage.get(cell)?;
                strain = strain.max(workspace.strain.get(cell)?);
            }
            let mut attributes = Attributes::new();
            attributes.insert("system".into(), "confluence".into());
            attributes.insert("rule".into(), definition.rule.id.clone().into());
            attributes.insert("systems".into(), definition.systems.join(",").into());
            attributes.insert(
                "meanCoverage".into(),
                (mean / region.members.len().max(1) as f64).into(),
            );
            attributes.insert("maximumStrain".into(), strain.into());
            if let Some(feature) = place_feature(
                state,
                PlaceRecord {
                    kind: &format!("confluence:{}", definition.rule.id),
                    name: &definition.rule.name,
                    members: &region.members,
                    layer: "magic",
                    attributes,
                    extent: region.geometry,
                    placement: None,
                    relations: Vec::new(),
                },
            )? {
                features.push(feature);
            }
        }
    }
    Ok(features)
}
