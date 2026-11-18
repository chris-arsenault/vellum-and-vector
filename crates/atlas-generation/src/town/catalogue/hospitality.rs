use super::*;

pub(super) fn inn() -> Definition {
    Definition {
        label: "inn",
        naming_work: "inn",
        activity: Activity::Hospitality,
        form: Form::Court,
        legacy_use: Use::Inn,
        function: BuildingFunction::Economic,
        attraction: |s| s.traffic + s.land.institutions,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[
                Activity::Household,
                Activity::Hospitality,
                Activity::Service,
            ],
        },
        frontage: MetresRange::frontage(20.),
        depth: MetresRange::depth(30.),
        typical_means: 0.6,
        nuisance: 0.3,
        demand: 1.,
        prominence: 0.6,
        roles: Roles::default(),
    }
}

pub(super) fn tavern() -> Definition {
    Definition {
        label: "tavern",
        naming_work: "tavern",
        activity: Activity::Hospitality,
        form: Form::Frontage,
        legacy_use: Use::Tavern,
        function: BuildingFunction::Economic,
        attraction: |s| s.trade + s.traffic + s.land.households,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Household, Activity::Trade, Activity::Production],
        },
        frontage: MetresRange::frontage(10.),
        depth: MetresRange::depth(18.),
        typical_means: 0.4,
        nuisance: 0.5,
        demand: 0.9,
        prominence: 0.35,
        roles: Roles::default(),
    }
}

pub(super) fn cookshop() -> Definition {
    Definition {
        label: "cookshop",
        naming_work: "shop",
        activity: Activity::Hospitality,
        form: Form::Frontage,
        legacy_use: Use::Workshop(CraftTrade::Baker),
        function: BuildingFunction::Economic,
        attraction: |s| s.land.households + s.trade,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Household, Activity::Trade, Activity::Production],
        },
        frontage: MetresRange::frontage(7.),
        depth: MetresRange::depth(14.),
        typical_means: 0.3,
        nuisance: 0.3,
        demand: 1.,
        prominence: 0.2,
        roles: Roles::default(),
    }
}

pub(super) fn entertainment() -> Definition {
    Definition {
        label: "entertainment premises",
        naming_work: "playhouse",
        activity: Activity::Hospitality,
        form: Form::Frontage,
        legacy_use: Use::Tavern,
        function: BuildingFunction::Economic,
        attraction: |s| s.trade + s.traffic + s.land.households,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        frontage: MetresRange::frontage(12.),
        depth: MetresRange::depth(20.),
        typical_means: 0.4,
        nuisance: 0.55,
        demand: 0.5,
        prominence: 0.4,
        roles: Roles::default(),
    }
}
