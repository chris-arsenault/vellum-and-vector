use super::*;
use crate::town::effects::{Clientele, Contribution, Ease, Effects, Improvement, Nuisance};

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
        demand: 1.,
        prominence: 0.6,
        roles: Roles {
            effects: Effects {
                attracts: const {
                    &[
                        Contribution::new(Clientele::Travellers, 1.25),
                        Contribution::new(Clientele::Wealthy, 0.52),
                    ]
                },
                eases: const {
                    &[
                        Ease::premises(Kind(Identity::CarrierYard), 0.1, 42.),
                        Ease::premises(Kind(Identity::Cookshop), 0.065, 33.),
                    ]
                },
                minimum_support: 0.13,
                improvement: Some(Improvement::ExpandedOperation),
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
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
        demand: 0.9,
        prominence: 0.35,
        roles: Roles {
            effects: Effects {
                attracts: const { &[Contribution::new(Clientele::Townsfolk, 0.92)] },
                burdens: const {
                    &[
                        Contribution::new(Nuisance::Noise, 0.23),
                        Contribution::new(Nuisance::Disorder, 0.46),
                    ]
                },
                minimum_support: 0.12,
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
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
        demand: 1.,
        prominence: 0.2,
        roles: Roles {
            effects: Effects {
                attracts: const {
                    &[
                        Contribution::new(Clientele::Townsfolk, 0.63),
                        Contribution::new(Clientele::Travellers, 0.34),
                    ]
                },
                burdens: const { &[Contribution::new(Nuisance::Smoke, 0.24)] },
                minimum_support: 0.07,
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
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
        demand: 0.5,
        prominence: 0.4,
        roles: Roles {
            effects: Effects {
                attracts: const {
                    &[
                        Contribution::new(Clientele::Townsfolk, 0.76),
                        Contribution::new(Clientele::Travellers, 0.71),
                    ]
                },
                burdens: const {
                    &[
                        Contribution::new(Nuisance::Noise, 0.64),
                        Contribution::new(Nuisance::Disorder, 0.42),
                        Contribution::new(Nuisance::Stigma, 0.31),
                    ]
                },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}
