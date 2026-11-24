//! The city's commissioned works keep their sites through the numerical development rounds.
use crate::{
    atlas::state::State,
    field::{
        people::work::habitable,
        poi::{
            kinds::Kind,
            map_records::{generated, Record},
            values::Place,
        },
    },
    town::{major_works::city_works, templates::Selection},
};
use atlas_map::{Geometry, Position};
use std::io;

pub(super) fn site(state: &mut State, selection: &Selection, seed: i32) -> io::Result<()> {
    if state
        .regional
        .as_ref()
        .is_none_or(|r| r.round > 1 || !r.city.works.is_empty())
    {
        return Ok(());
    }
    let mesh = state.field().mesh();
    let extent = state.scope.settled_outline();
    let points: Vec<_> = (0..mesh.len())
        .map(|cell| {
            let [x, y] = position(state, cell);
            Position::xy(x, y)
        })
        .collect();
    let inside = state
        .spatial
        .covers_points(extent, &points)
        .map_err(io::Error::other)?;
    let mut cells = Vec::new();
    let mut candidates = Vec::new();
    let mut population = 0.;
    for (cell, p) in points.into_iter().enumerate() {
        if !inside[cell] || !habitable(state.field(), cell)? {
            continue;
        }
        population += state.field().people().people(cell)? * mesh.area(cell) / 1e6;
        cells.push(cell);
        candidates.push(Geometry::Point { coordinates: p });
    }
    let total = super::settlement(state)?
        .and_then(|s| s.people)
        .unwrap_or(population);
    let index = state.spatial.index(&candidates).map_err(io::Error::other)?;
    let mut works = Vec::new();
    for (family, [x, y]) in city_works(&selection.site, total, seed) {
        if let Some(i) = index
            .nearest(Position::xy(x, y))
            .map_err(io::Error::other)?
        {
            works.push((family, cells[i] as u32));
        }
    }
    state.regional.as_mut().unwrap().city.works = works;
    Ok(())
}
fn position(state: &State, cell: usize) -> [f64; 2] {
    let mesh = state.field().mesh();
    let [x, y] = mesh.position(cell);
    let [ox, oy] = mesh.origin();
    [x + ox, y + oy]
}

/// Each major work at its site.
pub(super) fn work_records(state: &State) -> io::Result<Vec<Place>> {
    let Some(city) = state.regional.as_ref().map(|r| &r.city) else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (index, &(family, cell)) in city.works.iter().enumerate() {
        let appearance = family.city();
        let [x, y] = position(state, cell as usize);
        let mut attributes = crate::features::records::Attributes::new();
        // District maps inherit captured works by this attribute (`atlas/town/founding_site`).
        attributes.insert("majorWorkFamily".into(), family.key().into());
        attributes.insert("symbol".into(), appearance.symbol.into());
        attributes.insert("groundM2".into(), appearance.ground.into());
        let key = format!("major-work-{index}");
        let feature = generated(
            state,
            Record {
                key: &key,
                name: family.label(),
                kind: "majorWork",
                layer: "settlements",
                geometry: Geometry::Point {
                    coordinates: Position::xy(x, y),
                },
                attributes,
            },
        )?;
        let mut place = Place::at(Kind::MajorWork, cell as usize, vec![cell as usize]);
        place.id = key;
        place.feature = Some(feature);
        records.push(place);
    }
    Ok(records)
}
