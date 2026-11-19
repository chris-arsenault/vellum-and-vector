use super::{placed_strength, Context, Environment};
use crate::magic::{
    channels::Channel,
    state::{LocatedSource, MagicField},
};
use std::io;
pub struct PlacedSource {
    pub id: atlas_map::Id,
    pub system_id: String,
    pub space_id: Option<atlas_map::Id>,
    pub starts_at_epoch: i32,
    pub strength: f64,
    pub radius: f64,
    pub position: [f64; 2],
}
pub fn locate(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    sources: &[PlacedSource],
    space_id: atlas_map::Id,
) -> io::Result<()> {
    let origin = &field.definition.origins[context.origin];
    let offset = env.mesh.origin();
    for source in sources {
        if source.system_id != field.definition.id
            || source.space_id.is_some_and(|space| space != space_id)
            || source.starts_at_epoch > context.epoch
        {
            continue;
        }
        let strength = placed_strength(source.strength, origin.source, context.activity);
        if strength <= 0.0 {
            continue;
        }
        let [x, y] = [
            source.position[0] - offset[0],
            source.position[1] - offset[1],
        ];
        let Some(cell) = env.mesh.cell_at(x, y) else {
            continue;
        };
        let before = field.channels.band(Channel::Source).get(cell)?;
        field
            .channels
            .band_mut(Channel::Source)
            .set(cell, before.max(strength))?;
        field
            .channels
            .band_mut(Channel::Radii)
            .set(cell, source.radius)?;
        field.located.push(LocatedSource {
            origin: String::new(),
            id: source.id.to_string(),
            x,
            y,
            radius: source.radius,
            strength,
        });
    }
    Ok(())
}
