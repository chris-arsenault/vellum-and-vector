use super::*;
use crate::town::effects::{Clientele, Contribution, Ease, Effects, Improvement, Nuisance};
use crate::town::production::{Need, Offer, Opportunity, Production};

pub(super) fn fine_craft(v: FineCraft) -> Definition {
    Definition {
        label: v.label(),
        city: WORKING,
        naming_work: "workshop",
        activity: Activity::Production,
        form: Form::Frontage,
        legacy_use: Use::Craftshop,
        function: BuildingFunction::Economic,
        attraction: |s| s.land.patronage * s.land.protection + s.land.workshops,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Household, Activity::Trade, Activity::Production],
        },
        frontage: MetresRange::frontage(8.),
        depth: MetresRange::depth(20.),
        typical_means: 0.75,
        demand: 0.5,
        prominence: 0.4,
        roles: Roles {
            learns_from: 0.37,
            production: match v {
                FineCraft::Jeweller | FineCraft::Goldsmith => Production {
                    needs: const {
                        &[
                            Need::new(
                                Opportunity::PreparedMetal,
                                Operation::Supply,
                                &[AccessUse::Foot, AccessUse::Freight],
                                12.,
                            ),
                            Need::new(
                                Opportunity::MetalworkCommission,
                                Operation::Customers,
                                &[AccessUse::Foot],
                                0.,
                            ),
                        ]
                    },
                    ..Production::default()
                },
                FineCraft::Engraver => Production {
                    needs: const {
                        &[
                            Need::new(
                                Opportunity::ShapedStone,
                                Operation::Supply,
                                &[AccessUse::Foot, AccessUse::Freight],
                                28.,
                            ),
                            Need::new(
                                Opportunity::MasonryCommission,
                                Operation::Customers,
                                &[AccessUse::Foot],
                                5.,
                            ),
                        ]
                    },
                    ..Production::default()
                },
                FineCraft::InstrumentMaker => Production {
                    needs: const {
                        &[Need::new(
                            Opportunity::PreparedTimber,
                            Operation::Supply,
                            &[AccessUse::Foot, AccessUse::Freight],
                            8.,
                        )]
                    },
                    ..Production::default()
                },
            },
            effects: Effects {
                attracts: const { &[Contribution::new(Clientele::Wealthy, 0.85)] },
                eases: const {
                    &[Ease::premises(
                        Kind(Identity::FineCraft(FineCraft::Jeweller)),
                        0.12,
                        38.,
                    )]
                },
                teaches: 0.3,
                minimum_support: 0.17,
                improvement: Some(Improvement::ExpandedOperation),
                ..Effects::EMPTY
            },
            variants: &[
                Kind(Identity::FineCraft(FineCraft::Jeweller)),
                Kind(Identity::FineCraft(FineCraft::Goldsmith)),
                Kind(Identity::FineCraft(FineCraft::Engraver)),
                Kind(Identity::FineCraft(FineCraft::InstrumentMaker)),
            ],
            ..Roles::default()
        },
    }
}

pub(super) fn domestic_craft() -> Definition {
    Definition {
        label: "domestic craft",
        city: WORKING,
        naming_work: "workshop",
        activity: Activity::Production,
        form: Form::Frontage,
        legacy_use: Use::Workshop(CraftTrade::Weaver),
        function: BuildingFunction::Economic,
        attraction: |s| s.land.households + s.land.workshops,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Household, Activity::Trade, Activity::Production],
        },
        frontage: MetresRange::frontage(7.),
        depth: MetresRange::depth(22.),
        typical_means: 0.4,
        demand: 0.9,
        prominence: 0.15,
        roles: Roles {
            production: Production {
                offers: const {
                    &[
                        Offer::new(Opportunity::UnfinishedCloth, 0.8),
                        Offer::new(Opportunity::Rigging, 0.34),
                    ]
                },
                needs: &[],
            },
            effects: Effects {
                eases: const { &[Ease::premises(Kind(Identity::DomesticCraft), 0.073, 29.)] },
                minimum_support: 0.08,
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn heavy_craft() -> Definition {
    Definition {
        label: "craft yard",
        city: WORKING,
        naming_work: "workshop",
        activity: Activity::Production,
        form: Form::Yard,
        legacy_use: Use::Workshop(CraftTrade::Carpenter),
        function: BuildingFunction::Economic,
        attraction: |s| s.freight * (s.rural + s.traffic + s.land.workshops),
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production, Activity::Trade],
        },
        frontage: MetresRange::frontage(15.),
        depth: MetresRange::depth(28.),
        typical_means: 0.5,
        demand: 0.7,
        prominence: 0.2,
        roles: Roles {
            production: Production {
                offers: const {
                    &[Offer::when_supplied(
                        Opportunity::ShapedStone,
                        1.15,
                        Opportunity::RoughStone,
                    )]
                },
                needs: const {
                    &[
                        Need::new(
                            Opportunity::RoughStone,
                            Operation::Supply,
                            &[AccessUse::Freight, AccessUse::Waterborne],
                            80.,
                        ),
                        Need::new(
                            Opportunity::PreparedTimber,
                            Operation::Supply,
                            &[AccessUse::Freight, AccessUse::Waterborne],
                            36.,
                        ),
                        Need::new(
                            Opportunity::Rigging,
                            Operation::Supply,
                            &[AccessUse::Foot, AccessUse::Freight],
                            12.,
                        ),
                        Need::new(
                            Opportunity::VesselWork,
                            Operation::Customers,
                            &[AccessUse::Freight, AccessUse::Waterborne],
                            32.,
                        ),
                    ]
                },
            },
            effects: Effects {
                burdens: const { &[Contribution::new(Nuisance::Noise, 0.65)] },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn smithy() -> Definition {
    Definition {
        label: "smithy",
        city: WORKING,
        naming_work: "smithy",
        activity: Activity::Production,
        form: Form::Yard,
        legacy_use: Use::Smithy,
        function: BuildingFunction::Economic,
        attraction: |s| s.freight * (s.rural + s.traffic + s.land.workshops),
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production, Activity::Trade],
        },
        frontage: MetresRange::frontage(12.),
        depth: MetresRange::depth(24.),
        typical_means: 0.55,
        demand: 0.9,
        prominence: 0.45,
        roles: Roles {
            production: Production {
                offers: const {
                    &[Offer::when_supplied(
                        Opportunity::PreparedMetal,
                        1.1,
                        Opportunity::MetalStock,
                    )]
                },
                needs: const {
                    &[
                        Need::new(
                            Opportunity::MetalStock,
                            Operation::Supply,
                            &[AccessUse::Freight, AccessUse::Waterborne],
                            46.,
                        ),
                        Need::new(
                            Opportunity::WorkedHeat,
                            Operation::Supply,
                            &[AccessUse::Foot],
                            10.,
                        ),
                        Need::new(
                            Opportunity::PreparedMetal,
                            Operation::Supply,
                            &[AccessUse::Foot, AccessUse::Freight],
                            24.,
                        ),
                        Need::new(
                            Opportunity::MetalworkCommission,
                            Operation::Customers,
                            &[AccessUse::Foot],
                            5.,
                        ),
                    ]
                },
            },
            effects: Effects {
                attracts: const {
                    &[
                        Contribution::new(Clientele::Travellers, 0.55),
                        Contribution::new(Clientele::Countryfolk, 0.36),
                    ]
                },
                burdens: const {
                    &[
                        Contribution::new(Nuisance::Smoke, 0.62),
                        Contribution::new(Nuisance::Noise, 0.74),
                    ]
                },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn noxious_works() -> Definition {
    Definition {
        label: "tannery",
        city: WORKING,
        naming_work: "workshop",
        activity: Activity::Production,
        form: Form::Yard,
        legacy_use: Use::Workshop(CraftTrade::Tanner),
        function: BuildingFunction::Economic,
        attraction: |s| f64::from(s.land.bank) * s.freight / (1. + s.land.households),
        premises: Premises {
            site: Site::Waterfront,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production, Activity::Service],
        },
        frontage: MetresRange::frontage(16.),
        depth: MetresRange::depth(30.),
        typical_means: 0.4,
        demand: 0.6,
        prominence: 0.2,
        roles: Roles {
            effects: Effects {
                burdens: const {
                    &[
                        Contribution::new(Nuisance::Foulness, 1.25),
                        Contribution::new(Nuisance::Stigma, 0.48),
                    ]
                },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn mill() -> Definition {
    Definition {
        label: "mill",
        city: WORKING,
        naming_work: "mill",
        activity: Activity::Production,
        form: Form::WaterEdge,
        legacy_use: Use::Mill,
        function: BuildingFunction::Economic,
        attraction: |s| s.rural * s.freight,
        premises: Premises {
            site: Site::FlowingWater,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production],
        },
        frontage: MetresRange::frontage(14.),
        depth: MetresRange::depth(22.),
        typical_means: 0.65,
        demand: 0.8,
        prominence: 0.6,
        roles: Roles {
            effects: Effects {
                attracts: const { &[Contribution::new(Clientele::Countryfolk, 0.93)] },
                burdens: const { &[Contribution::new(Nuisance::Noise, 0.56)] },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn brewhouse() -> Definition {
    Definition {
        label: "brewhouse",
        city: WORKING,
        naming_work: "brewery",
        activity: Activity::Production,
        form: Form::Yard,
        legacy_use: Use::Workshop(CraftTrade::Brewer),
        function: BuildingFunction::Economic,
        attraction: |s| s.land.households + s.trade + f64::from(s.land.bank),
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production, Activity::Trade],
        },
        frontage: MetresRange::frontage(12.),
        depth: MetresRange::depth(24.),
        typical_means: 0.5,
        demand: 0.7,
        prominence: 0.25,
        roles: Roles {
            effects: Effects {
                burdens: const { &[Contribution::new(Nuisance::Smoke, 0.44)] },
                eases: const { &[Ease::premises(Kind(Identity::Tavern), 0.09, 70.)] },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn resource_yard() -> Definition {
    Definition {
        label: "resource yard",
        city: WORKING,
        naming_work: "workshop",
        activity: Activity::Production,
        form: Form::Yard,
        legacy_use: Use::Workshop(CraftTrade::Mason),
        function: BuildingFunction::Economic,
        attraction: |s| s.freight * (s.rural + f64::from(s.land.flowing)),
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production, Activity::Trade],
        },
        frontage: MetresRange::frontage(22.),
        depth: MetresRange::depth(30.),
        typical_means: 0.4,
        demand: 0.4,
        prominence: 0.2,
        roles: Roles {
            production: Production {
                offers: const {
                    &[
                        Offer::new(Opportunity::RoughStone, 1.05),
                        Offer::new(Opportunity::PreparedTimber, 0.67),
                    ]
                },
                needs: &[],
            },
            effects: Effects {
                burdens: const { &[Contribution::new(Nuisance::Noise, 0.56)] },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}
