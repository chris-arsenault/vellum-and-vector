//! Captured parent water context. These records belong to generation, not the map reader.
use super::balance::MONTHS;
use atlas_map::Position;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetainedRiver {
    pub id: usize,
    pub course: Vec<Position>,
    pub junction: Option<Position>,
    pub downstream: Option<usize>,
    pub order: u16,
    pub flow: f64,
    pub least: f64,
    pub flood: f64,
    pub months: usize,
    pub dry: bool,
    pub drawn: bool,
    pub dried_in: Option<f64>,
    pub former: Vec<FormerCourse>,
    pub monthly: Vec<f64>,
    pub catchment: Vec<f64>,
    pub bed: Vec<f64>,
    pub width: Vec<f64>,
    pub depth: Vec<f64>,
    pub leakage: Vec<f64>,
    pub river: Option<String>,
    pub record: Option<String>,
    pub name: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormerCourse {
    pub course: Vec<Position>,
    pub left_in: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundaryEntry {
    pub position: Position,
    pub monthly: [f64; MONTHS],
    pub catchment: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetainedNetwork {
    pub next: usize,
    pub reaches: Vec<RetainedRiver>,
    pub entries: Vec<BoundaryEntry>,
}
/// Current cartographic drainage is also a valid generation input, when retained state is absent.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DrainageReach {
    pub downstream: Option<usize>,
    pub water_body: Option<usize>,
    pub order: u16,
    pub basin: i32,
    pub coordinates: Vec<Position>,
    pub discharges: Vec<f64>,
    pub catchment_areas: Vec<f64>,
    pub feature_ids: Vec<atlas_map::Id>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DrainageNetwork {
    pub area_id: atlas_map::Id,
    pub space_id: atlas_map::Id,
    pub reaches: Vec<DrainageReach>,
    pub kept: Option<RetainedNetwork>,
    pub input: bool,
}
pub struct RiverIdentity {
    pub river: Option<String>,
    pub name: Option<String>,
}
impl DrainageNetwork {
    pub(super) fn inputs(
        &self,
        feature: &impl Fn(atlas_map::Id) -> Option<RiverIdentity>,
    ) -> Vec<RetainedRiver> {
        if let Some(kept) = &self.kept {
            return kept.reaches.clone();
        }
        self.reaches
            .iter()
            .enumerate()
            .map(|(at, reach)| {
                let junction = reach
                    .downstream
                    .and_then(|id| self.reaches.get(id))
                    .and_then(|receiver| receiver.coordinates.first())
                    .copied()
                    .filter(|receiver| {
                        reach
                            .coordinates
                            .last()
                            .is_some_and(|end| same_xy(*end, *receiver))
                    });
                let count = reach.coordinates.len() - usize::from(junction.is_some());
                let discharges = &reach.discharges[..count.min(reach.discharges.len())];
                let flow = discharges.last().copied().unwrap_or(0.0);
                let identity = reach.feature_ids.first().and_then(|&id| feature(id));
                RetainedRiver {
                    id: at + 1,
                    course: reach.coordinates[..count].to_vec(),
                    junction,
                    downstream: reach.downstream.map(|id| id + 1),
                    order: reach.order,
                    flow,
                    least: flow,
                    flood: flow,
                    months: MONTHS,
                    dry: false,
                    drawn: !reach.feature_ids.is_empty(),
                    dried_in: None,
                    former: Vec::new(),
                    monthly: discharges.iter().flat_map(|&flow| [flow; MONTHS]).collect(),
                    catchment: reach.catchment_areas.iter().take(count).copied().collect(),
                    bed: Vec::new(),
                    width: Vec::new(),
                    depth: Vec::new(),
                    leakage: Vec::new(),
                    river: identity
                        .as_ref()
                        .and_then(|i| i.river.clone())
                        .or_else(|| reach.feature_ids.first().map(ToString::to_string)),
                    name: identity.and_then(|i| i.name),
                    record: None,
                }
            })
            .collect()
    }
}
pub(super) fn same_xy(a: Position, b: Position) -> bool {
    a.coordinates()[..2] == b.coordinates()[..2]
}
impl RetainedRiver {
    /// The extra confluence vertex carries the tributary's outgoing profile, not receiver water.
    pub fn directed(&self) -> Option<Self> {
        let mut output = self.clone();
        if let (Some(&last), Some(junction)) = (self.course.last(), self.junction) {
            if !same_xy(last, junction) {
                output.course.push(junction);
                let at = self.course.len() - 1;
                output
                    .monthly
                    .extend(self.monthly.iter().skip(at * MONTHS).take(MONTHS));
                for (target, source) in [
                    (&mut output.catchment, &self.catchment),
                    (&mut output.bed, &self.bed),
                    (&mut output.width, &self.width),
                    (&mut output.depth, &self.depth),
                    (&mut output.leakage, &self.leakage),
                ] {
                    if !source.is_empty() {
                        target.push(source.get(at).copied().unwrap_or(f64::NAN));
                    }
                }
            }
        }
        (output.course.len() >= 2).then_some(output)
    }
}
