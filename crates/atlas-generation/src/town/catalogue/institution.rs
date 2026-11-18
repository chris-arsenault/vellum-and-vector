use super::*;
use crate::town::fabric::Relationship;

pub(super) fn assembly_hall() -> Definition {
    Definition {
        label: "assembly hall",
        naming_work: "hall",
        activity: Activity::Institution,
        form: Form::Court,
        legacy_use: Use::Hall,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.households + s.land.institutions + s.traffic,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Institution, Activity::Trade, Activity::Service],
        },
        frontage: MetresRange::frontage(22.),
        depth: MetresRange::depth(24.),
        typical_means: 0.7,
        nuisance: 0.1,
        demand: 0.7,
        prominence: 0.9,
        roles: Roles::default(),
    }
}

pub(super) fn guild_hall() -> Definition {
    Definition {
        label: "guild hall",
        naming_work: "hall",
        activity: Activity::Institution,
        form: Form::Court,
        legacy_use: Use::Hall,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.workshops + s.trade,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Institution, Activity::Trade, Activity::Service],
        },
        frontage: MetresRange::frontage(16.),
        depth: MetresRange::depth(22.),
        typical_means: 0.8,
        nuisance: 0.1,
        demand: 0.5,
        prominence: 0.6,
        roles: Roles::default(),
    }
}

pub(super) fn court_house() -> Definition {
    Definition {
        label: "court and confinement",
        naming_work: "court",
        activity: Activity::Institution,
        form: Form::Compound,
        legacy_use: Use::Hall,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.households + s.land.institutions + s.traffic,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(20.),
        depth: MetresRange::depth(24.),
        typical_means: 0.6,
        nuisance: 0.1,
        demand: 0.4,
        prominence: 0.6,
        roles: Roles::default(),
    }
}

pub(super) fn watch() -> Definition {
    Definition {
        label: "watch premises",
        naming_work: "barracks",
        activity: Activity::Institution,
        form: Form::Yard,
        legacy_use: Use::Barracks,
        function: BuildingFunction::Civic,
        attraction: |s| s.traffic * (1. + s.land.patronage) / (1. + s.land.protection),
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(14.),
        depth: MetresRange::depth(20.),
        typical_means: 0.4,
        nuisance: 0.1,
        demand: 0.5,
        prominence: 0.4,
        roles: Roles {
            service: ServiceRole::Protection,
            intention: Some(protection),
            ..Roles::default()
        },
    }
}

fn protection(kind: Kind, seat: &Seat) -> Option<Purpose> {
    let site = purposes::approach(seat);
    (seat.story.guarded || seat.story.seat).then(|| Purpose {
        site,
        relationships: vec![Relationship::Protection {
            of: site,
            provider: kind,
        }],
        investment: 0.,
    })
}

pub(super) fn toll() -> Definition {
    Definition {
        label: "tollhouse",
        naming_work: "tollhouse",
        activity: Activity::Institution,
        form: Form::Frontage,
        legacy_use: Use::Hall,
        function: BuildingFunction::Civic,
        attraction: |s| s.through * (1. + s.traffic),
        premises: Premises {
            site: Site::RequireStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(8.),
        depth: MetresRange::depth(12.),
        typical_means: 0.6,
        nuisance: 0.1,
        demand: 0.4,
        prominence: 0.3,
        roles: Roles::default(),
    }
}

pub(super) fn manor() -> Definition {
    Definition {
        label: "manor",
        naming_work: "manor",
        activity: Activity::Institution,
        form: Form::Compound,
        legacy_use: Use::Keep,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.patronage + s.rural + s.land.protection,
        premises: Premises {
            site: Site::OpenGround,
            access: AccessUse::Foot,
            shares_with: &[
                Activity::Household,
                Activity::Hospitality,
                Activity::Service,
            ],
        },
        frontage: MetresRange::frontage(35.),
        depth: MetresRange::depth(42.),
        typical_means: 0.95,
        nuisance: 0.1,
        demand: 0.4,
        prominence: 1.,
        roles: Roles {
            service: ServiceRole::Protection,
            ..Roles::default()
        },
    }
}

pub(super) fn worship() -> Definition {
    Definition {
        label: "worship house",
        naming_work: "temple",
        activity: Activity::Institution,
        form: Form::Court,
        legacy_use: Use::Temple,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.institutions + s.land.households + s.through,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(20.),
        depth: MetresRange::depth(32.),
        typical_means: 0.65,
        nuisance: 0.05,
        demand: 0.8,
        prominence: 1.,
        roles: Roles::default(),
    }
}

pub(super) fn shrine() -> Definition {
    Definition {
        label: "shrine",
        naming_work: "temple",
        activity: Activity::Institution,
        form: Form::Open,
        legacy_use: Use::Temple,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.institutions + s.land.households + s.through,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(7.),
        depth: MetresRange::depth(9.),
        typical_means: 0.4,
        nuisance: 0.,
        demand: 0.4,
        prominence: 0.65,
        roles: Roles {
            civic_need: Some(|town| town.audience > 2500.),
            ..Roles::default()
        },
    }
}

pub(super) fn religious_house() -> Definition {
    Definition {
        label: "religious house",
        naming_work: "religiousHouse",
        activity: Activity::Institution,
        form: Form::Compound,
        legacy_use: Use::Temple,
        function: BuildingFunction::Civic,
        attraction: |s| (s.quiet + s.rural) * (1. + s.land.institutions),
        premises: Premises {
            site: Site::OpenGround,
            access: AccessUse::Foot,
            shares_with: &[
                Activity::Household,
                Activity::Hospitality,
                Activity::Service,
            ],
        },
        frontage: MetresRange::frontage(34.),
        depth: MetresRange::depth(40.),
        typical_means: 0.6,
        nuisance: 0.1,
        demand: 0.5,
        prominence: 0.8,
        roles: Roles {
            dwelling: true,
            subdivision_use: Some(household::rear_household()),
            ..Roles::default()
        },
    }
}

pub(super) fn burial() -> Definition {
    Definition {
        label: "burial ground",
        naming_work: "graveyard",
        activity: Activity::Institution,
        form: Form::Open,
        legacy_use: Use::Temple,
        function: BuildingFunction::Civic,
        attraction: |s| s.quiet * (1. + s.land.institutions) / (1. + s.land.density),
        premises: Premises {
            site: Site::OpenGround,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(28.),
        depth: MetresRange::depth(32.),
        typical_means: 0.4,
        nuisance: 0.,
        demand: 0.3,
        prominence: 0.3,
        roles: Roles {
            civic_need: Some(|town| town.audience > 5000.),
            ..Roles::default()
        },
    }
}

pub(super) fn almshouse() -> Definition {
    Definition {
        label: "almshouse",
        naming_work: "almshouse",
        activity: Activity::Institution,
        form: Form::Court,
        legacy_use: Use::House,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.households + s.land.waste + s.land.institutions,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[
                Activity::Household,
                Activity::Hospitality,
                Activity::Service,
            ],
        },
        frontage: MetresRange::frontage(22.),
        depth: MetresRange::depth(28.),
        typical_means: 0.3,
        nuisance: 0.15,
        demand: 0.5,
        prominence: 0.4,
        roles: Roles {
            dwelling: true,
            subdivision_use: Some(household::rear_household()),
            ..Roles::default()
        },
    }
}
