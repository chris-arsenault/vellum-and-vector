use super::*;

pub(super) fn fine_craft(v: FineCraft) -> Definition {
    Definition {
        label: v.label(),
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
        nuisance: 0.1,
        demand: 0.5,
        prominence: 0.4,
        roles: Roles {
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
        nuisance: 0.12,
        demand: 0.9,
        prominence: 0.15,
        roles: Roles::default(),
    }
}

pub(super) fn heavy_craft() -> Definition {
    Definition {
        label: "craft yard",
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
        nuisance: 0.5,
        demand: 0.7,
        prominence: 0.2,
        roles: Roles::default(),
    }
}

pub(super) fn smithy() -> Definition {
    Definition {
        label: "smithy",
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
        nuisance: 0.75,
        demand: 0.9,
        prominence: 0.45,
        roles: Roles::default(),
    }
}

pub(super) fn noxious_works() -> Definition {
    Definition {
        label: "tannery",
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
        nuisance: 1.,
        demand: 0.6,
        prominence: 0.2,
        roles: Roles::default(),
    }
}

pub(super) fn mill() -> Definition {
    Definition {
        label: "mill",
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
        nuisance: 0.4,
        demand: 0.8,
        prominence: 0.6,
        roles: Roles::default(),
    }
}

pub(super) fn brewhouse() -> Definition {
    Definition {
        label: "brewhouse",
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
        nuisance: 0.3,
        demand: 0.7,
        prominence: 0.25,
        roles: Roles::default(),
    }
}

pub(super) fn resource_yard() -> Definition {
    Definition {
        label: "resource yard",
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
        nuisance: 0.6,
        demand: 0.4,
        prominence: 0.2,
        roles: Roles::default(),
    }
}
