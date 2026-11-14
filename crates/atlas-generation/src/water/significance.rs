//! The same river-course judgment serves establishment and map publication.
use super::{captured::DrainageReach, network::RiverSizes};
use crate::scale::{LengthUnit, MapScale, RelativeMeasure};
pub const RIVER_LENGTH: f64 = 0.05;
pub const OUTLET_DISCHARGE: f64 = 2.34375e-17;
pub struct RiverEvidence {
    pub discharge: f64,
    pub catchment: f64,
    pub length: f64,
    pub outlet: bool,
}
pub struct CourseJudgment {
    pub course: Vec<usize>,
    pub evidence: RiverEvidence,
    pub publish: bool,
}
pub struct RiverSignificance {
    sizes: RiverSizes,
    length: f64,
    outlet_discharge: f64,
}
impl RiverSignificance {
    pub fn at(scale: &MapScale) -> Result<Self, &'static str> {
        Ok(Self {
            sizes: RiverSizes::at(scale)?,
            length: scale
                .resolve(RelativeMeasure::length(RIVER_LENGTH)?)?
                .value(),
            outlet_discharge: scale
                .resolve(RelativeMeasure::new(
                    OUTLET_DISCHARGE,
                    3,
                    1.0,
                    LengthUnit::Metre,
                )?)?
                .value(),
        })
    }
    pub fn publish(&self, e: &RiverEvidence) -> bool {
        e.discharge >= self.sizes.discharge
            && e.catchment >= self.sizes.catchment
            && (e.length >= self.length || (e.outlet && e.discharge >= self.outlet_discharge))
    }
    pub fn shortfalls(&self, e: &RiverEvidence) -> Vec<&'static str> {
        let mut failed = Vec::new();
        if e.discharge < self.sizes.discharge {
            failed.push("discharge");
        }
        if e.catchment < self.sizes.catchment {
            failed.push("catchment");
        }
        if e.length < self.length && (!e.outlet || e.discharge < self.outlet_discharge) {
            failed.push("length");
        }
        failed
    }
}
fn contribution(reach: &DrainageReach) -> (f64, f64) {
    let end = reach.coordinates.len().saturating_sub(2);
    (
        reach.discharges.get(end).copied().unwrap_or(0.0),
        reach.catchment_areas.get(end).copied().unwrap_or(0.0),
    )
}
fn length(reach: &DrainageReach) -> f64 {
    reach
        .coordinates
        .windows(2)
        .map(|edge| {
            let a = edge[0].coordinates();
            let b = edge[1].coordinates();
            (b[0] - a[0]).hypot(b[1] - a[1])
        })
        .sum()
}
pub fn course_judgments(
    reaches: &[DrainageReach],
    scale: &MapScale,
) -> Result<Vec<CourseJudgment>, &'static str> {
    let rule = RiverSignificance::at(scale)?;
    let mut continuation: Vec<Option<usize>> = vec![None; reaches.len()];
    for (at, reach) in reaches.iter().enumerate() {
        let Some(next) = reach
            .downstream
            .filter(|&next| next != at && next < reaches.len())
        else {
            continue;
        };
        if continuation[next]
            .is_none_or(|held| contribution(reach).0 > contribution(&reaches[held]).0)
        {
            continuation[next] = Some(at);
        }
    }
    let mut visited = vec![false; reaches.len()];
    let mut judgments = Vec::new();
    for (end, reach) in reaches.iter().enumerate() {
        if reach
            .downstream
            .is_some_and(|next| continuation.get(next).copied().flatten() == Some(end))
        {
            continue;
        }
        let mut course = Vec::new();
        let mut current = Some(end);
        while let Some(at) = current.filter(|&at| !visited[at]) {
            visited[at] = true;
            course.push(at);
            current = continuation[at];
        }
        course.reverse();
        let (discharge, catchment) = contribution(reach);
        let evidence = RiverEvidence {
            discharge,
            catchment,
            length: course.iter().map(|&at| length(&reaches[at])).sum(),
            outlet: reach.water_body.is_some(),
        };
        let publish = rule.publish(&evidence);
        judgments.push(CourseJudgment {
            course,
            evidence,
            publish,
        });
    }
    Ok(judgments)
}
