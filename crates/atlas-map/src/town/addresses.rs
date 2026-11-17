//! House numbers along a street: odd on the left, even on the right, counted from the street's
//! first point. A generated street starts at the end nearest the settlement's centre; a drawn
//! side street starts where it leaves the street it branches from.
use crate::Bounds;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}
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
/// Numbers as `numbers` gives them, except that plots holding a fixed number keep it (a plot
/// on a locked layer) and every other plot takes the next number on its side that no fixed
/// plot holds, so no two plots share one.
pub fn numbers_around(plots: &[(f64, Side)], fixed: &[Option<u32>]) -> Vec<u32> {
    let mut result = vec![0; plots.len()];
    for (side, first) in [(Side::Left, 1), (Side::Right, 2)] {
        let mut order = (0..plots.len())
            .filter(|&i| plots[i].1 == side)
            .collect::<Vec<_>>();
        // hpc-exempt: orders one street side's plots by distance along the street.
        order.sort_by(|&a, &b| plots[a].0.total_cmp(&plots[b].0));
        let mut used: Vec<u32> = order.iter().filter_map(|&i| fixed[i]).collect();
        let mut next = first;
        for i in order {
            if let Some(held) = fixed[i] {
                result[i] = held;
                continue;
            }
            while used.contains(&next) {
                next += 2;
            }
            result[i] = next;
            used.push(next);
            next += 2;
        }
    }
    result
}
/// A postal line for a building: its number and street.
pub fn address(number: u32, street: &str) -> String {
    format!("{number} {street}")
}

/// A typed address: "12 Mill Lane", "Mill Lane 12" or a street name alone.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddressQuery {
    pub number: Option<u32>,
    pub street: String,
}
impl AddressQuery {
    pub fn parse(text: &str) -> Option<Self> {
        let words: Vec<&str> = text
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|word| !word.is_empty())
            .collect();
        let number =
            |word: Option<&&str>| word.and_then(|w| w.trim_start_matches('#').parse().ok());
        let (number, street) = match (number(words.first()), number(words.last())) {
            (Some(n), _) => (Some(n), &words[1..]),
            (None, Some(n)) => (Some(n), &words[..words.len() - 1]),
            (None, None) => (None, &words[..]),
        };
        let street = normal(&street.join(" "));
        (!street.is_empty()).then_some(Self { number, street })
    }
    /// How well a street name answers the query: exactly, or by its first words.
    pub fn street_match(&self, name: &str) -> Option<Closeness> {
        let name = normal(name);
        if name == self.street {
            Some(Closeness::Exact)
        } else if name.starts_with(&format!("{} ", self.street)) {
            Some(Closeness::Leading)
        } else {
            None
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Closeness {
    Exact,
    Leading,
}
/// Whether two street names are the same name, ignoring case, spacing and punctuation.
pub fn same_street(a: &str, b: &str) -> bool {
    normal(a) == normal(b)
}
fn normal(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// A published building or street found by its address.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddressMatch {
    pub feature_id: String,
    pub layer_id: String,
    pub kind: String,
    pub name: Option<String>,
    /// The address line, or the street's name for a street.
    pub address: String,
    pub bounds: Bounds,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn numbers_run_odd_left_and_even_right_from_the_start() {
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
    #[test]
    fn an_insert_shifts_the_numbers_beyond_it_on_its_side_only() {
        let before = [(10.0, Side::Left), (30.0, Side::Left), (20.0, Side::Right)];
        assert_eq!(numbers(&before), vec![1, 3, 2]);
        let inserted = [
            (10.0, Side::Left),
            (30.0, Side::Left),
            (20.0, Side::Right),
            (15.0, Side::Left),
        ];
        assert_eq!(numbers(&inserted), vec![1, 5, 2, 3]);
        assert_eq!(numbers(&before[1..]), vec![1, 2]);
    }
    #[test]
    fn plots_with_fixed_numbers_keep_them_and_the_rest_avoid_them() {
        let plots = [
            (10.0, Side::Right),
            (25.0, Side::Right),
            (40.0, Side::Right),
        ];
        assert_eq!(
            numbers_around(&plots, &[None, None, Some(4)]),
            vec![2, 6, 4]
        );
        assert_eq!(numbers_around(&plots, &[None, None, None]), numbers(&plots));
        let mixed = [(5.0, Side::Left), (8.0, Side::Left), (9.0, Side::Right)];
        assert_eq!(
            numbers_around(&mixed, &[None, Some(1), None]),
            vec![3, 1, 2]
        );
    }
    #[test]
    fn addresses_parse_with_the_number_first_last_or_missing() {
        let query = AddressQuery::parse("  12 Mill   Lane ").unwrap();
        assert_eq!(query.number, Some(12));
        assert_eq!(query.street, "mill lane");
        assert_eq!(AddressQuery::parse("Mill Lane, 7").unwrap().number, Some(7));
        let street = AddressQuery::parse("Tanner's Row").unwrap();
        assert_eq!(
            (street.number, street.street.as_str()),
            (None, "tanners row")
        );
        assert_eq!(AddressQuery::parse("12"), None);
        assert_eq!(AddressQuery::parse("   "), None);
    }
    #[test]
    fn street_names_match_exactly_or_by_their_first_words() {
        let query = AddressQuery::parse("12 mill lane").unwrap();
        assert_eq!(query.street_match("Mill Lane"), Some(Closeness::Exact));
        assert_eq!(query.street_match("Mill-Lane"), None);
        assert_eq!(query.street_match("Millstone Lane"), None);
        let short = AddressQuery::parse("Mill").unwrap();
        assert_eq!(short.street_match("Mill Lane"), Some(Closeness::Leading));
        assert_eq!(short.street_match("Millstone Lane"), None);
        assert!(same_street("Tanner's Row", "tanners  row"));
    }
}
