use super::{
    catalogue::Catalogue,
    contract::Entry,
    state::State,
    values::{Carrier, Place},
};
use std::{io, rc::Rc};

/// Retain the declared numerical factors in the map's existing typed resource storage.
pub fn carrier_band(
    field: &crate::field::Field,
    factors: &[f64],
) -> io::Result<crate::storage::ReadBand<f64>> {
    if factors.len() != field.mesh.len() {
        return Err(io::Error::other(
            "Carrier factors must cover the map lattice",
        ));
    }
    let mut band = field.coverage.borrow_mut().allocate(1.0);
    for (cell, &value) in factors.iter().enumerate() {
        band.set(cell, value)?;
    }
    Ok(band.read_only())
}
#[derive(Clone, Copy)]
pub enum Network {
    Roads,
    Boats,
}
impl Network {
    fn name(self) -> &'static str {
        match self {
            Self::Roads => "roads",
            Self::Boats => "boats",
        }
    }
}
pub fn network_factors<S: State, Schedule>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
    network: Network,
    places: impl Fn(&Entry<S, Schedule>) -> io::Result<Vec<Place>>,
) -> io::Result<Rc<Vec<f64>>> {
    state.held().get(&format!("cost:{}", network.name()), || {
        let mut cost = vec![1.0; state.field()?.mesh.len()];
        for entry in catalogue.entries() {
            let effect = match network {
                Network::Roads => &entry.roles.movement.roads,
                Network::Boats => &entry.roles.movement.boats,
            };
            if let Some(list) = effect.value() {
                for place in places(entry)? {
                    for change in list(state, &place)? {
                        cost[change.cell] *= change.factor;
                    }
                }
            }
        }
        Ok(cost)
    })
}
pub fn carrier_factors<S: State, Schedule>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
    carrier: Carrier,
    places: impl Fn(&Entry<S, Schedule>) -> io::Result<Vec<Place>>,
) -> io::Result<Vec<f64>> {
    let mut cost = vec![1.0; state.field()?.mesh.len()];
    for entry in catalogue.entries() {
        let Some(list) = entry
            .roles
            .movement
            .magic
            .value()
            .and_then(|m| m.get(&carrier))
        else {
            continue;
        };
        for place in places(entry)? {
            for change in list(state, &place)? {
                cost[change.cell] *= change.factor;
            }
        }
    }
    Ok(cost)
}
pub fn drainage_costs<'a, S: 'a, Schedule: 'a>(
    state: &S,
    carried: impl IntoIterator<Item = (&'a Entry<S, Schedule>, &'a Place)>,
    cost: &mut [f64],
) -> io::Result<()> {
    for (entry, place) in carried {
        if let Some(list) = entry.roles.movement.drainage.value() {
            for change in list(state, place)? {
                cost[change.cell] *= change.factor;
            }
        }
    }
    Ok(())
}
pub fn place_links<S: State, Schedule>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
    places: impl Fn(&Entry<S, Schedule>) -> io::Result<Vec<Place>>,
) -> io::Result<Rc<Vec<i32>>> {
    state.held().get("links", || {
        let mut links = vec![-1; state.field()?.mesh.len()];
        for entry in catalogue.entries() {
            if let Some(list) = entry.roles.movement.links.value() {
                for place in places(entry)? {
                    for link in list(state, &place)? {
                        links[link.a] = link.b as i32;
                        links[link.b] = link.a as i32;
                    }
                }
            }
        }
        Ok(links)
    })
}
