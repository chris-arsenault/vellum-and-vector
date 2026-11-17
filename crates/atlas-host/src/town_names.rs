//! Names for the streets and buildings a creator adds to a town, from the same atlas naming
//! vocabulary generation names a town's streets and households with. The map store asks for
//! them; naming stays outside GIS storage.
use atlas_gis::authoring::TownNames;
use atlas_names::{random::Random, Names, Request};
use std::io;

pub struct AtlasNames;
impl TownNames for AtlasNames {
    fn work(&self, culture: Option<&str>, work: &str, seed: &str) -> io::Result<String> {
        let names = Names::atlas();
        let chosen = culture
            .and_then(|id| names.cultures.iter().find(|c| c.id == id))
            .unwrap_or_else(|| &names.cultures[Random::new(seed).index(names.cultures.len())]);
        names.generate(
            chosen,
            Request {
                seed,
                kind: "societyWork",
                subkind: Some(work),
                term: work,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn town_names_end_in_their_work_term_and_any_culture_gives_one() {
        let lane = AtlasNames
            .work(Some("marches"), "lane", "map:street-1:lane")
            .unwrap();
        let terms = ["Lane", "Alley", "Wynd", "Close", "Court", "Passage", "Walk"];
        assert!(terms.iter().any(|term| lane.ends_with(term)), "{lane}");
        let inn = AtlasNames
            .work(Some("unknown"), "inn", "map:inn-1:inn")
            .unwrap();
        assert!(!inn.trim().is_empty());
        assert_eq!(
            inn,
            AtlasNames
                .work(Some("unknown"), "inn", "map:inn-1:inn")
                .unwrap()
        );
    }
}
