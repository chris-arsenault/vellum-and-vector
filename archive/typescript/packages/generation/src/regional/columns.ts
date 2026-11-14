import { fieldSampleIndex, gridPosition, groupByLabel, requireChannel } from "@atlas/domain";
import { captureContactBeds, realizeContacts, type ContactPlan } from "../rock/contactRealization";
import { nativePosition, parentChannels } from "../world/atlasWorkspace";
import { isContent } from "./lattice";
import type { RegionalState } from "./state";

/** Expose the captured beds before organization asks which faces yield. */
export function prepareColumns(state: RegionalState) {
  state.regional.contacts = contactPlans(state);
  realizeColumns(state);
}

/** Valley placement changes the occupied facets; resolve again from the original captured beds. */
export function realizeColumns(state: RegionalState) {
  const map = state.physical.map;
  for (const { cells, reference, beds } of state.regional.contacts ?? [])
    realizeContacts(map, cells, reference, beds);
}

/** Captured complete donors supply beds and absolute contacts; the child supplies their footprint. */
function contactPlans(state: RegionalState): ContactPlan[] {
  const work = state.physical,
    map = work.map,
    source = parentChannels(state).get("RockLayerKind0") ?? state.surface,
    donors = new Int32Array(map.mesh.count).fill(-1);
  for (let cell = 0; cell < donors.length; cell++)
    if (isContent(map.mesh, cell) && map.WaterKindCodes.get(cell) !== 1)
      donors[cell] = fieldSampleIndex(source, nativePosition(work, cell));
  const groups = groupByLabel(donors, source.active.length),
    height = requireChannel(source, "BedrockElevation"),
    share = requireChannel(source, "GroundCutShare"),
    depth = requireChannel(source, "GroundCutDepth"),
    plans: ContactPlan[] = [];
  for (let donor = 0; donor < groups.count; donor++) {
    const cells = groups.members_of(donor);
    if (!cells.length) continue;
    // representation-exempt: this is the captured donor's datum, not a cell on this map's lattice.
    const at = gridPosition(source, donor),
      land = height.get(donor) + share.get(donor) * depth.get(donor);
    plans.push({
      cells: Array.from(cells),
      reference: { x: at.x, y: at.y, land, cut: land - depth.get(donor) },
      beds: captureContactBeds(map, cells[0]),
    });
  }
  return plans;
}
