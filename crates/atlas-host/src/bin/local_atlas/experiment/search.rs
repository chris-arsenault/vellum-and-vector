use super::measure::Metric;
use atlas_generation::atlas::dispatch::experiment::{Change, Target};
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum Search {
    Sweep {
        target: Target,
        parameter: String,
        values: Vec<f64>,
    },
    Bisect {
        target: Target,
        parameter: String,
        lower: f64,
        upper: f64,
        tolerance: f64,
        metric: Metric,
        threshold: f64,
    },
}

impl Search {
    pub fn parameter(&self) -> &str {
        match self {
            Self::Sweep { parameter, .. } | Self::Bisect { parameter, .. } => parameter,
        }
    }
    pub fn metric(&self) -> Option<Metric> {
        match self {
            Self::Sweep { .. } => None,
            Self::Bisect { metric, .. } => Some(*metric),
        }
    }
    pub fn validate(&self) -> io::Result<()> {
        match self {
            Self::Sweep { values, .. } if values.is_empty() => {
                Err(io::Error::other("Give the sweep at least one value"))
            }
            Self::Bisect {
                lower,
                upper,
                tolerance,
                ..
            } if lower >= upper || *tolerance <= 0. => Err(io::Error::other(
                "Bisection needs increasing endpoints and a positive tolerance",
            )),
            _ => Ok(()),
        }
    }
    pub fn run(
        &self,
        trial: &mut impl FnMut(Option<Change>) -> io::Result<Option<f64>>,
    ) -> io::Result<Option<[f64; 2]>> {
        let target = match self {
            Self::Sweep { target, .. } | Self::Bisect { target, .. } => target,
        };
        let mut run = |value| {
            trial(Some(Change {
                target: target.clone(),
                parameter: self.parameter().into(),
                value,
            }))
        };
        match self {
            Self::Sweep { values, .. } => {
                for &value in values {
                    run(value)?;
                }
                Ok(None)
            }
            Self::Bisect {
                lower,
                upper,
                tolerance,
                threshold,
                ..
            } => {
                let mut measured = |value| {
                    run(value)?.ok_or_else(|| {
                        io::Error::other(format!(
                            "Bisection trial at {value} did not produce its measurement"
                        ))
                    })
                };
                bisect([*lower, *upper], *tolerance, *threshold, &mut measured).map(Some)
            }
        }
    }
}

fn bisect(
    [mut low, mut high]: [f64; 2],
    tolerance: f64,
    threshold: f64,
    observe: &mut impl FnMut(f64) -> io::Result<f64>,
) -> io::Result<[f64; 2]> {
    let left = observe(low)?;
    let right = observe(high)?;
    if left == threshold {
        return Ok([low, low]);
    }
    if right == threshold {
        return Ok([high, high]);
    }
    if (left < threshold) == (right < threshold) {
        return Err(io::Error::other(format!(
            "Bisection endpoints measured {left} and {right}. They do not bracket {threshold}"
        )));
    }
    while high - low > tolerance {
        let mid = low.midpoint(high);
        if mid == low || mid == high {
            break;
        }
        let value = observe(mid)?;
        if value == threshold {
            return Ok([mid, mid]);
        }
        if (left < threshold) == (value < threshold) {
            low = mid;
        } else {
            high = mid;
        }
    }
    Ok([low, high])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bisection_brackets_a_threshold_in_both_directions() {
        for sign in [-1., 1.] {
            let [low, high] = bisect([0., 10.], 0.01, 3.14 * sign, &mut |x| Ok(x * sign)).unwrap();
            assert!((low..=high).contains(&3.14));
            assert!(high - low <= 0.01);
        }
    }

    #[test]
    fn bisection_rejects_an_unbracketed_threshold() {
        assert!(bisect([0., 10.], 0.01, 11., &mut Ok).is_err());
    }
}
