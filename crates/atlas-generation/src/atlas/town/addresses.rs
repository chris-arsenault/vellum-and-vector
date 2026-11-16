//! House numbers along a street: odd on the left, even on the right, counted from the end
//! nearest the settlement's centre, where every street begins.
use super::plots::Side;

/// The number of each plot, given its distance along the street and its side; plots keep
/// their order in the result.
pub fn numbers(plots: &[(f64, Side)]) -> Vec<u32> {
    let mut result = vec![0; plots.len()];
    for (side, first) in [(Side::Left, 1), (Side::Right, 2)] {
        let mut order = (0..plots.len())
            .filter(|&i| plots[i].1 == side)
            .collect::<Vec<_>>();
        // hpc-exempt: orders one street side's plots by distance along the street.
        order.sort_by(|&a, &b| plots[a].0.total_cmp(&plots[b].0));
        for (rank, i) in order.into_iter().enumerate() {
            result[i] = first + 2 * rank as u32;
        }
    }
    result
}
/// A postal line for a building: its number and street.
pub fn address(number: u32, street: &str) -> String {
    format!("{number} {street}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn numbers_run_odd_left_and_even_right_from_the_centre_end() {
        let plots = [
            (30.0, Side::Left),
            (5.0, Side::Right),
            (10.0, Side::Left),
            (50.0, Side::Right),
            (12.0, Side::Right),
            (70.0, Side::Left),
        ];
        assert_eq!(numbers(&plots), vec![3, 2, 1, 6, 4, 5]);
        assert_eq!(numbers(&[]), Vec::<u32>::new());
        assert_eq!(address(12, "Mill Lane"), "12 Mill Lane");
    }
}
