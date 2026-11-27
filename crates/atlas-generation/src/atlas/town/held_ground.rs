//! The settlement ground held between town steps. Every step reads the walking ground (the
//! map's terrain with walls and buildings marked) and the frontage steps the occupied ground
//! (with premises and works grounds marked too). Building them anew marked every building of
//! every town at every step; here a step marks only what was added since the last one, and
//! the ground is built again only when the terrain, a wall or a marked shape changed or went.
use super::{
    ground::{Ground, FIELD, PLOT, SQUARE},
    site,
};
use crate::{atlas::state::State, spatial::SpatialKernel};
use atlas_map::Geometry;
// hpc-exempt: fingerprints of marked shapes, a few per holding.
use std::collections::HashSet;
use std::{cell::RefCell, io, rc::Rc};

/// A ground marked in layers over a base: each layer's shapes with one mark, in order.
struct Marked {
    base: u64,
    ground: Rc<Ground>,
    layers: Vec<HashSet<u64>>,
}
/// Shapes of one layer by fingerprint.
type Layer = (u32, Vec<(u64, Geometry)>);
fn mark_layer(
    ground: &mut Ground,
    shapes: &[Geometry],
    mark: u32,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    if mark == FIELD {
        ground.mark_ploughed(shapes, spatial)
    } else {
        ground.mark_shapes(shapes, mark, spatial)
    }
}
impl Marked {
    /// The ground for `layers` over the base `key`: marked incrementally while every shape
    /// marked before is still present, else built again from `base`.
    fn update(
        held: &mut Option<Self>,
        key: u64,
        base: impl FnOnce() -> io::Result<Ground>,
        layers: &[Layer],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Rc<Ground>> {
        let current: Vec<HashSet<u64>> = layers
            .iter()
            .map(|(_, shapes)| shapes.iter().map(|(print, _)| *print).collect())
            .collect();
        if let Some(marked) = held.as_mut().filter(|m| {
            m.base == key
                && m.layers.len() == current.len()
                && m.layers
                    .iter()
                    .zip(&current)
                    .all(|(old, new)| old.is_subset(new))
        }) {
            for ((mark, shapes), old) in layers.iter().zip(&marked.layers) {
                let added: Vec<Geometry> = shapes
                    .iter()
                    .filter(|(print, _)| !old.contains(print))
                    .map(|(_, shape)| shape.clone())
                    .collect();
                if !added.is_empty() {
                    mark_layer(Rc::make_mut(&mut marked.ground), &added, *mark, spatial)?;
                }
            }
            marked.layers = current;
            return Ok(marked.ground.clone());
        }
        let mut ground = base()?;
        for (mark, shapes) in layers {
            let shapes: Vec<Geometry> = shapes.iter().map(|(_, s)| s.clone()).collect();
            mark_layer(&mut ground, &shapes, *mark, spatial)?;
        }
        let ground = Rc::new(ground);
        *held = Some(Self {
            base: key,
            ground: ground.clone(),
            layers: current,
        });
        Ok(ground)
    }
}
fn printed(shapes: impl Iterator<Item = Geometry>) -> Vec<(u64, Geometry)> {
    shapes.map(|shape| (shape.fingerprint(), shape)).collect()
}
#[derive(Default)]
struct Grounds {
    terrain: Option<(u64, Rc<Ground>)>,
    walking: Option<Marked>,
    occupied: Option<Marked>,
}
/// Held between the steps of one town development; cloning shares the held grounds.
#[derive(Clone, Default)]
pub(super) struct HeldGround(Rc<RefCell<Grounds>>);
impl HeldGround {
    /// The map's terrain with the towns' walls: read again only when the field, the drawn
    /// water, the recorded fortifications or a town's walls changed.
    fn terrain(&self, state: &State) -> io::Result<(u64, Rc<Ground>)> {
        let key = site::terrain_key(state)?;
        let mut grounds = self.0.borrow_mut();
        if let Some((held, ground)) = &grounds.terrain {
            if *held == key {
                return Ok((key, ground.clone()));
            }
        }
        let ground = Rc::new(site::walled_terrain(state)?);
        grounds.terrain = Some((key, ground.clone()));
        Ok((key, ground))
    }
    pub fn walking(&self, state: &State) -> io::Result<Rc<Ground>> {
        let (key, terrain) = self.terrain(state)?;
        let crops = state
            .town
            .fields
            .iter()
            .filter(|f| !f.pasture && f.worked > 0.)
            .map(|f| f.outline.clone());
        let layers = [
            (PLOT, printed(site::ground_buildings(state))),
            (FIELD, printed(crops)),
        ];
        let mut grounds = self.0.borrow_mut();
        Marked::update(
            &mut grounds.walking,
            key,
            || Ok((*terrain).clone()),
            &layers,
            state.spatial.as_ref(),
        )
    }
    /// The walking ground with every town's ground-level premises and works grounds marked.
    pub fn occupied(&self, state: &State) -> io::Result<Rc<Ground>> {
        let (key, terrain) = self.terrain(state)?;
        let towns = &state.town.towns;
        let premises = towns
            .iter()
            .flat_map(|t| t.holdings().iter())
            .filter(|h| {
                h.slot
                    .habitat
                    .shares_surface(crate::town::templates::Habitat::Ground)
            })
            .map(|h| h.outline.clone());
        let works = towns
            .iter()
            .flat_map(|t| &t.works.commissions)
            .filter_map(|w| w.grounds.clone());
        let reserved = towns
            .iter()
            .filter_map(|t| t.district.as_ref())
            .flat_map(|d| d.reserves.iter().cloned());
        let layers = [
            (PLOT, printed(site::ground_buildings(state))),
            (PLOT, printed(premises)),
            (SQUARE, printed(works.chain(reserved))),
        ];
        let mut grounds = self.0.borrow_mut();
        Marked::update(
            &mut grounds.occupied,
            key,
            || Ok((*terrain).clone()),
            &layers,
            state.spatial.as_ref(),
        )
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use atlas_map::{regions::rectangle, Bounds};

    fn square(w: f64, s: f64) -> Geometry {
        rectangle(Bounds(w, s, w + 10., s + 10.))
    }
    /// A step that adds a shape marks only it; a step without a marked shape builds again.
    #[test]
    fn grounds_are_marked_with_what_was_added_and_rebuilt_when_a_shape_goes() {
        let spatial = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let base = || Ok(Ground::new([0., 0., 100., 100.], 1.));
        let mut held = None;
        let layer = |shapes: &[Geometry]| [(PLOT, printed(shapes.iter().cloned()))];
        let (a, b) = (square(10., 10.), square(50., 50.));
        let first = Marked::update(
            &mut held,
            1,
            base,
            &layer(std::slice::from_ref(&a)),
            &spatial,
        )
        .unwrap();
        assert_eq!(first.owner([15., 15.]), PLOT);
        assert_ne!(first.owner([55., 55.]), PLOT);
        drop(first);
        // Adding a shape marks the held ground in place: no rebuild.
        let rebuilt = std::cell::Cell::new(false);
        let watched = || {
            rebuilt.set(true);
            base()
        };
        let second = Marked::update(
            &mut held,
            1,
            watched,
            &layer(&[a.clone(), b.clone()]),
            &spatial,
        )
        .unwrap();
        assert!(!rebuilt.get());
        assert_eq!(second.owner([55., 55.]), PLOT);
        // The shape at (10, 10) is gone: the ground is built again without it.
        let third = Marked::update(
            &mut held,
            1,
            || {
                rebuilt.set(true);
                base()
            },
            &layer(std::slice::from_ref(&b)),
            &spatial,
        )
        .unwrap();
        assert!(rebuilt.get());
        assert_ne!(third.owner([15., 15.]), PLOT);
        assert_eq!(third.owner([55., 55.]), PLOT);
    }
}
