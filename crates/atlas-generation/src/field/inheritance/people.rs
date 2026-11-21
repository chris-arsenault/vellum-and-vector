use super::Samples;
use crate::{
    field::FieldSeed,
    human::{
        catalogue::LayerId,
        identity::{IdentityLayer, IDENTITY_SLOTS},
        HumanField,
    },
};
use std::io;

pub(super) fn install(samples: &Samples, seed: &mut FieldSeed, cell: usize) -> io::Result<()> {
    for (layer, name) in
        LayerId::ALL
            .into_iter()
            .zip(["Population", "Farmland", "Pasture", "BuiltUp", "Standing"])
    {
        if let Some(value) = samples.get(name, cell)? {
            seed.people
                .initialize(HumanField::Layer(layer), cell, value)?;
        }
    }
    for (field, name) in [
        (HumanField::RuinedBuiltUp, "RuinedBuiltUp"),
        (HumanField::RuinedStanding, "RuinedStanding"),
        (HumanField::RuinCover, "RuinCover"),
    ] {
        if let Some(value) = samples.get(name, cell)? {
            seed.people.initialize(field, cell, value)?;
        }
    }
    if let Some(value) = samples.get("RuinTongue", cell)? {
        seed.people
            .initialize_ruin_tongue(cell, (value + 0.5).floor() as i32)?;
    }
    let mut identities: [IdentityLayer; IDENTITY_SLOTS] =
        std::array::from_fn(|_| IdentityLayer::default());
    for (slot, identity) in identities.iter_mut().enumerate() {
        let get = |part| {
            samples
                .get(&format!("Identity{part}{slot}"), cell)
                .map(|v| v.unwrap_or(0.0))
        };
        identity.people = get("People")?;
        identity.hardness = get("Hardness")?;
        identity.age = get("Age")?;
        for (value, part) in identity
            .traditions
            .iter_mut()
            .zip(crate::human::identity::Tradition::NAMES)
        {
            // Maps captured before people knew a second tongue have no band for it.
            let read = if part == "Known" {
                get(part).unwrap_or(0.0)
            } else {
                get(part)?
            };
            *value = (read + 0.5).floor() as i32;
        }
    }
    seed.people.initialize_column(cell, &identities)
}
