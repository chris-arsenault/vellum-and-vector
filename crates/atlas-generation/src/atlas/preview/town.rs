//! Detached street and footprint geometry at completed town development boundaries.
use crate::publication::town::{street_name, TownWriter};
use crate::town::{
    catalogue::PlaceRules, fabric::Fabric, geometry::Point, settings::DEVELOPMENT_ROUNDS,
};
use atlas_map::{town::BuildingFunction, Geometry};
use serde::Serialize;
use std::io;

#[derive(Clone, Copy, Serialize)]
pub struct Stage {
    pub phase: &'static str,
    pub round: usize,
}

pub(crate) fn between(previous: &str, next: &str) -> Option<Stage> {
    let round = |path: &str| {
        path.strip_prefix("town/round-")?
            .split_once('/')?
            .0
            .parse::<usize>()
            .ok()
    };
    let completed = if let Some(index) = round(previous) {
        if round(next) == Some(index) {
            return None;
        }
        index + 1
    } else if previous.starts_with("town/") && round(next) == Some(0) {
        0
    } else {
        return None;
    };
    let phase = match completed {
        0 => "founding",
        1 => "early",
        n if n == DEVELOPMENT_ROUNDS / 2 => "middle",
        DEVELOPMENT_ROUNDS => "mature",
        _ => return None,
    };
    Some(Stage {
        phase,
        round: completed,
    })
}

#[derive(Serialize)]
pub struct Overview {
    pub stage: Stage,
    pub settlements: Vec<Settlement>,
    pub fields: Vec<Geometry>,
}
#[derive(Serialize)]
pub struct Settlement {
    key: String,
    name: String,
    centre: Point,
    streets: Vec<(Vec<Point>, Vec<f64>, bool)>,
    passages: Vec<Geometry>,
    footpaths: Vec<([Point; 2], f64)>,
    plots: Vec<Geometry>,
    buildings: Vec<(Geometry, BuildingFunction, Option<String>)>,
}
pub fn capture(fabric: &Fabric, stage: Stage, site: &impl TownWriter) -> io::Result<Overview> {
    let settlements = fabric
        .towns
        .iter()
        .map(|town| {
            let resolved = crate::town::addresses::assign(town, site.spatial())?;
            let names = (0..town.streets().len())
                .map(|i| street_name(site, town, i))
                .collect::<io::Result<Vec<_>>>()?;
            Ok(Settlement {
                key: town.seat.key.clone(),
                name: town.seat.name.clone(),
                centre: town.seat.centre,
                streets: town
                    .streets()
                    .iter()
                    .map(|s| (s.points.clone(), s.widths.clone(), s.through_route))
                    .collect(),
                passages: town.passages().to_vec(),
                footpaths: town
                    .footpaths()
                    .iter()
                    .map(|f| (f.points, f.width()))
                    .collect(),
                plots: town.holdings().iter().map(|h| h.outline.clone()).collect(),
                buildings: town
                    .holdings()
                    .iter()
                    .flat_map(|h| {
                        let definition = h.kind.definition();
                        let address = resolved[h.id.0 as usize]
                            .map(|a| crate::town::addresses::address(a.number, &names[a.street]));
                        h.buildings.iter().enumerate().map(move |(i, geometry)| {
                            (
                                geometry.clone(),
                                definition.building(i).function,
                                address.clone(),
                            )
                        })
                    })
                    .collect(),
            })
        })
        .collect::<io::Result<_>>()?;
    Ok(Overview {
        stage,
        settlements,
        fields: fabric.fields.iter().map(|f| f.outline.clone()).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_snapshot_observes_only_completed_town_rounds() {
        assert_eq!(
            between("town/initialize", "town/round-0/movement")
                .unwrap()
                .phase,
            "founding"
        );
        assert!(between("town/round-0/movement", "town/round-0/construction").is_none());
        assert_eq!(
            between("town/round-0/construction", "town/round-1/movement")
                .unwrap()
                .round,
            1
        );
        assert!(between("round-1/final-courses", "round-2/final-courses").is_none());
    }
    #[test]
    fn the_selected_town_sequence_emits_all_four_observations() {
        use crate::atlas::features::{Catalogue, Context, Policy, Selected, Selection};
        use crate::sequence::SequenceNode;
        let selection = Selection::from([(
            "built.layout".into(),
            Selected {
                enabled: true,
                ..Default::default()
            },
        )]);
        let context = Context {
            selection: &selection,
            policy: Policy::Regional,
            refinement: true,
            landmarks_apply: false,
            standalone_magic: false,
            initial: false,
            material: false,
            process: None,
        };
        let sequence = crate::atlas::town::sequence(&Catalogue::default(), &context).unwrap();
        let ids: Vec<_> = sequence
            .iter()
            .map(|node| match node {
                SequenceNode::Process { id, .. } | SequenceNode::Epochs { id, .. } => id.as_str(),
            })
            .collect();
        let snapshots: Vec<_> = ids
            .windows(2)
            .filter_map(|pair| between(pair[0], pair[1]))
            .map(|stage| stage.phase)
            .collect();
        assert_eq!(snapshots, ["founding", "early", "middle", "mature"]);
    }
}
