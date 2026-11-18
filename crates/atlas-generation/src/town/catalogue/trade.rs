use super::*;
use crate::town::{
    fabric::{Anchor, Relationship},
    story::Size,
};

pub(super) fn market() -> Definition {
    Definition {
        label: "market",
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
        nuisance: 0.2,
        demand: 2.,
        prominence: 1.,
        roles: Roles {
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
        nuisance: 0.1,
        demand: 1.5,
        prominence: 0.8,
        roles: Roles::default(),
    }
}

pub(super) fn provision() -> Definition {
    Definition {
        label: "provision seller",
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
        nuisance: 0.2,
        demand: 1.3,
        prominence: 0.2,
        roles: Roles {
            founding: Some(|_| 0.2),
            ..Roles::default()
        },
    }
}

pub(super) fn retail(v: Retail) -> Definition {
    Definition {
        label: v.label(),
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
        nuisance: 0.05,
        demand: 0.7,
        prominence: 0.3,
        roles: Roles {
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
        nuisance: 0.1,
        demand: 0.7,
        prominence: 0.3,
        roles: Roles::default(),
    }
}

pub(super) fn landing() -> Definition {
    Definition {
        label: "landing",
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
        nuisance: 0.3,
        demand: 1.2,
        prominence: 0.5,
        roles: Roles {
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
        nuisance: 0.2,
        demand: 0.5,
        prominence: 0.5,
        roles: Roles {
            gathering_space: true,
            civic_need: Some(|town| town.audience > 15000.),
            ..Roles::default()
        },
    }
}
