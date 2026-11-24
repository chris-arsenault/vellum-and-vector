//! District roles use the same charter rights, site affinity and kernel as later Street development.
use super::{Selection, Tenure};
use crate::town::{catalogue::Activity, geometry::Point};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) enum Role {
    Tenements,
    Estates,
    Exchange,
    Workshops,
    Civic,
    Fortified,
}
impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Self::Tenements => "Tenement ward",
            Self::Estates => "Garden estates",
            Self::Exchange => "Exchange quarter",
            Self::Workshops => "Artisans' quarter",
            Self::Civic => "Institutional precinct",
            Self::Fortified => "Citadel ward",
        }
    }
    fn activity(self) -> Activity {
        match self {
            Self::Tenements | Self::Estates => Activity::Household,
            Self::Workshops => Activity::Production,
            Self::Exchange => Activity::Trade,
            Self::Civic | Self::Fortified => Activity::Institution,
        }
    }
}

impl Selection {
    pub(crate) fn district_affinity(&self, role: Role, at: Point) -> f64 {
        let activity = role.activity();
        if role == Role::Estates
            && matches!(
                self.tenure(activity, at, self.quarter()),
                Tenure::Common | Tenure::Dependent
            )
        {
            return 0.;
        }
        self.affinity(activity, at, self.quarter()).max(0.)
    }
}
