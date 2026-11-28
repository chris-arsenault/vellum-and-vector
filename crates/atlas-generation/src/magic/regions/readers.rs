use super::Inputs;
use crate::{
    chance::Chance,
    field::shared::{CellCode, Scalar},
    magic::{channels::Channel, configuration::Condition, sources::Environment},
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
    water::column::Store,
};
use std::io;
pub(super) type Reader<'a> = Box<dyn Fn(usize) -> io::Result<f64> + 'a>;
pub(super) fn condition<'a>(
    env: &'a Environment<'_>,
    input: &'a Inputs<'a>,
    test: &Condition,
) -> io::Result<Reader<'a>> {
    let key = test.field.as_str();
    if let Some(id) = key.strip_prefix("system:") {
        if let Some(read) = input.system_read {
            let id = id.to_owned();
            return Ok(Box::new(move |cell| read(&id, cell)));
        }
        let participant = input
            .fields
            .iter()
            .find(|field| field.definition.id == id && field.definition.enabled);
        return Ok(Box::new(move |cell| {
            participant.map_or(Ok(f64::NAN), |field| {
                field.channels.band(Channel::Intensity).get(cell)
            })
        }));
    }
    if let Some(id) = key.strip_prefix("source:") {
        let index = input
            .field
            .definition
            .origins
            .iter()
            .position(|origin| origin.id == id);
        return Ok(Box::new(move |cell| {
            index.map_or(Ok(0.0), |index| input.field.origins[index].source.get(cell))
        }));
    }
    if let Some(key) = key.strip_prefix("stock:") {
        return Ok(stock(env, input, key));
    }
    if key == "noise" || key == "scatter" {
        return Ok(noise(env, input, test));
    }
    if key == "elevation" {
        let values = env.ground.view(GroundField::Elevation);
        return Ok(Box::new(move |cell| {
            Ok(MapScale::metres(
                values.get(cell)? - env.water.effective_sea_level,
                LengthUnit::Native,
            ))
        }));
    }
    Ok(channel(env, input, key))
}
fn stock<'a>(env: &'a Environment<'_>, input: &'a Inputs<'a>, key: &str) -> Reader<'a> {
    let key = key.to_owned();
    Box::new(move |cell| input.field.stock_reading(env.ground, env.mesh, &key, cell))
}
fn noise<'a>(env: &'a Environment<'_>, input: &'a Inputs<'a>, test: &Condition) -> Reader<'a> {
    let salt = test.salt;
    let index = test.index.unwrap_or(0);
    let scale = input.field.definition.parameters.feature_noise_scale;
    if test.field == "noise" {
        Box::new(move |cell| {
            let [x, y] = env.mesh.position(cell);
            let field = Chance::of(salt.unwrap_or(0x621d), 0).noise(scale, 1);
            Ok((field.on(env.mesh, [x, y]) + 1.0) * 0.5)
        })
    } else {
        Box::new(move |cell| {
            let [x, y] = env.mesh.position(cell);
            Ok(Chance::of(input.seed, salt.unwrap_or(0)).unit([
                (x / scale).floor(),
                f64::from(((y / scale).floor() as i32) ^ index),
            ]))
        })
    }
}
fn channel<'a>(env: &'a Environment<'_>, input: &'a Inputs<'a>, key: &str) -> Reader<'a> {
    if let Some(channel) = Channel::ALL.iter().find(|c| c.definition().name == key) {
        let band = input.field.channels.view(*channel);
        return Box::new(move |cell| band.get(cell));
    }
    if let Some(name) = scalar(key) {
        let band = env.fields.scalar(name);
        return Box::new(move |cell| band.get(cell));
    }
    match key {
        "water" => Box::new(move |cell| Ok(f64::from(env.water.column.kind.get(cell)?))),
        "river" => Box::new(move |cell| Ok(f64::from(env.water.river_orders.get(cell)?))),
        "soilWater" => Box::new(move |cell| env.water.column.store(Store::Soil).held(cell)),
        "soilDepth" => {
            let band = env.ground.view(GroundField::SoilDepth);
            Box::new(move |cell| band.get(cell))
        }
        "biome" | "landform" => {
            let band = env.fields.code(if key == "biome" {
                CellCode::BiomeCodes
            } else {
                CellCode::LandformCodes
            });
            Box::new(move |cell| Ok(f64::from(band.get(cell)?)))
        }
        _ => Box::new(|_| Ok(0.0)),
    }
}
fn scalar(key: &str) -> Option<Scalar> {
    Some(match key {
        "slope" => Scalar::Slope,
        "upwelling" => Scalar::Upwelling,
        "quickening" => Scalar::Quickening,
        "stillness" => Scalar::Stillness,
        "fog" => Scalar::FogForcing,
        "verdure" => Scalar::Verdure,
        "temperature" => Scalar::Temperature,
        "ice" => Scalar::IceThickness,
        "moisture" => Scalar::Moisture,
        "geothermal" => Scalar::Geothermal,
        "fracture" => Scalar::FractureConductance,
        "treeCover" => Scalar::TreeCover,
        "wetlandCover" => Scalar::WetlandCover,
        "peatCarbon" => Scalar::PeatCarbon,
        "oilCarbon" => Scalar::OilCarbon,
        "ecologicalToxicity" => Scalar::EcologicalToxicity,
        "grazers" => Scalar::Grazers,
        "browsers" => Scalar::Browsers,
        _ => return None,
    })
}
