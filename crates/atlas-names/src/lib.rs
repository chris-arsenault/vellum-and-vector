//! The atlas's NameForge profiles: Markov, compound and qualified geographic names.
//! Ported from packages/name-forge and the atlas-owned namingCultures configuration.
//! The atlas has no phonotactic domains; this crate implements its configured grammar forms.
mod markov;
pub mod random;
use markov::Model;
use random::Random;
use serde::Deserialize;
use std::{collections::BTreeMap, io, sync::OnceLock};

#[derive(Deserialize)]
struct Source {
    id: String,
    samples: String,
    roots: String,
    endings: String,
    qualifiers: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vocabulary {
    cultures: Vec<Source>,
    work_terms: BTreeMap<String, String>,
}
pub struct Culture {
    pub id: String,
    roots: Vec<String>,
    endings: Vec<String>,
    qualifiers: Vec<String>,
    markov2: Model,
    markov3: Model,
}
pub struct Names {
    pub cultures: Vec<Culture>,
    work_terms: BTreeMap<String, Vec<String>>,
}
fn words(value: &str) -> Vec<String> {
    value.split_whitespace().map(str::to_owned).collect()
}
fn choose<'a>(random: &mut Random, words: &'a [String]) -> &'a str {
    &words[random.index(words.len())]
}
fn title_words(value: &str) -> String {
    value
        .split_whitespace()
        .map(|word| {
            let word = word.to_lowercase();
            let mut characters = word.chars();
            characters
                .next()
                .map(|first| first.to_uppercase().chain(characters).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}
impl Culture {
    fn from(source: Source) -> io::Result<Self> {
        Ok(Self {
            id: source.id,
            roots: words(&source.roots),
            endings: words(&source.endings),
            qualifiers: words(&source.qualifiers),
            markov2: Model::train(&source.samples, 2)?,
            markov3: Model::train(&source.samples, 3)?,
        })
    }
    fn form(&self, random: &mut Random) -> io::Result<String> {
        match random.weighted(&[45.0, 30.0, 15.0, 10.0]).unwrap() {
            0 => self.markov3.generate(random, 5, 14),
            1 => self.markov2.generate(random, 5, 14),
            2 => Ok(format!(
                "{}{}{}",
                choose(random, &self.roots),
                if self.id == "wadis" { " " } else { "" },
                choose(random, &self.endings)
            )),
            _ => Ok(format!(
                "{} {}",
                choose(random, &self.qualifiers),
                self.markov2.generate(random, 5, 14)?
            )),
        }
    }
}
impl Names {
    pub fn atlas() -> &'static Self {
        static NAMES: OnceLock<Names> = OnceLock::new();
        NAMES.get_or_init(|| {
            let vocabulary: Vocabulary = serde_json::from_str(include_str!("vocabulary.json"))
                .expect("Embedded atlas vocabulary");
            Self {
                cultures: vocabulary
                    .cultures
                    .into_iter()
                    .map(Culture::from)
                    .collect::<io::Result<_>>()
                    .expect("Atlas corpora train usable name models"),
                work_terms: vocabulary
                    .work_terms
                    .into_iter()
                    .map(|(kind, words)| (kind, words.split('|').map(str::to_owned).collect()))
                    .collect(),
            }
        })
    }
    pub fn generate(&self, culture: &Culture, request: Request<'_>) -> io::Result<String> {
        let mut random = Random::new(request.seed);
        let name = culture.form(&mut random)?;
        let suffix = match request.kind {
            "settlement" | "culture" => "",
            "societyWork" => self
                .work_terms
                .get(request.subkind.unwrap_or_default())
                .map(|terms| choose(&mut random, terms))
                .unwrap_or(request.term),
            "biome" | "ocean" | "polity" | "river" | "lake" | "landform" | "magic" => request.term,
            _ => {
                return Err(io::Error::other(format!(
                    "No atlas naming profile for {}",
                    request.kind
                )))
            }
        };
        Ok(title_words(&format!("{name} {suffix}")))
    }
}
pub struct Request<'a> {
    pub seed: &'a str,
    pub kind: &'a str,
    pub subkind: Option<&'a str>,
    pub term: &'a str,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atlas_profiles_keep_geographic_terms_and_work_vocabulary() {
        let names = Names::atlas();
        for culture in &names.cultures {
            let name = names
                .generate(
                    culture,
                    Request {
                        seed: "forest",
                        kind: "biome",
                        subkind: Some("Boreal forest"),
                        term: "Boreal forest",
                    },
                )
                .unwrap();
            assert!(name.ends_with(" Boreal Forest"));
            assert!(!name.contains("slot:"));
            for (work, terms) in &names.work_terms {
                let name = names
                    .generate(
                        culture,
                        Request {
                            seed: work,
                            kind: "societyWork",
                            subkind: Some(work),
                            term: work,
                        },
                    )
                    .unwrap();
                assert!(terms
                    .iter()
                    .any(|term| name.ends_with(&format!(" {}", title_words(term)))));
            }
        }
    }
}
