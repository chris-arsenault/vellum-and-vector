//! Choosing among options that fields have already weighed.

/// The option one draw picks among weighted options, each in proportion to its weight.
/// River routing chooses between the two lower neighbours its heading falls between
/// this way. Nothing is picked where no weight is above nought.
pub fn ticket(draw: f64, weights: &[f64]) -> Option<usize> {
    let total: f64 = weights.iter().map(|weight| weight.max(0.)).sum();
    if total <= 0. {
        return None;
    }
    let mut passed = 0.;
    let mut last = None;
    for (at, weight) in weights.iter().enumerate() {
        if *weight <= 0. {
            continue;
        }
        passed += weight;
        last = Some(at);
        if draw * total < passed {
            return last;
        }
    }
    last
}

/// The option that scores highest, the earliest among equals. A rule that grows
/// something a piece at a time scores each piece it could take next, with chance in the
/// score, and takes this one.
pub fn best<T>(
    options: impl IntoIterator<Item = T>,
    mut score: impl FnMut(&T) -> f64,
) -> Option<T> {
    let mut held: Option<(f64, T)> = None;
    for option in options {
        let value = score(&option);
        if held.as_ref().is_none_or(|(most, _)| value > *most) {
            held = Some((value, option));
        }
    }
    held.map(|(_, option)| option)
}

/// The option that costs least, the earliest among equals: one turn of growth by
/// accretion, where the cost of each piece on the front carries its share of chance.
pub fn cheapest<T>(
    options: impl IntoIterator<Item = T>,
    mut cost: impl FnMut(&T) -> f64,
) -> Option<T> {
    let mut held: Option<(f64, T)> = None;
    for option in options {
        let value = cost(&option);
        if held.as_ref().is_none_or(|(least, _)| value < *least) {
            held = Some((value, option));
        }
    }
    held.map(|(_, option)| option)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chance::Chance;

    #[test]
    fn a_ticket_picks_each_option_in_proportion_to_its_weight() {
        let chance = Chance::of(5, 0x2f8a);
        let weights = [1., 0., 3., 6.];
        let mut picked = [0usize; 4];
        for n in 0..20_000 {
            picked[ticket(chance.unit([f64::from(n), 0.]), &weights).unwrap()] += 1;
        }
        let share = |at: usize| picked[at] as f64 / 20_000.;
        assert!((share(0) - 0.1).abs() < 0.015, "{picked:?}");
        assert_eq!(picked[1], 0);
        assert!((share(2) - 0.3).abs() < 0.02, "{picked:?}");
        assert!((share(3) - 0.6).abs() < 0.02, "{picked:?}");
        // The ends of the draw fall on the first and last options that weigh anything.
        assert_eq!(ticket(0., &weights), Some(0));
        assert_eq!(ticket(0.999_999, &weights), Some(3));
        assert_eq!(ticket(0.5, &[0., 0.]), None);
        assert_eq!(ticket(0.5, &[]), None);
    }

    #[test]
    fn the_best_and_the_cheapest_are_the_earliest_among_equals() {
        let options = [(0, 2.), (1, 5.), (2, 5.), (3, 1.), (4, 1.)];
        assert_eq!(best(options, |o| o.1).map(|o| o.0), Some(1));
        assert_eq!(cheapest(options, |o| o.1).map(|o| o.0), Some(3));
        assert_eq!(best(Vec::<(usize, f64)>::new(), |o| o.1), None);
    }

    #[test]
    fn chance_in_the_score_lets_a_worse_option_win_sometimes_and_a_far_worse_one_never() {
        // Three pieces on a front cost 1.0, 1.2 and 3.0; chance stretches each cost by up
        // to seven tenths, as continental accretion stretches distance.
        let costs = [1.0, 1.2, 3.0];
        let mut taken = [0usize; 3];
        for turn in 0..4_000 {
            let chance = Chance::of(9, 0x6173);
            let piece = cheapest(0..3, |piece| {
                costs[*piece] * chance.spread([*piece as f64, f64::from(turn)], 1., 0.7)
            });
            taken[piece.unwrap()] += 1;
        }
        assert!(taken[0] > taken[1] && taken[1] > 800, "{taken:?}");
        assert_eq!(taken[2], 0);
    }
}
