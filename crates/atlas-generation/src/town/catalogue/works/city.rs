use super::WorkFamily;

/// Candidate qualities relative to the other habitable ground in this city.
#[derive(Clone, Copy, Default)]
pub(crate) struct CitySite {
    pub height: f64,
    pub slope: f64,
    pub built: f64,
    pub access: f64,
    pub woods: f64,
    pub flood: f64,
    pub salt: f64,
    pub shore: bool,
    pub lake: bool,
    pub near_door: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_steep_face_and_open_level_high_ground_offer_different_commissions() {
        let summit = CitySite {
            height: 1.,
            ..Default::default()
        };
        let face = CitySite {
            slope: 0.9,
            ..summit
        };
        assert!(
            WorkFamily::Observatory.suitability(summit) > WorkFamily::Observatory.suitability(face)
        );
        assert!(
            WorkFamily::RockMonument.suitability(face)
                > WorkFamily::RockMonument.suitability(summit)
        );
        assert_ne!(
            WorkFamily::Observatory.influence(),
            WorkFamily::RockMonument.influence()
        );
    }
}

impl WorkFamily {
    pub(crate) fn demands(self) -> crate::town::templates::district::Demands {
        use crate::town::templates::district::Demands;
        match self {
            Self::Observatory | Self::SacredGrove => Demands {
                commons: 1.,
                gardens: 0.8,
                ..Default::default()
            },
            Self::Shipyard | Self::Floodworks => Demands {
                workshops: 1.5,
                access: 0.9,
                ..Default::default()
            },
            Self::SoundingStation | Self::ThermalRefuge => Demands {
                workshops: 0.6,
                access: 0.5,
                ..Default::default()
            },
            Self::Palace | Self::RockMonument | Self::SaltMemorial => Demands {
                access: 1.3,
                civic: 0.8,
                ..Default::default()
            },
            Self::PortalHostel | Self::FloatingHall => Demands {
                trade: 1.,
                access: 1.5,
                ..Default::default()
            },
            Self::Sanctuary | Self::LakeSanctuary | Self::Library => Demands {
                civic: 1.,
                access: 0.6,
                ..Default::default()
            },
            Self::Prison => Demands {
                civic: 0.55,
                access: -0.5,
                ..Default::default()
            },
        }
    }
    pub(crate) fn suitability(self, s: CitySite) -> f64 {
        let open = 1. / (1. + 4. * s.built);
        let level = 1. - s.slope;
        match self {
            Self::Observatory => open * level * (0.1 + s.height).powi(2),
            Self::RockMonument => (0.1 + s.height) * s.slope * (0.3 + s.access),
            Self::Palace => (0.4 + s.height) * (0.2 + s.access) * (0.2 + s.built),
            Self::Library => level * (0.3 + s.built) * (0.3 + s.access),
            Self::Sanctuary => (0.4 + open) * (0.2 + s.access),
            Self::Prison => (0.2 + s.height) * (0.4 + open) * (0.4 + s.access),
            Self::Shipyard => f64::from(s.shore) * (0.3 + s.woods) * (0.4 + s.access),
            Self::LakeSanctuary => f64::from(s.lake) * open,
            Self::Floodworks => s.flood * (0.4 + s.built),
            Self::SacredGrove => s.woods * open,
            Self::SoundingStation | Self::FloatingHall => f64::from(s.shore) * (0.2 + s.access),
            Self::SaltMemorial => s.salt * (0.3 + s.access),
            Self::PortalHostel => s.near_door * (0.4 + s.access),
            Self::ThermalRefuge => (0.2 + s.height) * (0.2 + s.access) * open,
        }
    }

    /// Length and breadth of influence as multiples of the work's own ground span.
    pub(crate) fn influence(self) -> (f64, f64) {
        match self {
            Self::Observatory => (3., 2.),
            Self::RockMonument => (12., 3.),
            Self::Library => (7., 5.),
            Self::Palace => (18., 6.),
            Self::Prison => (4., 3.),
            Self::Shipyard => (15., 5.),
            Self::LakeSanctuary => (11., 4.),
            Self::Floodworks => (20., 3.),
            Self::SacredGrove => (6., 5.),
            Self::SoundingStation => (5., 2.),
            Self::SaltMemorial => (8., 3.),
            Self::PortalHostel => (9., 4.),
            Self::Sanctuary => (12., 6.),
            Self::ThermalRefuge => (6., 3.),
            Self::FloatingHall => (8., 4.),
        }
    }
}
