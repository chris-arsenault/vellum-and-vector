use crate::{
    field::{events::Event, Field},
    lattice::sampling::Sampler,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::io;
pub fn volcanic(field: &Field, event: &Event) -> io::Result<f64> {
    let height = field.ground().view(GroundField::Elevation);
    let mut sampler = Sampler::new(&field.mesh);
    let mut surrounding = 0.0;
    for i in 0..16 {
        let angle = i as f64 * std::f64::consts::PI / 8.0;
        surrounding += sampler.sample(
            [
                event.x + angle.cos() * event.radius * 2.0,
                event.y + angle.sin() * event.radius * 2.0,
            ],
            |cell| height.get(cell),
        )?;
    }
    Ok(MapScale::metres(
        sampler.sample([event.x, event.y], |cell| height.get(cell))? - surrounding / 16.0,
        LengthUnit::Native,
    ))
}
fn ring(
    sampler: &mut Sampler<'_>,
    event: &Event,
    distance: f64,
    height: &crate::storage::ReadBand<f64>,
) -> io::Result<f64> {
    let mut sum = 0.0;
    let mut count = 0;
    for direction in 0..16 {
        let angle = direction as f64 * std::f64::consts::PI / 8.0;
        let value = sampler.sample(
            [
                event.x + angle.cos() * distance,
                event.y + angle.sin() * distance,
            ],
            |cell| height.get(cell),
        )?;
        if !value.is_finite() {
            continue;
        }
        sum += value;
        count += 1;
    }
    Ok(if count > 0 {
        sum / f64::from(count)
    } else {
        f64::NAN
    })
}
pub fn crater(field: &Field, event: &Event) -> io::Result<f64> {
    let height = field.ground().view(GroundField::Elevation);
    let mut sampler = Sampler::new(&field.mesh);
    let floor = (sampler.sample([event.x, event.y], |cell| height.get(cell))?
        + ring(&mut sampler, event, event.radius * 0.4, &height)?)
        / 2.0;
    let rim = ring(&mut sampler, event, event.radius, &height)?;
    let plain = ring(&mut sampler, event, event.radius * 2.0, &height)?;
    if ![floor, rim, plain].iter().all(|v| v.is_finite()) {
        return Ok(0.0);
    }
    let relief = MapScale::metres((rim - floor).min(rim - plain), LengthUnit::Native);
    Ok(if relief.is_finite() { relief } else { 0.0 })
}
