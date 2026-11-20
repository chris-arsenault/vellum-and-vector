use super::*;
use crate::town::effects::{Bar, Clientele, Contribution, Ease, Effects, Nuisance, Raise, Service};
use crate::town::fabric::Relationship;
use crate::town::production::{Need, Offer, Opportunity, Production};

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
        demand: 0.7,
        prominence: 0.9,
        roles: Roles {
            effects: Effects {
                dignifies: 0.67,
                holds: 0.93,
                attracts: const { &[Contribution::new(Clientele::Townsfolk, 0.69)] },
                bars: const { &[Bar::premises(Kind(Identity::NoxiousWorks), 34.)] },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
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
        demand: 0.5,
        prominence: 0.6,
        roles: Roles {
            effects: Effects {
                dignifies: 0.83,
                teaches: 0.77,
                eases: const {
                    &[
                        Ease::premises(Kind(Identity::FineCraft(FineCraft::Jeweller)), 0.14, 61.),
                        Ease::premises(Kind(Identity::DomesticCraft), 0.09, 48.),
                    ]
                },
                raises: &[Raise {
                    target: Kind(Identity::FineCraft(FineCraft::Jeweller)),
                    reach: 70.,
                }],
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
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
        demand: 0.4,
        prominence: 0.6,
        roles: Roles {
            production: Production {
                needs: const {
                    &[Need::new(
                        Opportunity::WitnessRecord,
                        Operation::Service,
                        &[AccessUse::Foot],
                        5.,
                    )]
                },
                ..Production::default()
            },
            effects: Effects {
                attracts: const { &[Contribution::new(Clientele::Wealthy, 0.65)] },
                serves: const { &[Contribution::new(Service::Protection, 0.46)] },
                burdens: const { &[Contribution::new(Nuisance::Stigma, 0.43)] },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
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
        demand: 0.5,
        prominence: 0.4,
        roles: Roles {
            production: Production {
                offers: const { &[Offer::new(Opportunity::MetalworkCommission, 0.71)] },
                needs: &[],
            },
            effects: Effects {
                serves: const { &[Contribution::new(Service::Protection, 1.5)] },
                ..Effects::EMPTY
            },
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
        demand: 0.4,
        prominence: 0.3,
        roles: Roles {
            effects: Effects {
                connects: const {
                    &[
                        Contribution::new(AccessUse::Foot, 0.3),
                        Contribution::new(AccessUse::Freight, 0.16),
                    ]
                },
                attracts: const { &[Contribution::new(Clientele::Travellers, 0.65)] },
                serves: const { &[Contribution::new(Service::Protection, 0.66)] },
                eases: const {
                    &[
                        Ease::premises(Kind(Identity::Inn), 0.14, 55.),
                        Ease::premises(Kind(Identity::CarrierYard), 0.11, 50.),
                        Ease::access(AccessUse::Foot, 12., 38.),
                    ]
                },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
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
        demand: 0.4,
        prominence: 1.,
        roles: Roles {
            production: Production {
                offers: const {
                    &[
                        Offer::new(Opportunity::TextileCommission, 0.85),
                        Offer::new(Opportunity::MasonryCommission, 1.1),
                    ]
                },
                needs: &[],
            },
            effects: Effects {
                dignifies: 1.22,
                holds: 1.4,
                serves: const { &[Contribution::new(Service::Protection, 0.72)] },
                bars: const {
                    &[
                        Bar::premises(Kind(Identity::HeavyCraft), 62.),
                        Bar::premises(Kind(Identity::NoxiousWorks), 75.),
                    ]
                },
                raises: &[Raise {
                    target: Kind(Identity::Residence(Residence::Croft)),
                    reach: 55.,
                }],
                ..Effects::EMPTY
            },
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
        demand: 0.8,
        prominence: 1.,
        roles: Roles {
            effects: Effects {
                consecrates: 0.88,
                attracts: const { &[Contribution::new(Clientele::Townsfolk, 0.85)] },
                dignifies: 0.90,
                teaches: 0.46,
                holds: 0.78,
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
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
        demand: 0.4,
        prominence: 0.65,
        roles: Roles {
            effects: Effects {
                consecrates: 0.67,
                attracts: const { &[Contribution::new(Clientele::Travellers, 0.52)] },
                holds: 0.63,
                ..Effects::EMPTY
            },
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
        demand: 0.5,
        prominence: 0.8,
        roles: Roles {
            effects: Effects {
                consecrates: 1.0,
                teaches: 0.83,
                serves: const { &[Contribution::new(Service::Care, 0.47)] },
                holds: 0.92,
                bars: const {
                    &[
                        Bar::premises(Kind(Identity::Tavern), 37.),
                        Bar::premises(Kind(Identity::Entertainment), 53.),
                    ]
                },
                ..Effects::EMPTY
            },
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
        demand: 0.3,
        prominence: 0.3,
        roles: Roles {
            effects: Effects {
                holds: 1.05,
                burdens: const { &[Contribution::new(Nuisance::Stigma, 0.57)] },
                ..Effects::EMPTY
            },
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
        demand: 0.5,
        prominence: 0.4,
        roles: Roles {
            effects: Effects {
                serves: const { &[Contribution::new(Service::Care, 1.33)] },
                teaches: 0.4,
                burdens: const { &[Contribution::new(Nuisance::Stigma, 0.28)] },
                ..Effects::EMPTY
            },
            dwelling: true,
            subdivision_use: Some(household::rear_household()),
            ..Roles::default()
        },
    }
}
