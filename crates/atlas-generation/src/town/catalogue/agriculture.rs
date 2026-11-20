use super::*;
use crate::town::effects::Effects;

fn farming_household(site: &development::HousingSite) -> bool {
    let local = site.conditions;
    let rural = local.cultivated / (1. + local.exchange * 0.1 + local.rural_service * 3.)
        * site.distance_from_seat
        / (site.distance_from_seat + 120.);
    site.livelihood_sample < rural * 0.9
}

pub(super) fn common() -> Definition {
    Definition {
        label: "common",
        naming_work: "clearance",
        activity: Activity::Agriculture,
        form: Form::Open,
        legacy_use: Use::House,
        function: BuildingFunction::Civic,
        attraction: |s| s.quiet * (s.rural + s.land.households),
        premises: Premises {
            site: Site::OpenGround,
            access: AccessUse::Freight,
            shares_with: &[Activity::Trade, Activity::Hospitality],
        },
        frontage: MetresRange::frontage(36.),
        depth: MetresRange::depth(40.),
        typical_means: 0.4,
        demand: 0.5,
        prominence: 0.4,
        roles: Roles {
            effects: Effects {
                holds: 1.12,
                ..Effects::EMPTY
            },
            gathering_space: true,
            ground_cover: Some("grass"),
            civic_need: Some(|town| town.audience > 3500.),
            ..Roles::default()
        },
    }
}

pub(super) fn farmstead() -> Definition {
    Definition {
        label: "farmstead",
        naming_work: "household",
        activity: Activity::Agriculture,
        form: Form::Yard,
        legacy_use: Use::House,
        function: BuildingFunction::Residential,
        attraction: |s| s.rural / (1. + s.land.rural_service),
        premises: Premises {
            site: Site::WorkingLand,
            access: AccessUse::Freight,
            shares_with: &[Activity::Agriculture, Activity::Household],
        },
        frontage: MetresRange::frontage(24.),
        depth: MetresRange::depth(38.),
        typical_means: 0.45,
        demand: 0.8,
        prominence: 0.2,
        roles: Roles {
            dwelling: true,
            subdivision_use: Some(household::rear_household()),
            works_fields: true,
            founding: Some(|s| s.cultivated),
            frontage_activities: &[Activity::Household, Activity::Agriculture],
            household: true,
            outbuilding: Some(Kind(Identity::Outbuilding)),
            housing_offer: Some(farming_household),
            intention: Some(farm_access),
            ..Roles::default()
        },
    }
}

pub(super) fn grove() -> Definition {
    let common = common();
    Definition {
        label: "tenders' grove",
        naming_work: "grove",
        premises: Premises {
            site: Site::RootedGround,
            access: AccessUse::Foot,
            shares_with: &[Activity::Agriculture, Activity::Institution],
        },
        roles: Roles {
            effects: Effects {
                holds: 0.8,
                ..Effects::EMPTY
            },
            gathering_space: true,
            ground_cover: Some("woodland"),
            ..Roles::default()
        },
        ..common
    }
}

fn farm_access(kind: Kind, seat: &Seat) -> Option<Purpose> {
    let from = purposes::approach(seat);
    Some(purposes::access(kind, from, from))
}

pub(super) fn outbuilding() -> Definition {
    Definition {
        label: "agricultural outbuilding",
        naming_work: "farmBuilding",
        activity: Activity::Agriculture,
        form: Form::Yard,
        legacy_use: Use::Barn,
        function: BuildingFunction::Economic,
        attraction: |s| s.rural / (1. + s.land.rural_service),
        premises: Premises {
            site: Site::WorkingLand,
            access: AccessUse::Freight,
            shares_with: &[Activity::Agriculture, Activity::Household],
        },
        frontage: MetresRange::frontage(12.),
        depth: MetresRange::depth(20.),
        typical_means: 0.3,
        demand: 0.5,
        prominence: 0.1,
        roles: Roles::default(),
    }
}
