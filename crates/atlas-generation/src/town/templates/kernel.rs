use super::AnchorRole;
use crate::town::catalogue::Kind;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tenure {
    #[default]
    Household,
    Common,
    Institutional,
    Dependent,
}

impl Tenure {
    /// A neighbor making a unilateral land claim cannot alienate a common
    /// still held in use by its members. Lapsed common ground may change hands.
    pub(crate) fn permits_neighbor_claim(self, occupied: f64, condition: f64) -> bool {
        self != Self::Common || occupied <= 0. || condition <= 0.2
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Habitat {
    #[default]
    Ground,
    Upper,
    Lower,
    Floating,
    Submerged,
}

impl AnchorRole {
    pub(crate) fn supports(self, habitat: Habitat) -> bool {
        match self {
            Self::Afloat => habitat == Habitat::Floating,
            Self::Submerged => habitat == Habitat::Submerged,
            _ => true,
        }
    }
}

impl super::SiteEvidence {
    /// A household founds near the kernel along an approach that may reach the map edge.
    pub(crate) fn founding_point(
        &self,
        role: AnchorRole,
        reach: f64,
    ) -> Option<crate::town::geometry::Point> {
        use crate::town::geometry::{add, distance, scale, sub, unit};
        let point = self.point(role)?;
        if matches!(role, AnchorRole::FirstApproach | AnchorRole::LastApproach) {
            let heading = unit(sub(point, self.centre));
            return Some(add(
                self.centre,
                scale(heading, distance(point, self.centre).min(reach)),
            ));
        }
        Some(point)
    }
}

#[derive(Clone, Copy, Debug)]
pub enum FounderUse {
    Household,
    Livelihood,
    Place(Kind),
}

#[derive(Clone, Copy, Debug)]
pub struct Founder {
    pub anchor: AnchorRole,
    pub use_: FounderUse,
    pub tenure: Tenure,
    pub habitat: Habitat,
}
pub(super) const fn household(anchor: AnchorRole, habitat: Habitat, tenure: Tenure) -> Founder {
    Founder {
        anchor,
        use_: FounderUse::Household,
        tenure,
        habitat,
    }
}
pub(super) const fn work(
    anchor: AnchorRole,
    use_: FounderUse,
    tenure: Tenure,
    habitat: Habitat,
) -> Founder {
    Founder {
        anchor,
        use_,
        tenure,
        habitat,
    }
}
