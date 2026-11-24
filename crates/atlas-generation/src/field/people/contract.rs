//! Executable contracts for the population pilot. The owners still implement the commands
//! and answer the questions. The atlas scheduler orders their occurrences.

#[cfg(test)]
use crate::atlas::resolution::{HexSize, Profile, Quality};
use crate::human::catalogue::LayerId;
use std::io;

pub use crate::processes::strategies::{
    Absent, Condition, Contract, EffectTime, MapType, NoSource, Product, Resolution, ScaleBand,
    Site, Source, Strategy, Timing,
};

pub struct Rule<A> {
    pub maps: &'static [MapType],
    pub resolution: ScaleBand,
    pub timing: Option<Timing>,
    pub behavior: Option<A>,
}

impl<A> Rule<A> {
    pub const fn new(maps: &'static [MapType], behavior: Option<A>) -> Self {
        Self {
            maps,
            resolution: ScaleBand::Metric(Resolution::POSITIVE),
            timing: None,
            behavior,
        }
    }

    pub const fn at(maps: &'static [MapType], resolution: ScaleBand, behavior: Option<A>) -> Self {
        Self {
            maps,
            resolution,
            timing: None,
            behavior,
        }
    }

    pub const fn during(mut self, timing: Timing) -> Self
    where
        A: Copy,
    {
        self.timing = Some(timing);
        self
    }
}

impl Source for LayerId {
    type Value = crate::storage::ReadBand<f64>;
}

pub(crate) const fn layer_strategy<A, B: Source>(
    name: &'static str,
    algorithm: A,
    time: EffectTime,
    layer: LayerId,
    boundary: Condition<B>,
) -> Strategy<A, LayerId, B> {
    Strategy {
        name,
        algorithm,
        time,
        slot: "people pass",
        initial: Condition::From {
            source: layer,
            absent: Absent::Error("Missing society layer"),
        },
        boundary,
    }
}

pub(crate) fn initial_layer<A, B: Source>(
    field: &crate::field::Field,
    strategy: &Strategy<A, LayerId, B>,
) -> io::Result<crate::storage::ReadBand<f64>> {
    strategy
        .initial
        .bind(|kind| {
            Ok(Some(
                field.people.view(crate::human::HumanField::Layer(kind)),
            ))
        })?
        .ok_or_else(|| io::Error::other("Society strategy requires an initial layer"))
}

/// Routing used by the pilot's remaining operations while their semantic contracts are adopted.
pub(crate) struct Dispatch<A: 'static> {
    pub id: &'static str,
    pub rules: &'static [Rule<A>],
}

impl<A: Copy> Dispatch<A> {
    pub fn select(&self, site: Site, timing: Timing) -> io::Result<Option<A>> {
        select_rule(self.id, self.rules, site, timing)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULES: &[Rule<u8>] = &[
        Rule::new(MapType::ALL, Some(1)).during(Timing::Elapsed),
        Rule::new(MapType::WORLD, None).during(Timing::Present),
        Rule {
            resolution: ScaleBand::Metric(Resolution {
                above_metres: 0.0,
                through_metres: 100.0,
            }),
            ..Rule::new(MapType::REFINED, Some(2)).during(Timing::Present)
        },
        Rule {
            resolution: ScaleBand::Metric(Resolution {
                above_metres: 100.0,
                through_metres: f64::MAX,
            }),
            ..Rule::new(MapType::REFINED, Some(3)).during(Timing::Present)
        },
    ];

    fn dispatch(rules: &'static [Rule<u8>]) -> Dispatch<u8> {
        Dispatch {
            id: "example",
            rules,
        }
    }

    #[test]
    fn strategy_uses_map_type_cell_metres_and_time_independently() {
        let contract = dispatch(RULES);
        let choose = |map_type, cell_metres, timing| {
            contract
                .select(
                    Site {
                        map_type,
                        cell_metres,
                    },
                    timing,
                )
                .unwrap()
        };
        assert_eq!(choose(MapType::World, 100.0, Timing::Present), None);
        for &kind in MapType::REFINED {
            assert_eq!(choose(kind, 100.0, Timing::Present), Some(2));
            assert_eq!(choose(kind, 101.0, Timing::Present), Some(3));
            assert_eq!(choose(kind, 100.0, Timing::Elapsed), Some(1));
        }
    }

    #[test]
    fn contradictory_and_missing_rules_produce_different_errors() {
        const OVERLAP: &[Rule<u8>] = &[
            Rule::new(MapType::WORLD, Some(1)),
            Rule::new(MapType::WORLD, None).during(Timing::Elapsed),
        ];
        let site = Site {
            map_type: MapType::World,
            cell_metres: 100.0,
        };
        let overlap = dispatch(OVERLAP).select(site, Timing::Elapsed).unwrap_err();
        let missing = dispatch(&[]).select(site, Timing::Elapsed).unwrap_err();
        assert!(overlap.to_string().contains("Overlapping"));
        assert!(missing.to_string().contains("No process disposition"));
    }

    #[test]
    fn atlas_bands_include_the_constructor_endpoints() {
        for (band, lower_included) in [
            (ScaleBand::World, true),
            (ScaleBand::Regional, false),
            (ScaleBand::Street, true),
        ] {
            let (lower, upper, _) = band.endpoints();
            assert_eq!(band.contains(lower), lower_included);
            assert!(band.contains(upper));
            assert!(!band.contains(upper.next_up()));
        }
        for quality in [Quality::Draft, Quality::Standard, Quality::Fine] {
            assert!(ScaleBand::World.contains(quality.cell_span(Profile::World).unwrap()));
            for level in [1, 4, 7] {
                assert!(ScaleBand::Regional.contains(quality.regional_span(level).unwrap()));
            }
            for hex in HexSize::ALL {
                assert!(ScaleBand::Street.contains(quality.real_scale_span(hex)));
            }
        }
    }

    #[test]
    fn input_distinguishes_missing_evidence_from_provider_failure() {
        #[derive(Clone, Copy)]
        struct Parent;
        impl Source for Parent {
            type Value = u8;
        }
        let optional = Condition::From {
            source: Parent,
            absent: Absent::Empty,
        };
        let inactive = Condition::<Parent>::None;
        assert!(inactive
            .bind(|_| panic!("inactive input cannot call a provider"))
            .unwrap()
            .is_none());
        assert_eq!(optional.bind(|_| Ok(Some(4))).unwrap(), Some(4));
        assert_eq!(optional.bind(|_| Ok(None)).unwrap(), None);
        let err = optional
            .bind(|_| Err(io::Error::other("unreadable")))
            .unwrap_err();
        assert_eq!(err.to_string(), "unreadable");
    }
}

/// A matched inactive rule returns None. Missing or ambiguous coverage is an error.
pub(crate) fn select_rule<A: Copy>(
    id: &str,
    rules: &[Rule<A>],
    site: Site,
    timing: Timing,
) -> io::Result<Option<A>> {
    let mut selected = rules.iter().filter(|rule| {
        rule.maps.contains(&site.map_type)
            && rule.resolution.contains(site.cell_metres)
            && rule.timing.is_none_or(|when| when == timing)
    });
    let describe = || {
        format!(
            "{} at {:?} / {} m / {:?}",
            id, site.map_type, site.cell_metres, timing
        )
    };
    let rule = selected
        .next()
        .ok_or_else(|| io::Error::other(format!("No process disposition for {}", describe())))?;
    if selected.next().is_some() {
        return Err(io::Error::other(format!(
            "Overlapping process dispositions for {}",
            describe()
        )));
    }
    Ok(rule.behavior)
}
