//! Creator-facing configuration. Hosts submit choices; Rust owns their interpretation.
use atlas_generation::atlas::configuration::{self, cartography, defaults, Input};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub world_id: Option<atlas_map::Id>,
    pub name: String,
    pub width: f64,
    pub height: f64,
    pub recipe: Value,
}
impl Configuration {
    pub fn from_map(
        document: &crate::generation_document::Document,
        map: &atlas_map::MapDescriptor,
    ) -> io::Result<Self> {
        // The world document keys its areas by identity text.
        let world = &document.world;
        let map_area = map.reference.map_id.to_string();
        let mut area = Some(map_area.as_str());
        let mut run = None;
        while let Some(id) = area {
            run = world["generations"]
                .as_array()
                .and_then(|runs| runs.iter().rev().find(|run| run["areaId"] == id));
            if run.is_some() {
                break;
            }
            area = world["areas"][id]["parentId"].as_str();
        }
        let mut configuration = Self::default_configuration()?;
        configuration.world_id = Some(map.world_id);
        configuration.name = world["areas"][&map_area]["name"]
            .as_str()
            .unwrap_or_default()
            .into();
        let bounds = map.bounds;
        configuration.width = bounds.2 - bounds.0;
        configuration.height = bounds.3 - bounds.1;
        if let Some(run) = run {
            for key in ["seed", "quality", "domains", "parameters"] {
                configuration.recipe[key] = run[key].clone();
            }
            configuration.recipe["features"] =
                run["configuration"]["inputs"]["features"]["selection"].clone();
            configuration.recipe["settings"] = run["configuration"]["inputs"]["settings"].clone();
        }
        configuration.normalize()
    }
    /// The recipe's input for `area`; a configuration read before its area exists passes
    /// the nil identity.
    pub fn input(&self, area: atlas_map::Id) -> io::Result<Input> {
        let mut recipe = self.recipe.clone();
        let fields = recipe
            .as_object_mut()
            .ok_or_else(|| io::Error::other("Generation recipe is an object"))?;
        if fields.remove("schemaVersion") != Some(json!(3)) {
            return Err(io::Error::other("Use the current generation recipe"));
        }
        fields.insert("areaId".into(), area.into());
        Ok(serde_json::from_value(recipe)?)
    }
    pub fn normalize(mut self) -> io::Result<Self> {
        if !self.width.is_finite()
            || !self.height.is_finite()
            || self.width <= 0.0
            || self.height <= 0.0
        {
            return Err(io::Error::other(
                "World dimensions must be positive finite metres",
            ));
        }
        let input = self.input(atlas_map::Id::NIL)?;
        let resolved = configuration::resolve(&input, &defaults::settings()?)?;
        self.recipe["parameters"] = json!(resolved.parameters);
        self.recipe["settings"] = json!(resolved.settings);
        // Preserve the creator's choices for domains not selected for this execution.
        let mut all = input.clone();
        all.domains = ["physical", "magic", "cultural", "political", "built"]
            .map(str::to_owned)
            .to_vec();
        self.recipe["features"] =
            json!(configuration::resolve(&all, &defaults::settings()?)?.selection);
        Ok(self)
    }
    pub fn default_configuration() -> io::Result<Self> {
        let defaults: Value = serde_json::from_str(defaults::JSON)?;
        Ok(Self {
            world_id: None,
            name: String::new(),
            width: defaults["width"]
                .as_f64()
                .ok_or_else(|| io::Error::other("Default width"))?,
            height: defaults["height"]
                .as_f64()
                .ok_or_else(|| io::Error::other("Default height"))?,
            recipe: defaults["recipe"].clone(),
        })
    }
    pub fn choose(self, control: &str, choice: &str) -> io::Result<Self> {
        let mut configuration = self.normalize()?;
        let mut input = configuration.input(atlas_map::Id::NIL)?;
        cartography::apply(&mut input, control, choice)?;
        configuration.recipe["features"] = serde_json::to_value(input.features)?;
        configuration.recipe["domains"] = serde_json::to_value(input.domains)?;
        configuration.normalize()
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Choice {
    pub configuration: Configuration,
    pub control: String,
    pub choice: String,
}
impl Choice {
    pub fn apply(self) -> io::Result<Configuration> {
        self.configuration.choose(&self.control, &self.choice)
    }
}
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn generation_presentation() -> String {
    let mut features: Vec<Value> =
        serde_json::from_str(cartography::PRESENTATION).expect("Static creator presentation");
    let magic = features
        .iter_mut()
        .find(|feature| feature["id"] == "magic.configured")
        .expect("Magic configuration");
    magic["magicPresentation"] = serde_json::from_str(atlas_generation::magic::PRESENTATION)
        .expect("Static magic presentation");
    magic["magicPresentation"]["dimensions"] =
        atlas_generation::magic::parameters::Parameters::dimensions();
    features
        .iter_mut()
        .find(|feature| feature["id"] == "ecology.living")
        .expect("Ecology configuration")["epochDefaults"] =
        json!(atlas_generation::atlas::context::EcologyEpoch::default());
    serde_json::to_string(&features).expect("Creator presentation JSON")
}
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn choose_generation_configuration(value: &str) -> Result<String, String> {
    let result = serde_json::from_str::<Choice>(value)
        .map_err(io::Error::other)
        .and_then(Choice::apply)
        .and_then(|value| Ok(serde_json::to_string(&value)?));
    result.map_err(|e| e.to_string())
}
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn normalize_generation_configuration(value: &str) -> Result<String, String> {
    let result = serde_json::from_str::<Configuration>(value)
        .map_err(io::Error::other)
        .and_then(Configuration::normalize)
        .and_then(|value| Ok(serde_json::to_string(&value)?));
    result.map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_choices_keep_balanced_terrain_and_restless_motion() -> io::Result<()> {
        let input = Configuration::default_configuration()?
            .normalize()?
            .input(atlas_map::Id::NIL)?;
        let controls = cartography::controls()?;
        for (id, choice) in [("terrain", "balanced"), ("continental-motion", "restless")] {
            let control = controls.iter().find(|control| control["id"] == id).unwrap();
            assert_eq!(control["defaultChoice"], choice);
            assert_eq!(
                cartography::selected(control, &input.features)?,
                Some(choice.into())
            );
        }
        let quiet =
            Configuration::default_configuration()?.choose("continental-motion", "quiet")?;
        let restless =
            Configuration::default_configuration()?.choose("continental-motion", "restless")?;
        let quiet = quiet.input(atlas_map::Id::NIL)?.settings.unwrap();
        let restless = restless.input(atlas_map::Id::NIL)?.settings.unwrap();
        for (quiet, restless) in quiet.epochs.iter().zip(&restless.epochs) {
            assert!(restless.plate_travel > quiet.plate_travel);
            assert_eq!(restless.tectonics, quiet.tectonics);
        }
        Ok(())
    }
    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn creator_review_uses_contracts_without_opening_numerical_inputs() -> io::Result<()> {
        let configuration = Configuration::default_configuration()?.normalize()?;
        let input = configuration.input(atlas_map::Id::NIL)?;
        let source = crate::generation_world::CreateWorld {
            id: atlas_map::Id::from_name("review-world"),
            name: "Atlas".into(),
            seed: input.seed,
            width: configuration.width,
            height: configuration.height,
            settings: input.settings,
            boundary_mode: None,
        }
        .create()?;
        let input = configuration.input(source.scope.located.area_id)?;
        let spatial = atlas_gis::geometry::NativeGeos::new(1e-6).map_err(io::Error::other)?;
        let resources = crate::native_resources::NativeResources::new(std::path::PathBuf::new());
        let review = crate::generation_submission::Submission { source, input }
            .request(&spatial)?
            .resolve(&spatial, &resources)?
            .review(&spatial)?;
        assert_eq!(review["diagnostics"], json!([]));
        assert!(review["setup"]["features"]
            .as_array()
            .is_some_and(|features| features.len() > 20));
        Ok(())
    }
    #[test]
    fn choices_preserve_unowned_configuration_and_the_existing_clock() -> io::Result<()> {
        let configuration = Configuration::default_configuration()?.normalize()?;
        let before = configuration.recipe["features"]["physical.lifecycle"]["configuration"]
            ["epochs"]
            .clone();
        let configuration = configuration.choose("landmarks", "prominent")?;
        let after =
            &configuration.recipe["features"]["physical.lifecycle"]["configuration"]["epochs"];
        let before = before.as_array().unwrap();
        let after = after.as_array().unwrap();
        assert_eq!(before.len(), after.len());
        for (before, after) in before.iter().zip(after) {
            assert_eq!(before["id"], after["id"]);
            assert_eq!(before["duration"], after["duration"]);
        }
        let control = cartography::controls()?
            .into_iter()
            .find(|control| control["system"] == "fire")
            .unwrap();
        let id = control["id"].as_str().unwrap();
        let choice = control["choices"][0]["id"].as_str().unwrap();
        let others = configuration.recipe["features"]["magic.configured"]["configuration"]
            ["magicSystems"]
            .clone();
        let configuration = configuration.choose(id, choice)?;
        let systems = configuration.recipe["features"]["magic.configured"]["configuration"]
            ["magicSystems"]
            .as_array()
            .unwrap();
        for previous in others
            .as_array()
            .unwrap()
            .iter()
            .filter(|system| system["id"] != "fire")
        {
            assert_eq!(
                systems.iter().find(|system| system["id"] == previous["id"]),
                Some(previous)
            );
        }
        assert_eq!(
            cartography::selected(&control, &configuration.input(atlas_map::Id::NIL)?.features)?,
            Some(choice.into())
        );
        Ok(())
    }
    #[test]
    fn defaults_create_a_current_private_world() -> io::Result<()> {
        let configuration = Configuration::default_configuration()?.normalize()?;
        let input = configuration.input(atlas_map::Id::NIL)?;
        let world = crate::generation_world::CreateWorld {
            id: atlas_map::Id::from_name("default-world"),
            name: "Atlas".into(),
            seed: input.seed,
            width: configuration.width,
            height: configuration.height,
            settings: input.settings,
            boundary_mode: None,
        }
        .create()?;
        let geography: crate::generation_frame::Geography = serde_json::from_value(world.world)?;
        assert!(geography.areas.contains_key(&world.scope.located.area_id));
        assert!(geography.fields.is_empty());
        Ok(())
    }
}
