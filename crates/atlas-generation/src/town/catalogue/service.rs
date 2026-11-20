use super::*;
use crate::town::effects::{
    Clientele, Contribution, Ease, Effects, Improvement, Nuisance, Service,
};
use crate::town::production::{Need, Offer, Opportunity, Production};

pub(super) fn carrier_yard() -> Definition {
    Definition {
        label: "carrier yard",
        city: WORKING,
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
        demand: 0.8,
        prominence: 0.2,
        roles: Roles {
            production: Production {
                offers: const { &[Offer::new(Opportunity::MetalStock, 0.61)] },
                needs: &[],
            },
            effects: Effects {
                connects: const { &[Contribution::new(AccessUse::Freight, 0.47)] },
                burdens: const {
                    &[
                        Contribution::new(Nuisance::Noise, 0.38),
                        Contribution::new(Nuisance::Foulness, 0.45),
                    ]
                },
                minimum_support: 0.15,
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn healer() -> Definition {
    Definition {
        label: "healer",
        city: LOCAL,
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
        demand: 0.6,
        prominence: 0.3,
        roles: Roles {
            production: Production {
                needs: const {
                    &[Need::new(
                        Opportunity::SpringWater,
                        Operation::Supply,
                        &[AccessUse::Foot],
                        8.,
                    )]
                },
                ..Production::default()
            },
            effects: Effects {
                serves: const { &[Contribution::new(Service::Care, 0.65)] },
                teaches: 0.26,
                attracts: const { &[Contribution::new(Clientele::Townsfolk, 0.42)] },
                improvement: Some(Improvement::ExpandedOperation),
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn learning() -> Definition {
    Definition {
        label: "learned premises",
        // A college stands where long-settled people with means keep learning in the city.
        city: CityMap::Shows(CityAppearance {
            symbol: "college",
            ground: 10_000.,
            raised_by: |r| together(&[r.wealth, r.standing, r.density.max(r.faith)]),
            seeds: &[Kind(Identity::Retail(Retail::Bookseller))],
        }),
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
        demand: 0.4,
        prominence: 0.4,
        roles: Roles {
            learns_from: 1.1,
            effects: Effects {
                teaches: 1.3,
                attracts: const { &[Contribution::new(Clientele::Wealthy, 0.43)] },
                dignifies: 0.6,
                eases: const {
                    &[
                        Ease::premises(Kind(Identity::Learning), 0.1, 42.),
                        Ease::premises(Kind(Identity::Retail(Retail::Bookseller)), 0.1, 40.),
                    ]
                },
                minimum_support: 0.12,
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn water_point() -> Definition {
    Definition {
        label: "water point",
        city: LOCAL,
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
        demand: 1.2,
        prominence: 0.3,
        roles: Roles {
            effects: Effects {
                holds: 0.58,
                attracts: const { &[Contribution::new(Clientele::Townsfolk, 0.47)] },
                ..Effects::EMPTY
            },
            civic_need: Some(|town| town.audience > 350.),
            ..Roles::default()
        },
    }
}

pub(super) fn wash_house() -> Definition {
    Definition {
        label: "wash house",
        city: LOCAL,
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
        demand: 0.7,
        prominence: 0.2,
        roles: Roles {
            production: Production {
                offers: const {
                    &[Offer::when_supplied(
                        Opportunity::PreparedCloth,
                        1.08,
                        Opportunity::UnfinishedCloth,
                    )]
                },
                needs: const {
                    &[Need::new(
                        Opportunity::UnfinishedCloth,
                        Operation::Supply,
                        &[AccessUse::Foot, AccessUse::Freight, AccessUse::Waterborne],
                        32.,
                    )]
                },
            },
            effects: Effects {
                serves: const { &[Contribution::new(Service::Clearance, 0.8)] },
                attracts: const { &[Contribution::new(Clientele::Townsfolk, 0.58)] },
                burdens: const { &[Contribution::new(Nuisance::Smoke, 0.31)] },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn sanitation() -> Definition {
    Definition {
        label: "service yard",
        city: LOCAL,
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
        demand: 0.6,
        prominence: 0.1,
        roles: Roles {
            effects: Effects {
                serves: const { &[Contribution::new(Service::Clearance, 1.65)] },
                burdens: const {
                    &[
                        Contribution::new(Nuisance::Foulness, 0.46),
                        Contribution::new(Nuisance::Stigma, 0.35),
                    ]
                },
                ..Effects::EMPTY
            },
            civic_need: Some(|town| town.waste > 0.3),
            ..Roles::default()
        },
    }
}

pub(super) fn craft_practice() -> Definition {
    Definition {
        label: "practiced premises",
        city: CityMap::Hidden(
            "A keeping place follows its own system's practice, which the city map carries in its magic and craft fields.",
        ),
        naming_work: "workshop",
        activity: Activity::Service,
        form: Form::Court,
        legacy_use: Use::Hall,
        function: BuildingFunction::Economic,
        attraction: |s| {
            f64::from(s.land.practices.preferred().is_some()) * (1. + s.land.institutions)
        },
        premises: Premises {
            site: Site::PractisedGround,
            access: AccessUse::Foot,
            shares_with: &[Activity::Institution, Activity::Production],
        },
        frontage: MetresRange::frontage(16.),
        depth: MetresRange::depth(24.),
        typical_means: 0.6,
        demand: 0.4,
        prominence: 0.65,
        roles: Roles {
            keeps: true,
            effects: Effects {
                teaches: 0.14,
                ..Effects::EMPTY
            },
            on_established: Some(retain_local_practice),
            ..Roles::default()
        },
    }
}

fn retain_local_practice(town: &mut Town, id: HoldingId, conditions: Conditions) {
    if let Some(code) = conditions.practices.preferred() {
        town.retain_practice(id, code);
    }
}
