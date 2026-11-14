//! NameForge's character chains, trained from the complete atlas place corpora.
use crate::random::Random;
use std::{collections::BTreeMap, io};

pub struct Model {
    order: usize,
    transitions: BTreeMap<String, Vec<(char, f64)>>,
}
impl Model {
    pub fn train(samples: &str, order: usize) -> io::Result<Self> {
        if order == 0 {
            return Err(io::Error::other("Markov order must be positive"));
        }
        let mut transitions: BTreeMap<String, Vec<(char, f64)>> = BTreeMap::new();
        for sample in samples.split_whitespace() {
            if sample.contains(['^', '$']) {
                return Err(io::Error::other("Name contains a Markov boundary marker"));
            }
            if sample.chars().count() < 2 {
                continue;
            }
            let padded: Vec<_> = format!("{}{}$", "^".repeat(order), sample.to_lowercase())
                .chars()
                .collect();
            for window in padded.windows(order + 1) {
                let row = transitions
                    .entry(window[..order].iter().collect())
                    .or_default();
                let character = window[order];
                match row.iter_mut().find(|(held, _)| *held == character) {
                    Some((_, count)) => *count += 1.0,
                    None => row.push((character, 1.0)),
                }
            }
        }
        if transitions.is_empty() {
            return Err(io::Error::other("Markov training has no usable names"));
        }
        Ok(Self { order, transitions })
    }
    fn attempt(&self, random: &mut Random, maximum: usize) -> Option<String> {
        let mut state = "^".repeat(self.order);
        let mut word = String::new();
        for _ in 0..=maximum {
            let row = self.transitions.get(&state)?;
            let weights: Vec<_> = row.iter().map(|(_, count)| *count).collect();
            let next = row[random.weighted(&weights)?].0;
            if next == '$' {
                return Some(word);
            }
            word.push(next);
            state = state.chars().skip(1).chain([next]).collect();
        }
        None
    }
    pub fn generate(
        &self,
        random: &mut Random,
        minimum: usize,
        maximum: usize,
    ) -> io::Result<String> {
        if minimum == 0 || maximum < minimum {
            return Err(io::Error::other("Invalid Markov name length interval"));
        }
        for _ in 0..128 {
            if let Some(word) = self.attempt(random, maximum) {
                if word.chars().count() >= minimum {
                    return Ok(word);
                }
            }
        }
        Err(io::Error::other(
            "Markov model could not finish a name in the requested length interval",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finished_names_are_not_truncated() {
        let model = Model::train("Ashford", 3).unwrap();
        let mut random = Random::new("complete-name");
        assert_eq!(model.generate(&mut random, 7, 7).unwrap(), "ashford");
        assert!(model.generate(&mut random, 4, 6).is_err());
        assert!(Model::train("", 3).is_err());
        assert!(Model::train("Ashford", 0).is_err());
    }
}
