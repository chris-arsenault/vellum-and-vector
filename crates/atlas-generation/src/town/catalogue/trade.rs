use super::*;
use crate::town::effects::{Clientele, Contribution, Ease, Effects, Nuisance};
use crate::town::production::{Need, Offer, Opportunity, Production};
use crate::town::{
    fabric::{Anchor, Relationship},
    story::Size,
};

pub(super) fn market() -> Definition {
    Definition {
        label: "market",
        // A great market fills the crowded, built-up crossing of the city's ways, or the
        // ground before one of its gates.
        city: CityMap::Shows(CityAppearance {
            symbol: "market",
            ground: 15_000.,
            raised_by: |r| {
                let meeting = if r.gate { 1. } else { crossing(r) };
                together(&[r.density, r.built, meeting, 1. - r.fringe * 0.5])
            },
            seeds: &[Kind(Identity::Provision), Kind(Identity::Inn)],
        }),
        naming_work: "square",
        activity: Activity::Trade,
        form: Form::Open,
        legacy_use: Use::MarketHall,
        function: BuildingFunction::Economic,
        attraction: |s| s.traffic + s.trade + s.land.households,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Freight,
            shares_with: &[Activity::Trade, Activity::Hospitality],
        },
        frontage: MetresRange::frontage(28.),
        depth: MetresRange::depth(40.),
        typical_means: 0.5,
        demand: 2.,
        prominence: 1.,
        roles: Roles {
            effects: Effects {
                attracts: const {
                    &[
                        Contribution::new(Clientele::Townsfolk, 1.7),
                        Contribution::new(Clientele::Countryfolk, 0.9),
                    ]
                },
                holds: 1.4,
                eases: const {
                    &[
                        Ease::premises(Kind(Identity::Provision), 0.16, 36.),
                        Ease::premises(Kind(Identity::Retail(Retail::Bookseller)), 0.08, 26.),
                    ]
                },
                burdens: const { &[Contribution::new(Nuisance::Noise, 0.38)] },
                ..Effects::EMPTY
            },
            gathering_space: true,
            indoor_sharing: true,
            // owner-direction(2026-11-18): the town square is an open area surrounded by businesses.
            frontage_activities: &[Activity::Trade, Activity::Hospitality, Activity::Service],
            ground_cover: Some("paving"),
            furnishing: Some(|seat| {
                if seat.story.seat {
                    Some("statue")
                } else if seat.story.size() >= Size::Town {
                    Some("fountain")
                } else {
                    None
                }
            }),
            civic_need: Some(|town| town.audience > 3500.),
            intention: Some(exchange),
            ..Roles::default()
        },
    }
}

fn exchange(kind: Kind, seat: &Seat) -> Option<Purpose> {
    let mut relationships = vec![Relationship::Accommodation(kind)];
    if seat.story.size() >= Size::Village {
        relationships.push(Relationship::GatheringSpace { for_use: kind });
    }
    for i in 0..seat.arms.len() {
        relationships.push(Relationship::Access {
            from: Anchor::Approach(i),
            to: kind,
            use_: AccessUse::Freight,
        });
    }
    Some(Purpose {
        site: Anchor::Settlement,
        relationships,
        investment: 1.,
    })
}

pub(super) fn exchange_hall() -> Definition {
    Definition {
        label: "exchange hall",
        // Merchants with means build their exchange at an old crossing near the heart.
        city: CityMap::Shows(CityAppearance {
            symbol: "exchange",
            ground: 4_000.,
            raised_by: |r| together(&[r.wealth, crossing(r), r.standing, 1. - r.fringe]),
            seeds: &[Kind(Identity::Storehouse)],
        }),
        naming_work: "marketHall",
        activity: Activity::Trade,
        form: Form::Frontage,
        legacy_use: Use::MarketHall,
        function: BuildingFunction::Economic,
        attraction: |s| s.traffic + s.trade + s.land.households,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Institution, Activity::Trade, Activity::Service],
        },
        frontage: MetresRange::frontage(22.),
        depth: MetresRange::depth(18.),
        typical_means: 0.7,
        demand: 1.5,
        prominence: 0.8,
        roles: Roles {
            effects: Effects {
                attracts: const {
                    &[
                        Contribution::new(Clientele::Wealthy, 1.25),
                        Contribution::new(Clientele::Travellers, 1.15),
                    ]
                },
                dignifies: 0.72,
                eases: const {
                    &[Ease::premises(
                        Kind(Identity::Retail(Retail::Bookseller)),
                        0.14,
                        48.,
                    )]
                },
                minimum_support: 0.15,
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn provision() -> Definition {
    Definition {
        label: "provision seller",
        city: LOCAL,
        naming_work: "shop",
        activity: Activity::Trade,
        form: Form::Frontage,
        legacy_use: Use::Workshop(CraftTrade::Baker),
        function: BuildingFunction::Economic,
        attraction: |s| s.land.households + s.trade,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Household, Activity::Trade, Activity::Production],
        },
        frontage: MetresRange::frontage(8.),
        depth: MetresRange::depth(18.),
        typical_means: 0.4,
        demand: 1.3,
        prominence: 0.2,
        roles: Roles {
            effects: Effects {
                attracts: const { &[Contribution::new(Clientele::Townsfolk, 0.9)] },
                burdens: const { &[Contribution::new(Nuisance::Foulness, 0.12)] },
                minimum_support: 0.08,
                ..Effects::EMPTY
            },
            founding: Some(|_| 0.2),
            ..Roles::default()
        },
    }
}

pub(super) fn retail(v: Retail) -> Definition {
    Definition {
        label: v.label(),
        city: ORDINARY,
        naming_work: "shop",
        activity: Activity::Trade,
        form: Form::Frontage,
        legacy_use: Use::Shop,
        function: BuildingFunction::Economic,
        attraction: |s| s.land.patronage + s.trade,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Foot,
            shares_with: &[Activity::Household, Activity::Trade, Activity::Production],
        },
        frontage: MetresRange::frontage(8.),
        depth: MetresRange::depth(17.),
        typical_means: 0.6,
        demand: 0.7,
        prominence: 0.3,
        roles: Roles {
            production: if v == Retail::Clothier {
                Production {
                    needs: const {
                        &[
                            Need::new(
                                Opportunity::PreparedCloth,
                                Operation::Supply,
                                &[AccessUse::Foot, AccessUse::Freight],
                                13.,
                            ),
                            Need::new(
                                Opportunity::TextileCommission,
                                Operation::Customers,
                                &[AccessUse::Foot],
                                4.,
                            ),
                        ]
                    },
                    ..Production::default()
                }
            } else {
                Production::default()
            },
            effects: Effects {
                attracts: const { &[Contribution::new(Clientele::Wealthy, 0.82)] },
                minimum_support: 0.14,
                ..Effects::EMPTY
            },
            variants: &[
                Kind(Identity::Retail(Retail::Bookseller)),
                Kind(Identity::Retail(Retail::Clothier)),
                Kind(Identity::Retail(Retail::Outfitter)),
                Kind(Identity::Retail(Retail::SpiceMerchant)),
            ],
            ..Roles::default()
        },
    }
}

pub(super) fn storehouse() -> Definition {
    Definition {
        label: "storehouse",
        city: WORKING,
        naming_work: "warehouse",
        activity: Activity::Trade,
        form: Form::Yard,
        legacy_use: Use::Warehouse,
        function: BuildingFunction::Economic,
        attraction: |s| (s.trade + s.rural) * s.freight * s.land.protection,
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Freight,
            shares_with: &[Activity::Production, Activity::Trade],
        },
        frontage: MetresRange::frontage(18.),
        depth: MetresRange::depth(25.),
        typical_means: 0.7,
        demand: 0.7,
        prominence: 0.3,
        roles: Roles {
            effects: Effects {
                eases: const {
                    &[Ease::premises(
                        Kind(Identity::Retail(Retail::Bookseller)),
                        0.09,
                        65.,
                    )]
                },
                ..Effects::EMPTY
            },
            ..Roles::default()
        },
    }
}

pub(super) fn landing() -> Definition {
    Definition {
        label: "landing",
        // The city's quays line usable shore where its built ground and ways come down to it.
        city: CityMap::Shows(CityAppearance {
            symbol: "quay",
            ground: 20_000.,
            raised_by: |r| {
                if r.shore {
                    together(&[r.built, 0.5 * (r.density + crossing(r))])
                } else {
                    0.
                }
            },
            seeds: &[Kind(Identity::Storehouse), Kind(Identity::CarrierYard)],
        }),
        naming_work: "harbor",
        activity: Activity::Trade,
        form: Form::WaterEdge,
        legacy_use: Use::Warehouse,
        function: BuildingFunction::Economic,
        attraction: |s| f64::from(s.land.bank) * (s.freight + s.traffic),
        premises: Premises {
            site: Site::Waterfront,
            access: AccessUse::Waterborne,
            shares_with: &[Activity::Trade, Activity::Production],
        },
        frontage: MetresRange::frontage(20.),
        depth: MetresRange::depth(14.),
        typical_means: 0.4,
        demand: 1.2,
        prominence: 0.5,
        roles: Roles {
            production: Production {
                offers: const { &[Offer::new(Opportunity::VesselWork, 0.89)] },
                needs: const {
                    &[Need::new(
                        Opportunity::Soundings,
                        Operation::Service,
                        &[AccessUse::Foot, AccessUse::Waterborne],
                        8.,
                    )]
                },
            },
            effects: Effects {
                connects: const {
                    &[
                        Contribution::new(AccessUse::Waterborne, 0.65),
                        Contribution::new(AccessUse::Freight, 0.45),
                    ]
                },
                attracts: const { &[Contribution::new(Clientele::Travellers, 1.1)] },
                burdens: const { &[Contribution::new(Nuisance::Disorder, 0.3)] },
                ..Effects::EMPTY
            },
            intention: Some(landing_access),
            landside_access: Some(AccessUse::Freight),
            founding: Some(|s| f64::from(s.bank) * (0.5 + s.exchange)),
            frontage_activities: &[Activity::Production, Activity::Trade, Activity::Household],
            ..Roles::default()
        },
    }
}

fn landing_access(kind: Kind, seat: &Seat) -> Option<Purpose> {
    seat.story
        .waterside
        .then(|| purposes::access(kind, Anchor::Settlement, purposes::approach(seat)))
}

pub(super) fn fairground() -> Definition {
    Definition {
        label: "fairground",
        // Fairs meet on open ground at the city's edge where ways arrive.
        city: CityMap::Shows(CityAppearance {
            symbol: "fair",
            ground: 40_000.,
            raised_by: |r| together(&[r.fringe, crossing(r), 1. - r.built]),
            seeds: &[Kind(Identity::Tavern)],
        }),
        naming_work: "square",
        activity: Activity::Trade,
        form: Form::Open,
        legacy_use: Use::MarketHall,
        function: BuildingFunction::Economic,
        attraction: |s| s.traffic / (1. + s.land.density),
        premises: Premises {
            site: Site::PreferStreet,
            access: AccessUse::Freight,
            shares_with: &[Activity::Trade, Activity::Hospitality],
        },
        frontage: MetresRange::frontage(36.),
        depth: MetresRange::depth(45.),
        typical_means: 0.5,
        demand: 0.5,
        prominence: 0.5,
        roles: Roles {
            effects: Effects {
                attracts: const {
                    &[
                        Contribution::new(Clientele::Countryfolk, 1.35),
                        Contribution::new(Clientele::Travellers, 0.55),
                    ]
                },
                holds: 1.1,
                burdens: const {
                    &[
                        Contribution::new(Nuisance::Noise, 0.64),
                        Contribution::new(Nuisance::Disorder, 0.39),
                    ]
                },
                ..Effects::EMPTY
            },
            gathering_space: true,
            civic_need: Some(|town| town.audience > 15000.),
            ..Roles::default()
        },
    }
}
