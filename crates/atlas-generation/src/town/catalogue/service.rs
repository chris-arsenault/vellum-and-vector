use super::*;

pub(super) fn carrier_yard() -> Definition {
    Definition {
        label: "carrier yard",
        naming_work: "carrier",
        activity: Activity::Service,
        form: Form::Yard,
        legacy_use: Use::Barn,
        function: BuildingFunction::Economic,
        attraction: |s| s.traffic * s.freight + s.rural,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production, Activity::Trade],
        },
        frontage: MetresRange::frontage(20.),
        depth: MetresRange::depth(30.),
        typical_means: 0.4,
        nuisance: 0.5,
        demand: 0.8,
        prominence: 0.2,
        roles: Roles::default(),
    }
}

pub(super) fn healer() -> Definition {
    Definition {
        label: "healer",
        naming_work: "healer",
        activity: Activity::Service,
        form: Form::Frontage,
        legacy_use: Use::House,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.households + s.land.waste + s.land.institutions,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(9.),
        depth: MetresRange::depth(20.),
        typical_means: 0.6,
        nuisance: 0.05,
        demand: 0.6,
        prominence: 0.3,
        roles: Roles::default(),
    }
}

pub(super) fn learning() -> Definition {
    Definition {
        label: "learned premises",
        naming_work: "school",
        activity: Activity::Service,
        form: Form::Frontage,
        legacy_use: Use::Hall,
        function: BuildingFunction::Civic,
        attraction: |s| s.quiet * (s.land.institutions + s.land.patronage),
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(12.),
        depth: MetresRange::depth(20.),
        typical_means: 0.65,
        nuisance: 0.,
        demand: 0.4,
        prominence: 0.4,
        roles: Roles::default(),
    }
}

pub(super) fn water_point() -> Definition {
    Definition {
        label: "water point",
        naming_work: "well",
        activity: Activity::Service,
        form: Form::Open,
        legacy_use: Use::House,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.households + s.land.density,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(6.),
        depth: MetresRange::depth(7.),
        typical_means: 0.4,
        nuisance: 0.,
        demand: 1.2,
        prominence: 0.3,
        roles: Roles {
            civic_need: Some(|town| town.audience > 350.),
            ..Roles::default()
        },
    }
}

pub(super) fn wash_house() -> Definition {
    Definition {
        label: "wash house",
        naming_work: "washhouse",
        activity: Activity::Service,
        form: Form::Yard,
        legacy_use: Use::House,
        function: BuildingFunction::Civic,
        attraction: |s| f64::from(s.land.bank) * (s.land.households + s.land.density),
        premises: Premises {
            site: Site::Waterfront,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production, Activity::Service],
        },
        frontage: MetresRange::frontage(14.),
        depth: MetresRange::depth(20.),
        typical_means: 0.4,
        nuisance: 0.2,
        demand: 0.7,
        prominence: 0.2,
        roles: Roles::default(),
    }
}

pub(super) fn sanitation() -> Definition {
    Definition {
        label: "service yard",
        naming_work: "yard",
        activity: Activity::Service,
        form: Form::Yard,
        legacy_use: Use::Barn,
        function: BuildingFunction::Civic,
        attraction: |s| s.land.waste * (1. + s.land.density) / (1. + s.land.clearance),
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(12.),
        depth: MetresRange::depth(18.),
        typical_means: 0.25,
        nuisance: 0.6,
        demand: 0.6,
        prominence: 0.1,
        roles: Roles {
            service: ServiceRole::Clearance,
            civic_need: Some(|town| town.waste > 0.3),
            ..Roles::default()
        },
    }
}

pub(super) fn craft_practice() -> Definition {
    Definition {
        label: "practiced premises",
        naming_work: "workshop",
        activity: Activity::Service,
        form: Form::Court,
        legacy_use: Use::Hall,
        function: BuildingFunction::Economic,
        attraction: |s| f64::from(s.land.craft.is_some()) * (1. + s.land.institutions),
        premises: Premises {
            site: Site::PractisedGround,
            access: AccessUse::Foot,
            shares_with: &[Activity::Institution, Activity::Production],
        },
        frontage: MetresRange::frontage(16.),
        depth: MetresRange::depth(24.),
        typical_means: 0.6,
        nuisance: 0.1,
        demand: 0.4,
        prominence: 0.65,
        roles: Roles {
            on_established: Some(retain_local_practice),
            ..Roles::default()
        },
    }
}

fn retain_local_practice(town: &mut Town, id: HoldingId, conditions: Conditions) {
    if let Some(code) = conditions.craft {
        town.retain_practice(id, code);
    }
}
