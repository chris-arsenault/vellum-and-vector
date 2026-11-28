use super::{Definition, Kind};
use crate::{
    chance::Chance,
    town::{
        geometry::{angle, sub, Point},
        templates::SiteEvidence,
    },
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub(super) enum Axis {
    Free,
    Approach,
    Facing,
    Waterfront,
    Cardinal,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub(crate) enum Station {
    Land,
    Water,
    FarLand,
    FarWater,
}
impl Station {
    pub(crate) fn wet(self) -> bool {
        matches!(self, Self::Water | Self::FarWater)
    }
    pub(crate) fn remote(self) -> bool {
        matches!(self, Self::FarLand | Self::FarWater)
    }
}
#[derive(Clone, Copy)]
pub(crate) struct Role {
    pub label: &'static str,
    pub use_: Kind,
    pub frontage: f64,
    pub depth: f64,
    pub station: Station,
}
pub(super) struct Program {
    pub label: &'static str,
    pub layout: Layout,
    pub grounds: &'static str,
    pub primary: Role,
    pub support: Role,
}
#[derive(Clone, Copy)]
pub(super) enum Layout {
    Spine,
    Court,
    Cloister,
    Terrace,
}
impl Layout {
    /// Layout coordinates are parcel entrances. Depth grows away from the entrance.
    fn offset(self, i: usize, step: f64, width: f64) -> Point {
        if i == 0 {
            return [0., 0.];
        }
        let i = i as f64;
        match self {
            Self::Spine => [i * step, 0.],
            Self::Terrace => [i * step * 0.8, i * width * 0.5],
            Self::Court => {
                let corners = [[1., 0.], [1., -1.], [0., -1.], [-1., -1.], [-1., 0.]];
                let [x, y] = corners[(i as usize - 1) % corners.len()];
                [x * step, y * width * 1.65]
            }
            Self::Cloister => {
                let turn = i * std::f64::consts::PI / 3.;
                [turn.sin() * step, (turn.cos() - 1.) * width]
            }
        }
    }
    fn grounds(self, span: f64, width: f64) -> Vec<Point> {
        let shape: &[[f64; 2]] = match self {
            Self::Spine => &[[-0.13, -0.19], [1., -0.19], [1., -0.06], [-0.13, -0.06]],
            Self::Court => &[
                [0.12, -0.16],
                [0.83, -0.16],
                [0.86, -0.52],
                [0.70, -0.67],
                [0.14, -0.59],
            ],
            Self::Terrace => &[
                [0., -0.25],
                [0.35, -0.25],
                [0.35, 0.13],
                [0.68, 0.13],
                [0.68, 0.57],
                [1., 0.57],
                [1., 0.71],
                [0.6, 0.71],
                [0.6, 0.27],
                [0.28, 0.27],
                [0.28, -0.1],
                [0., -0.1],
            ],
            Self::Cloister => &[
                [-0.23, -0.24],
                [0., -0.46],
                [0.40, -0.48],
                [0.58, -0.25],
                [0.58, 0.12],
                [0.50, 0.12],
                [0.50, -0.19],
                [0.37, -0.36],
                [0.05, -0.35],
                [-0.17, -0.15],
            ],
        };
        shape.iter().map(|&[x, y]| [x * span, y * width]).collect()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Part {
    pub label: String,
    pub use_: Kind,
    pub offset: Point,
    pub frontage: f64,
    pub depth: f64,
    pub station: Station,
}
/// The chosen program and parcel design are carried across refinement and checkpoints.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkDesign {
    program: String,
    pub(crate) parts: Vec<Part>,
    grounds: String,
    pub(crate) reserve: Vec<Point>,
    pub bearing: f64,
}
impl WorkDesign {
    pub fn program(&self) -> &str {
        &self.program
    }
    pub fn component_count(&self) -> usize {
        self.parts.len()
    }
    pub fn component_label(&self, i: usize) -> &str {
        &self.parts[i].label
    }
    pub fn grounds_label(&self) -> &str {
        &self.grounds
    }
}

// A major work keeps its real size at every fidelity: its roles' frontages and depths are
// true metres and are never resolved through a town's scale.
impl Definition {
    pub(crate) fn sponsor_reach(&self) -> f64 {
        self.core
            .iter()
            .map(|r| r.frontage + r.depth)
            .fold(0., f64::max)
            * 3.
    }
    pub(crate) fn sites(&self, site: &SiteEvidence, story: &super::Story) -> Vec<Point> {
        let Some(principal) = (self.locate)(site, story) else {
            return vec![];
        };
        let mut sites = vec![principal];
        for p in (self.additional_sites)(site) {
            if sites
                .iter()
                .all(|&q| crate::town::geometry::distance(q, p) > self.sponsor_reach())
            {
                sites.push(p);
            }
        }
        sites
    }
    pub(crate) fn design(
        &self,
        site: &SiteEvidence,
        anchor: Point,
        sponsors: &[Kind],
        seed: i32,
    ) -> WorkDesign {
        let draw = |n: i32| {
            Chance::of(seed.wrapping_add(n.wrapping_mul(0x3537)), 0).unit([anchor[0], anchor[1]])
        };
        // An existing practice can sponsor a wing; a commission can also establish a new one.
        let relevance = |role: &Role| sponsors.iter().any(|k| k.same_family(role.use_));
        let weights: Vec<_> = self
            .programs
            .iter()
            .map(|p| 1. + 2. * f64::from(relevance(&p.primary)) + f64::from(relevance(&p.support)))
            .collect();
        let mut ticket = draw(1) * weights.iter().sum::<f64>();
        let choice = weights
            .iter()
            .position(|w| {
                ticket -= w;
                ticket < 0.
            })
            .unwrap_or(weights.len() - 1);
        let program = &self.programs[choice];
        let mut roles = self.core.to_vec();
        roles.push(program.primary);
        if draw(2) < 0.62 || relevance(&program.support) {
            roles.push(program.support);
        }
        let annex = &self.programs[(choice + 1 + usize::from(draw(3) > 0.5)) % self.programs.len()];
        if draw(4) < 0.32 || relevance(&annex.primary) {
            roles.push(annex.primary);
        }
        let step = (57. + 40. * draw(5)) * if site.upper.is_some() { 0.9 } else { 1. };
        let width = 58. + 49. * draw(6);
        let parts = roles
            .into_iter()
            .enumerate()
            .map(|(i, r)| {
                let n = i as i32 * 3 + 24;
                Part {
                    label: r.label.into(),
                    use_: r.use_,
                    offset: program.layout.offset(i, step, width),
                    frontage: r.frontage * (0.77 + 0.52 * draw(n)),
                    depth: r.depth * (0.78 + 0.58 * draw(n + 1)),
                    station: r.station,
                }
            })
            .collect::<Vec<_>>();
        let span = match program.layout {
            Layout::Spine | Layout::Terrace => (parts.len() - 1) as f64 * step,
            _ => step,
        };
        WorkDesign {
            program: program.label.into(),
            grounds: program.grounds.into(),
            reserve: program.layout.grounds(span, width),
            parts,
            bearing: self.bearing(site, anchor, draw(7)),
        }
    }
    fn bearing(&self, site: &SiteEvidence, anchor: Point, draw: f64) -> f64 {
        let directed = |p: Point| (p != anchor).then(|| angle(sub(p, anchor)));
        let partner = (self.counterpart)(site).and_then(directed);
        let approach = site.approaches.first().copied().and_then(directed);
        let bearing = match self.axis {
            Axis::Free => None,
            Axis::Cardinal => Some(std::f64::consts::FRAC_PI_2),
            Axis::Approach => approach,
            Axis::Facing => partner.or(approach),
            Axis::Waterfront => partner.map(|a| a + std::f64::consts::FRAC_PI_2),
        };
        bearing.unwrap_or(draw * std::f64::consts::TAU)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::major_works::WorkFamily;
    use std::collections::BTreeSet;

    #[test]
    fn each_metatype_generates_different_operating_programs_and_ground_plans() {
        let site = SiteEvidence::default();
        for &family in WorkFamily::ALL {
            let mut programs = BTreeSet::new();
            let mut uses = Vec::new();
            let mut shapes = BTreeSet::new();
            let mut sizes = BTreeSet::new();
            for seed in 0..48 {
                let design = family.definition().design(&site, [0., 0.], &[], seed);
                programs.insert(design.program().to_owned());
                let use_list = design.parts.iter().map(|p| p.use_).collect::<Vec<_>>();
                if !uses.contains(&use_list) {
                    uses.push(use_list);
                }
                shapes.insert(design.reserve.len());
                sizes.insert(design.component_count());
            }
            assert!(programs.len() >= 3, "{family:?} programs");
            assert!(
                uses.len() > programs.len(),
                "{family:?} optional facilities"
            );
            assert!(shapes.len() > 1, "{family:?} reserved ground");
            assert!(sizes.len() > 1, "{family:?} premises count");
        }
    }
}
