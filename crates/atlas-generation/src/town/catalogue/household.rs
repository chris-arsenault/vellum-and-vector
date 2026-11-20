use super::*;
use crate::town::effects::{Effects, Improvement, Raise};

pub(super) fn rear_household() -> Kind {
    Kind(Identity::Residence(Residence::Incremental))
}

pub(super) fn select_household(site: &development::HousingSite) -> Kind {
    Kind(Identity::Residence(residential_form(
        site.conditions,
        site.trade_demand,
        site.means,
        site.form_sample,
    )))
}

fn household_business(conditions: Conditions) -> Kind {
    if conditions.workshops > conditions.households {
        Kind(Identity::DomesticCraft)
    } else {
        Kind(Identity::Provision)
    }
}
fn residential_form(
    local: crate::town::influence::Conditions,
    activity: f64,
    means: f64,
    sample: f64,
) -> Residence {
    if local.institutions > 0.5 && sample < 0.4 {
        Residence::Communal
    } else if local.density > 0.18 && sample < 0.55 {
        Residence::Court
    } else if local.nuisance + local.waste > 0.45 || sample < 0.18 {
        Residence::Incremental
    } else if means > 0.72 && sample > 0.72 {
        Residence::Compound
    } else if means > 0.55 && sample > 0.6 {
        Residence::Courtyard
    } else if activity > 1.4 && sample > 0.55 {
        Residence::ShopHouse
    } else if activity > 0.7 {
        Residence::Burgage
    } else if sample < 0.4 {
        Residence::Court
    } else {
        Residence::Croft
    }
}

pub(super) fn garden() -> Definition {
    Definition {
        label: "garden",
        city: LAND,
        naming_work: "clearance",
        activity: Activity::Household,
        form: Form::Open,
        legacy_use: Use::House,
        function: BuildingFunction::Economic,
        attraction: |s| s.quiet * (s.rural + s.land.households),
        premises: Premises {
            site: Site::WorkingLand,
            access: AccessUse::Freight,
            shares_with: &[Activity::Agriculture, Activity::Household],
        },
        frontage: MetresRange::frontage(20.),
        depth: MetresRange::depth(26.),
        typical_means: 0.8,
        demand: 0.3,
        prominence: 0.3,
        roles: Roles {
            effects: Effects {
                holds: 0.76,
                dignifies: 0.61,
                raises: &[Raise {
                    target: Kind(Identity::Residence(Residence::Croft)),
                    reach: 33.,
                }],
                ..Effects::EMPTY
            },
            civic_need: Some(|town| town.audience > 6000.),
            ..Roles::default()
        },
    }
}

pub(super) fn park() -> Definition {
    Definition {
        label: "public green",
        // A city's great green lies among the wealthy, where crowding has not built it over.
        city: CityMap::Shows(CityAppearance {
            symbol: "park",
            ground: 30_000.,
            raised_by: |r| together(&[r.wealth, r.built, 1. - 0.6 * r.density]),
            seeds: &[],
        }),
        function: BuildingFunction::Civic,
        activity: Activity::Institution,
        premises: Premises {
            site: Site::OpenGround,
            access: AccessUse::Foot,
            shares_with: &[],
        },
        roles: Roles {
            effects: Effects {
                holds: 0.96,
                ..Effects::EMPTY
            },
            ground_cover: Some("grass"),
            civic_need: Some(|town| town.audience > 1800.),
            ..Roles::default()
        },
        ..garden()
    }
}

pub(super) fn residence(variant: Residence) -> Definition {
    let (label, form, width, depth, means) = match variant {
        Residence::Croft => ("croft", Form::Yard, 16., 30., 0.4),
        Residence::Burgage => ("street household", Form::Frontage, 8., 28., 0.5),
        Residence::ShopHouse => ("shop-house", Form::Frontage, 8., 25., 0.55),
        Residence::Court => ("lodging court", Form::Court, 16., 30., 0.3),
        Residence::Incremental => ("incremental household", Form::Yard, 6., 12., 0.15),
        Residence::Courtyard => ("courtyard household", Form::Court, 18., 30., 0.8),
        Residence::Compound => ("elite compound", Form::Compound, 30., 40., 0.95),
        Residence::Communal => ("communal residence", Form::Court, 18., 28., 0.4),
    };

    Definition {
        label,
        city: ORDINARY,
        naming_work: "household",
        activity: Activity::Household,
        form,
        legacy_use: Use::House,
        function: BuildingFunction::Residential,
        attraction: |s| s.quiet + s.land.households,
        premises: Premises {
            site: match variant {
                Residence::Croft | Residence::Compound | Residence::Incremental => Site::OpenGround,
                _ => Site::PreferStreet,
            },
            access: AccessUse::Foot,
            shares_with: &[Activity::Household, Activity::Trade, Activity::Production],
        },
        frontage: MetresRange::residential(width),
        depth: MetresRange::residential(depth),
        typical_means: means,
        demand: 1.,
        prominence: 0.1,
        roles: Roles {
            effects: Effects {
                improvement: Some(Improvement::UpperStorey),
                ..Effects::EMPTY
            },
            household: true,
            attached_range: matches!(
                variant,
                Residence::ShopHouse | Residence::Burgage | Residence::Court
            ),
            dwelling: true,
            secondary_business: (variant == Residence::ShopHouse).then_some(household_business),
            subdivision_use: Some(rear_household()),
            ..Roles::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn occupied_frontage_pressure_changes_the_residential_form() {
        let sparse = crate::town::influence::Conditions::default();
        let dense = crate::town::influence::Conditions {
            density: 0.4,
            ..sparse
        };
        assert_eq!(residential_form(sparse, 2., 0.4, 0.4), Residence::Burgage);
        assert_eq!(residential_form(dense, 2., 0.4, 0.4), Residence::Court);
    }
    #[test]
    fn strong_trade_does_not_exclude_prosperous_residential_forms() {
        assert_eq!(
            residential_form(
                crate::town::influence::Conditions::default(),
                10.,
                0.85,
                0.99
            ),
            Residence::Compound
        );
        assert_eq!(
            residential_form(
                crate::town::influence::Conditions::default(),
                10.,
                0.65,
                0.9
            ),
            Residence::Courtyard
        );
    }
}
