//! Reconstruct lateral overlap by actual contact altitudes, retaining empty space and finite cargo.
use super::{
    deformation::{deform_fabric, deform_slope},
    transport::{
        HeldRock, TransferObservation, TransferOperation, TransferPhase, PLACEMENT_FIELDS,
        SHEET_FIELDS,
    },
    Ground, GroundField as F,
};
use crate::{
    rock::{
        cargo_identity::CargoIdentities,
        catalogue::KIND_COUNT,
        coarsening::{coarsen_package, same_material},
        columns::Column,
        material::{MaterialLayer, MaterialMixture},
    },
    settlement::removal::Facet,
    storage::{Band, Coverage},
    transport::{DeformationBands, GroundArrivals},
};
use std::io;
struct Arrival {
    source: usize,
    weight: f64,
    cut: f64,
    deformation: [f64; 4],
}
struct Section {
    weight: f64,
    top: f64,
    layers: Vec<MaterialLayer>,
}
struct RemapSource {
    ready: Band<u8>,
    occupied: Band<u8>,
    orientation: Band<f64>,
}
fn column_start(column: Column) -> usize {
    match column {
        Column::Land => 0,
        Column::Cut => 8,
        Column::Loose => 16,
        Column::CutLoose => 20,
    }
}
impl RemapSource {
    fn new(coverage: &mut Coverage) -> io::Result<Self> {
        let count = coverage.len();
        let orientation_count = count
            .checked_mul(96)
            .ok_or_else(|| io::Error::other("Remap orientation exceeds address representation"))?;
        Ok(Self {
            ready: coverage.scratch(count, 0),
            occupied: coverage.scratch(count * 4, 0),
            orientation: coverage.scratch(orientation_count, 0.0),
        })
    }
    fn prepare(&mut self, held: &HeldRock, source: usize, deformation: [f64; 4]) -> io::Result<()> {
        if self.ready.get(source)? != 0 {
            return Ok(());
        }
        for column in Column::ALL {
            let mut mask = 0u8;
            for slot in 0..column.size() {
                if held.depth(source, column, slot)? <= 0.0 {
                    continue;
                }
                mask |= 1 << slot;
                let [gx, gy, sx, sy] = held.orientation(source, column, slot)?;
                let [gx, gy] = deform_fabric(gx, gy, deformation);
                let [sx, sy] = deform_slope(sx, sy, deformation);
                let at = (source * 24 + column_start(column) + slot) * 4;
                for (offset, value) in [gx, gy, sx, sy].into_iter().enumerate() {
                    self.orientation.set(at + offset, value)?;
                }
            }
            self.occupied.set(source * 4 + column as usize, mask)?;
        }
        self.ready.set(source, 1)
    }
    fn layers(
        &mut self,
        held: &HeldRock,
        identities: &CargoIdentities,
        donor: &Arrival,
        column: Column,
    ) -> io::Result<Vec<MaterialLayer>> {
        self.prepare(held, donor.source, donor.deformation)?;
        let mask = self.occupied.get(donor.source * 4 + column as usize)?;
        let mut layers = Vec::new();
        for slot in 0..column.size() {
            if mask & (1 << slot) == 0 {
                continue;
            }
            let at = (donor.source * 24 + column_start(column) + slot) * 4;
            let mut layer = identities.released_material(held.layer(donor.source, column, slot)?);
            layer.grain_x = self.orientation.get(at)?;
            layer.grain_y = self.orientation.get(at + 1)?;
            layer.bed_slope_x = self.orientation.get(at + 2)?;
            layer.bed_slope_y = self.orientation.get(at + 3)?;
            layers.push(layer);
        }
        Ok(layers)
    }
}
fn incoming(
    held: &HeldRock,
    cell: usize,
    arrivals: &GroundArrivals,
    deformation: &DeformationBands,
) -> io::Result<Vec<Arrival>> {
    let mut donors = Vec::new();
    let mut area = 0.0;
    for at in arrivals.offsets.get(cell)?..arrivals.offsets.get(cell + 1)? {
        let weight = arrivals.weights.get(at as usize)?;
        if weight <= 0.0 {
            continue;
        }
        let source = arrivals.sources.get(at as usize)? as usize;
        donors.push(Arrival {
            source,
            weight,
            cut: held.get(F::GroundCutShare, source)?,
            deformation: deformation.at(source)?,
        });
        area += weight;
    }
    for donor in &mut donors {
        donor.weight /= area;
    }
    Ok(donors)
}
fn share(donor: &Arrival, column: Column) -> f64 {
    if matches!(column, Column::Cut | Column::CutLoose) {
        donor.cut
    } else {
        1.0 - donor.cut
    }
}
fn rock_height(held: &HeldRock, donor: &Arrival, cut: bool) -> io::Result<f64> {
    Ok(held.get(F::BedrockElevation, donor.source)?
        + (donor.cut - f64::from(cut)) * held.get(F::GroundCutDepth, donor.source)?)
}
fn finite_cargo_basement(mut layers: Vec<MaterialLayer>, finite: bool) -> Vec<MaterialLayer> {
    if finite || layers.last().is_none_or(|last| last.cargo.is_none()) {
        return layers;
    }
    let mut last = layers.pop().unwrap();
    if last.depth > 1.0 {
        layers.push(MaterialLayer {
            depth: last.depth - 1.0,
            ..last.clone()
        });
    }
    last.depth = 1.0;
    last.cargo = None;
    layers.push(last);
    layers
}
fn sections(
    held: &HeldRock,
    source: &mut RemapSource,
    identities: &CargoIdentities,
    donors: &[Arrival],
    column: Column,
) -> io::Result<Vec<Section>> {
    let mut area = 0.0;
    let mut result = Vec::new();
    for donor in donors {
        let weight = donor.weight * share(donor, column);
        if weight <= 0.0 {
            continue;
        }
        let layers = finite_cargo_basement(
            source.layers(held, identities, donor, column)?,
            column.finite(),
        );
        let cover = if column.finite() {
            layers.iter().map(|layer| layer.depth).sum()
        } else {
            0.0
        };
        result.push(Section {
            weight,
            top: rock_height(
                held,
                donor,
                matches!(column, Column::Cut | Column::CutLoose),
            )? + cover,
            layers,
        });
        area += weight;
    }
    for section in &mut result {
        section.weight /= area;
    }
    Ok(result)
}
fn next_contact(
    sections: &[Section],
    indices: &[usize],
    tops: &[f64],
    bottoms: &[f64],
    finite: bool,
    above: f64,
) -> f64 {
    let mut next = f64::INFINITY;
    for (i, section) in sections.iter().enumerate() {
        let last = section.layers.len().saturating_sub(usize::from(!finite));
        if above < tops[i] {
            next = next.min(tops[i]);
        } else if indices[i] < last {
            next = next.min(bottoms[i]);
        }
    }
    next
}
fn slab(
    mixture: &mut MaterialMixture,
    sections: &[Section],
    indices: &[usize],
    tops: &[f64],
    above: f64,
    thickness: f64,
) -> io::Result<Option<MaterialLayer>> {
    mixture.reset();
    let (mut occupied, mut marker) = (0.0, 0.0);
    for (i, section) in sections.iter().enumerate() {
        let Some(layer) = section.layers.get(indices[i]) else {
            continue;
        };
        if above < tops[i] {
            continue;
        }
        mixture
            .add(layer, section.weight)
            .map_err(io::Error::other)?;
        occupied += section.weight;
        marker += section.weight * layer.depth;
    }
    Ok(mixture.material(if thickness == f64::INFINITY {
        marker / occupied
    } else {
        thickness * occupied
    }))
}
fn append(layers: &mut Vec<MaterialLayer>, layer: MaterialLayer) {
    if let Some(previous) = layers.last_mut() {
        if same_material(previous, &layer)
            && previous.formed_min == layer.formed_min
            && previous.formed_max == layer.formed_max
        {
            previous.depth += layer.depth;
            return;
        }
    }
    layers.push(layer);
}
fn sweep(
    sections: &[Section],
    finite: bool,
    mixture: &mut MaterialMixture,
) -> io::Result<Vec<MaterialLayer>> {
    let highest = sections
        .iter()
        .map(|section| section.top)
        .fold(f64::NEG_INFINITY, f64::max);
    let mut indices = vec![0; sections.len()];
    let tops: Vec<_> = sections
        .iter()
        .map(|section| highest - section.top)
        .collect();
    let mut bottoms: Vec<_> = sections
        .iter()
        .enumerate()
        .map(|(i, section)| {
            tops[i]
                + section
                    .layers
                    .first()
                    .map_or(f64::INFINITY, |layer| layer.depth)
        })
        .collect();
    let mut layers = Vec::new();
    let mut above = 0.0;
    loop {
        let next = next_contact(sections, &indices, &tops, &bottoms, finite, above);
        if let Some(layer) = slab(mixture, sections, &indices, &tops, above, next - above)? {
            if next.is_finite() {
                append(&mut layers, layer);
            } else if !finite {
                layers.push(layer);
            }
        }
        if next == f64::INFINITY {
            break;
        }
        for (i, section) in sections.iter().enumerate() {
            if indices[i] < section.layers.len().saturating_sub(usize::from(!finite))
                && bottoms[i] <= next
            {
                indices[i] += 1;
                bottoms[i] += section
                    .layers
                    .get(indices[i])
                    .map_or(f64::INFINITY, |layer| layer.depth);
            }
        }
        above = next;
    }
    Ok(layers)
}
pub struct GroundRemapper<'a> {
    ground: &'a mut Ground,
    held: &'a HeldRock,
    deformation: &'a DeformationBands,
    source: RemapSource,
    mixture: MaterialMixture,
}
impl<'a> GroundRemapper<'a> {
    pub fn form_opening(&mut self, cell: usize) -> io::Result<()> {
        self.ground.form_transport_opening(cell)
    }
    pub fn new(
        ground: &'a mut Ground,
        held: &'a HeldRock,
        deformation: &'a DeformationBands,
        coverage: &mut Coverage,
    ) -> io::Result<Self> {
        Ok(Self {
            ground,
            held,
            deformation,
            source: RemapSource::new(coverage)?,
            mixture: MaterialMixture::new(KIND_COUNT),
        })
    }
    pub fn place(&mut self, cell: usize, arrivals: &GroundArrivals) -> io::Result<()> {
        let donors = incoming(self.held, cell, arrivals, self.deformation)?;
        if donors.is_empty() {
            return Ok(());
        }
        if donors.len() == 1 && self.ordered_donor(&donors[0])? {
            return self.ground.place_carried(
                self.held,
                cell,
                donors[0].source,
                donors[0].deformation,
            );
        }
        self.observe(cell, &donors, TransferPhase::Before)?;
        for column in Column::ALL {
            self.install(cell, &donors, column)?;
        }
        self.place_facets(cell, &donors)?;
        self.order_facets(cell)?;
        self.ground.project(cell)?;
        self.observe(cell, &donors, TransferPhase::After)
    }
    fn observe(&self, cell: usize, donors: &[Arrival], phase: TransferPhase) -> io::Result<()> {
        for donor in donors {
            self.ground.observe_transfer(
                self.held,
                TransferObservation {
                    operation: TransferOperation::PlateRemap,
                    phase,
                    source: donor.source,
                    target: cell,
                    accepted: None,
                    retained_area_share: Some(donor.weight),
                },
            )?;
        }
        Ok(())
    }
    fn install(&mut self, cell: usize, donors: &[Arrival], column: Column) -> io::Result<()> {
        let sections = sections(
            self.held,
            &mut self.source,
            &self.ground.identities,
            donors,
            column,
        )?;
        let mut layers = sweep(&sections, column.finite(), &mut self.mixture)?;
        let initial = layers.len();
        coarsen_package(&mut layers, column.size(), !column.finite(), &mut |fold| {
            self.ground.events.folded(cell, column, &fold)
        })?;
        self.ground
            .events
            .remapped_package(column, initial, layers.len())?;
        for slot in 0..column.size() {
            self.ground.columns.set_layer(
                cell,
                column,
                slot,
                layers.get(slot).unwrap_or(&MaterialLayer::default()),
            )?;
        }
        Ok(())
    }
    fn place_facets(&mut self, cell: usize, donors: &[Arrival]) -> io::Result<()> {
        let cut: f64 = donors.iter().map(|donor| donor.weight * donor.cut).sum();
        let land_height = facet_height(self.held, donors, Column::Land)?;
        let cut_height = facet_height(self.held, donors, Column::Cut)?;
        for name in PLACEMENT_FIELDS {
            let mean = donors.iter().try_fold(0.0, |sum, donor| {
                Ok::<_, io::Error>(sum + donor.weight * self.held.get(name, donor.source)?)
            })?;
            self.ground.set(name, cell, mean)?;
        }
        self.ground.set(F::GroundCutShare, cell, cut)?;
        self.ground.set(
            F::GroundCutDepth,
            cell,
            if cut > 0.0 && cut < 1.0 {
                land_height - cut_height
            } else {
                0.0
            },
        )?;
        self.ground.set(
            F::BedrockElevation,
            cell,
            land_height * (1.0 - cut) + cut_height * cut,
        )?;
        let mut dominant = &donors[0];
        for donor in donors.iter().skip(1) {
            if donor.weight > dominant.weight {
                dominant = donor;
            }
        }
        for name in SHEET_FIELDS.into_iter().chain([
            F::CrustSuturePairIds,
            F::CrustSutureStrength,
            F::CrustProvinceSeam,
        ]) {
            self.ground
                .set(name, cell, self.held.get(name, dominant.source)?)?;
        }
        Ok(())
    }
    fn order_facets(&mut self, cell: usize) -> io::Result<()> {
        let cut = self.ground.get(F::GroundCutShare, cell)?;
        if cut <= 0.0
            || cut >= 1.0
            || self.ground.surface(cell, Facet::Land)? >= self.ground.surface(cell, Facet::Cut)?
        {
            return Ok(());
        }
        for (land, valley) in [
            (Column::Land, Column::Cut),
            (Column::Loose, Column::CutLoose),
        ] {
            for slot in 0..land.size() {
                let a = self.ground.columns.read_raw_layer(cell, land, slot)?;
                let b = self.ground.columns.read_raw_layer(cell, valley, slot)?;
                self.ground.columns.set_layer(cell, land, slot, &b)?;
                self.ground.columns.set_layer(cell, valley, slot, &a)?;
            }
        }
        self.ground.set(F::GroundCutShare, cell, 1.0 - cut)?;
        self.ground.set(
            F::GroundCutDepth,
            cell,
            -self.ground.get(F::GroundCutDepth, cell)?,
        )
    }
    fn ordered_donor(&self, donor: &Arrival) -> io::Result<bool> {
        if donor.cut <= 0.0 || donor.cut >= 1.0 {
            return Ok(true);
        }
        let cover = |column| {
            self.held
                .layers(donor.source, column)
                .map(|layers| layers.iter().map(|layer| layer.depth).sum::<f64>())
        };
        Ok(
            rock_height(self.held, donor, false)? + cover(Column::Loose)?
                >= rock_height(self.held, donor, true)? + cover(Column::CutLoose)?,
        )
    }
}
fn facet_height(held: &HeldRock, donors: &[Arrival], column: Column) -> io::Result<f64> {
    let (mut height, mut area) = (0.0, 0.0);
    for donor in donors {
        let weight = donor.weight * share(donor, column);
        height += rock_height(held, donor, column == Column::Cut)? * weight;
        area += weight;
    }
    Ok(if area > 0.0 { height / area } else { 0.0 })
}
