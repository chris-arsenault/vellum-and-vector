//! City-wide draws for the identities founded by the district process.
use crate::{
    atlas::dispatch::Input,
    noise::hash_unit,
    parameters::NumericParameter,
    processes::strategies::MapType,
    town::templates::district::{Category, Entry, Trope, CATALOG},
};
use std::io;

const fn control(name: &'static str, default: f64, maximum: Option<f64>) -> NumericParameter {
    NumericParameter {
        name,
        unit: "weight",
        default,
        minimum: Some(f64::MIN_POSITIVE),
        maximum,
        strategy: Some("district-programs"),
        map_types: &[MapType::City],
    }
}
const REPEAT: NumericParameter = control("districtRepeatFactor", 0.8, Some(1.));
const ORDINARY: NumericParameter = control("ordinaryTraitWeight", 2., None);
// owner-direction(2026-11-27): aim for 6–10 coherent districts near 90% developed in a city of about 200,000 by tuning the procedure
const CATCHMENT: NumericParameter = NumericParameter {
    unit: "relative reach",
    minimum: Some(0.1),
    ..control("districtCatchmentScale", 1.8, None)
};
const GEOGRAPHY: NumericParameter = NumericParameter {
    minimum: Some(0.),
    ..control("districtGeographyWeight", 1., None)
};
pub(super) const CONTROLS: &[NumericParameter] = &[
    REPEAT,
    ORDINARY,
    GEOGRAPHY,
    CATCHMENT,
    super::partition::CATCHMENT_BOUNDARY,
];

#[derive(Clone, Copy)]
pub(super) struct Settings {
    pub catchment: f64,
    pub repeat: f64,
    pub ordinary: f64,
    pub geography: f64,
}
impl Settings {
    pub const DEFAULT: Self = Self {
        catchment: CATCHMENT.default,
        repeat: REPEAT.default,
        ordinary: ORDINARY.default,
        geography: GEOGRAPHY.default,
    };
    pub fn from_input(input: &Input) -> io::Result<Self> {
        Ok(Self {
            catchment: input.number(CATCHMENT.name)?,
            repeat: input.number(REPEAT.name)?,
            ordinary: input.number(ORDINARY.name)?,
            geography: input.number(GEOGRAPHY.name)?,
        })
    }
}

#[derive(Default)]
pub(super) struct Draws {
    uses: [usize; Trope::Ordinary as usize + 1],
}
impl Draws {
    pub fn include(&mut self, tropes: impl Iterator<Item = Trope>) {
        for id in tropes {
            self.uses[id as usize] += 1;
        }
    }
    pub fn include_retained(&mut self, program: &serde_json::Value) {
        let traits = program
            .get("traits")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten();
        self.include(
            program
                .get("economic")
                .into_iter()
                .chain(program.get("social"))
                .chain(traits)
                .filter_map(|value| serde_json::from_value::<Trope>(value.clone()).ok()),
        );
    }
    // owner-direction(2026-11-25): repeats become progressively less likely as more districts use a type.
    fn repeat_log_weight(&self, id: Trope, factor: f64) -> f64 {
        let n = self.uses[id as usize] as f64;
        factor.ln() * n * (n + 1.) * 0.5
    }
    pub fn draw(
        &mut self,
        category: Category,
        seed: i32,
        point: [f64; 2],
        settings: Settings,
        weight: impl Fn(Trope) -> f64,
    ) -> Option<&'static Entry> {
        // Exponential race in log space keeps even repeatedly selected types eligible.
        let mut best = None;
        let mut lowest = f64::INFINITY;
        for entry in CATALOG.iter().filter(|entry| entry.category == category) {
            let w = weight(entry.id);
            if w <= 0. {
                continue;
            }
            let roll = hash_unit(seed ^ entry.id as i32, point[0], point[1]).max(f64::MIN_POSITIVE);
            let tilt = if entry.id == Trope::Ordinary {
                1.
            } else {
                settings.geography
            };
            let score = (-roll.ln()).ln()
                - tilt * w.ln()
                - self.repeat_log_weight(entry.id, settings.repeat);
            if score < lowest {
                lowest = score;
                best = Some(entry);
            }
        }
        if let Some(entry) = best {
            self.uses[entry.id as usize] += 1;
        }
        best
    }
    // owner-direction(2026-11-25): each district has at least one trait; Ordinary has no effect and stands alone.
    pub fn traits(
        &mut self,
        seed: i32,
        point: [f64; 2],
        settings: Settings,
        weight: impl Fn(Trope) -> f64,
    ) -> Vec<Trope> {
        let mut picks = Vec::new();
        loop {
            let n = picks.len() as i32;
            let salt = seed.wrapping_add(601 + n * 113);
            if n > 0 && hash_unit(salt ^ 0x46df, point[0], point[1]) >= 0.40_f64.powi(n) {
                break;
            }
            let pick = self.draw(Category::Trait, salt, point, settings, |id| {
                if id == Trope::Ordinary {
                    if n == 0 {
                        settings.ordinary
                    } else {
                        0.
                    }
                } else if picks.contains(&id) {
                    0.
                } else {
                    weight(id)
                }
            });
            let Some(entry) = pick else { break };
            picks.push(entry.id);
            if entry.id == Trope::Ordinary {
                break;
            }
        }
        picks
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_weights_fall_progressively_and_ordinary_is_exclusive() {
        let mut draws = Draws::default();
        let mut previous = 1.;
        for n in 0..5 {
            draws.uses[Trope::Inn as usize] = n;
            let w = draws.repeat_log_weight(Trope::Inn, 0.8).exp();
            assert!((w / previous - 0.8_f64.powi(n as i32)).abs() < 1e-12);
            previous = w;
        }
        for seed in 0..100 {
            let picks = draws.traits(seed, [100., 250.], Settings::DEFAULT, |_| 1.);
            assert!(!picks.is_empty());
            assert!(!picks.contains(&Trope::Ordinary) || picks.len() == 1);
            assert!(picks
                .iter()
                .enumerate()
                .all(|(i, t)| !picks[..i].contains(t)));
        }
    }

    #[test]
    fn ordinary_adds_no_site_pressure_and_a_district_can_have_only_ordinary() {
        use crate::town::templates::district::Demands;

        let mut draws = Draws::default();
        let traits = draws.traits(7, [200., 300.], Settings::DEFAULT, |_| 0.);
        assert_eq!(traits, [Trope::Ordinary]);
        let mut demands = Demands::default();
        Trope::Ordinary.shape_district(Default::default(), &mut demands);
        assert_eq!(demands, Demands::default());
    }
}
