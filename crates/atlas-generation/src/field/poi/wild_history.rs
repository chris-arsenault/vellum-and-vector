use crate::{
    atlas::history::{Cause, EpochHistory},
    features::Feature,
    hpc::{BitSet, Direction, MultiKeyHeap},
    spatial::SpatialKernel,
};
use atlas_map::Geometry;
use std::io;

pub use crate::atlas::history::GeographicObservation as Observation;
pub trait WildHistory {
    fn latest_wild_observation(&self) -> &[Observation];
}
pub(super) struct WildPublication;
impl<S: super::map_records::MapState + WildHistory> super::contract::PublicationRecord<S>
    for WildPublication
{
    fn record(&self, state: &mut S, place: &super::values::Place) -> io::Result<Option<Feature>> {
        super::records::rule(state, place, "veil", "wild")
    }
    fn prepare_batch(
        &self,
        state: &S,
        records: &mut [(super::values::Place, Feature)],
    ) -> io::Result<()> {
        let current = records
            .iter()
            .map(|(_, feature)| Observation::from(feature))
            .collect::<Vec<_>>();
        let linked = link(state.spatial(), state.latest_wild_observation(), &current)?;
        for ((_, feature), observation) in records.iter_mut().zip(linked) {
            feature.id = observation.id;
            feature.name = observation.name;
        }
        Ok(())
    }
}
impl From<&Feature> for Observation {
    fn from(feature: &Feature) -> Self {
        Self {
            id: feature.id.clone(),
            name: feature.name.clone(),
            geometry: feature
                .footprint
                .as_ref()
                .unwrap_or(&feature.geometry)
                .clone(),
        }
    }
}
pub fn latest<'a>(history: &'a [EpochHistory], current: &'a [Cause]) -> &'a [Observation] {
    current
        .iter()
        .rev()
        .chain(
            history
                .iter()
                .rev()
                .flat_map(|epoch| epoch.causes.iter().rev()),
        )
        .find_map(|cause| match cause {
            Cause::Geography {
                feature_kind,
                observations,
                ..
            } if feature_kind == "veil:wild" => Some(observations.as_slice()),
            _ => None,
        })
        .unwrap_or(&[])
}
pub fn observe(
    state: &(impl super::map_records::MapState + super::realized::RealizationState),
    epoch_indices: &[usize],
) -> io::Result<Vec<Observation>> {
    use crate::field::{
        geographic_regions::{self, Components},
        region_evidence::region_evidence,
        significance,
    };
    let Some(magic) = super::reads::magic_field(state, "veil") else {
        return Ok(Vec::new());
    };
    let Some(index) = magic
        .definition()
        .features
        .iter()
        .position(|rule| rule.id == "wild")
    else {
        return Ok(Vec::new());
    };
    let (members, coverage) = magic.feature(index);
    let includes = |cell| Ok(members.get(cell)? > 0.0 && coverage.get(cell)? > 0.0);
    let regions = geographic_regions::components(
        state,
        &includes,
        Components {
            polygonal: false,
            splits: false,
        },
        None,
    )?;
    let field = state.field()?;
    let extent = state.extent()?;
    let path = epoch_indices
        .iter()
        .map(usize::to_string)
        .collect::<Vec<_>>()
        .join(":");
    let mut observed = Vec::new();
    for region in regions.regions {
        let mut same = BitSet::new(field.mesh.len());
        for &cell in &region.members {
            same.add(cell);
        }
        let evidence = region_evidence(
            field,
            &region.members,
            |cell| coverage.get(cell),
            |cell| same.has(cell),
        )?;
        if !significance::landscape(&extent, "magic", &evidence, &field.scale)?.publish {
            continue;
        }
        let Some(&anchor) = region.members.first() else {
            continue;
        };
        let place = super::values::Place::at(super::kinds::Kind::WildZone, anchor, region.members);
        let Some(feature) = super::records::rule(state, &place, "veil", "wild")? else {
            continue;
        };
        let geometry = feature.footprint.unwrap_or(feature.geometry);
        if !matches!(
            geometry,
            Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
        ) {
            continue;
        }
        observed.push(Observation {
            id: crate::identity::area_record_id(
                state.world_id(),
                false,
                state.area_id(),
                &format!("wild-survey:{path}:{}", feature.id),
            ),
            name: feature.name,
            geometry,
        });
    }
    Ok(observed)
}
/// An empty completed survey is retained because it ends the previous geographic lineage.
pub fn record(
    state: &(impl super::map_records::MapState + super::realized::RealizationState),
    history: &[EpochHistory],
    current: &[Cause],
    physical_epoch: Option<usize>,
    epoch_indices: &[usize],
) -> io::Result<Option<Cause>> {
    if physical_epoch.is_none() {
        return Ok(None);
    }
    Ok(Some(Cause::Geography {
        process: "atlas.magic-history".into(),
        feature_kind: "veil:wild".into(),
        observations: link(
            state.spatial(),
            latest(history, current),
            &observe(state, epoch_indices)?,
        )?,
    }))
}
/// Largest overlapping successor keeps the identity; a split cannot duplicate it.
pub fn link(
    kernel: &dyn SpatialKernel,
    previous: &[Observation],
    current: &[Observation],
) -> io::Result<Vec<Observation>> {
    let shapes = previous
        .iter()
        .map(|p| p.geometry.clone())
        .collect::<Vec<_>>();
    let index = kernel.index(&shapes).map_err(io::Error::other)?;
    let mut matches = Vec::new();
    let mut ranked = MultiKeyHeap::new(
        [
            Direction::Descending,
            Direction::Ascending,
            Direction::Ascending,
        ],
        Direction::Ascending,
    );
    for (after, observation) in current.iter().enumerate() {
        let candidates = index
            .query(
                kernel
                    .bounds(&observation.geometry)
                    .map_err(io::Error::other)?,
            )
            .map_err(io::Error::other)?;
        let candidates_shapes = candidates
            .iter()
            .map(|&before| shapes[before].clone())
            .collect::<Vec<_>>();
        let areas = kernel
            .intersection_areas(&observation.geometry, &candidates_shapes)
            .map_err(io::Error::other)?;
        for (before, area) in candidates.into_iter().zip(areas) {
            if area > 0.0 {
                ranked.push(matches.len() as u32, [area, before as f64, after as f64]);
                matches.push((before, after));
            }
        }
    }
    let mut used_before = BitSet::new(previous.len());
    let mut used_after = BitSet::new(current.len());
    let mut result = current.to_vec();
    while let Some((at, _)) = ranked.pop() {
        let (before, after) = matches[at as usize];
        if used_before.has(before) || used_after.has(after) {
            continue;
        }
        used_before.add(before);
        used_after.add(after);
        result[after].id.clone_from(&previous[before].id);
        result[after].name.clone_from(&previous[before].name);
    }
    Ok(result)
}
