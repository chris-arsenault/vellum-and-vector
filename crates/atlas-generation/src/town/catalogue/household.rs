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
/// The form a household takes. Where the City found how much built ground a resident of
/// the tract has beside a street household's, the share of households that live spaciously
/// is the share of that ground beyond what street households would take, and the share
/// that crowds is the share of it they lack. The rest, and every household of a standalone
/// town, choose as a street household does.
fn residential_form(
    local: crate::town::influence::Conditions,
    activity: f64,
    means: f64,
    sample: f64,
) -> Residence {
    let room = local.spaciousness.filter(|room| *room > 0.).unwrap_or(1.);
    let apart = if room > 1. { 1. - 1. / room } else { 1. - room };
    if sample >= apart {
        // Households in sample order past that share are the tract's street households.
        let rest = (sample - apart) / (1. - apart);
        return street_household_form(local, activity, means, rest);
    }
    if room > 1. {
        spacious_form(means)
    } else {
        crowded_form(local)
    }
}
/// A household with ground to spare: a compound for the rich, a courtyard house for the
/// comfortable, a croft for the rest.
fn spacious_form(means: f64) -> Residence {
    if means > 0.72 {
        Residence::Compound
    } else if means > 0.55 {
        Residence::Courtyard
    } else {
        Residence::Croft
    }
}
/// A household short of ground: a place in a lodging court, or an incremental house where
/// nuisance and waste keep better building away.
fn crowded_form(local: crate::town::influence::Conditions) -> Residence {
    if local.nuisance + local.waste > 0.45 {
        Residence::Incremental
    } else {
        Residence::Court
    }
}
fn street_household_form(
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
                // A great house lends its street standing, and a town's order says how
                // far a household's means rise with the standing round it.
                dignifies: match variant {
                    Residence::Compound => 0.9,
                    Residence::Courtyard => 0.4,
                    _ => 0.,
                },
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
    fn households_take_the_form_that_fits_the_ground_the_city_found_they_have() {
        let at = |room: Option<f64>| crate::town::influence::Conditions {
            spaciousness: room,
            ..Default::default()
        };
        let forms = |room: Option<f64>, means: f64| -> Vec<Residence> {
            (0..100)
                .map(|i| residential_form(at(room), 2., means, (f64::from(i) + 0.5) / 100.))
                .collect()
        };
        let share = |forms: &[Residence], wanted: &[Residence]| {
            forms.iter().filter(|form| wanted.contains(form)).count()
        };
        // A town with no City to speak for it chooses as it always has, and so does a
        // tract whose residents have a street household's ground.
        assert_eq!(forms(None, 0.4), forms(Some(1.), 0.4));
        // With four times a street household's ground, three households in four live
        // spaciously: crofts for ordinary means, compounds for the rich.
        let estates = forms(Some(4.), 0.4);
        assert_eq!(
            share(&estates, &[Residence::Croft]),
            75 + share(&forms(None, 0.4)[..25], &[Residence::Croft])
        );
        assert!(share(&forms(Some(4.), 0.9), &[Residence::Compound]) >= 75);
        // With two fifths of it, three in five crowd into lodging courts.
        let tenements = forms(Some(0.4), 0.4);
        assert!(share(&tenements, &[Residence::Court]) >= 60);
        // The households past those shares are the same street households as anywhere.
        assert_eq!(
            residential_form(at(Some(4.)), 2., 0.4, 0.75 + 0.25 * 0.4),
            residential_form(at(None), 2., 0.4, 0.4)
        );
    }

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
