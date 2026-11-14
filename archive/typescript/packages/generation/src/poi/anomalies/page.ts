import type { PoiGroupPage } from "../poiContract";

export const anomaliesPage: PoiGroupPage = {
  id: "anomalies",
  name: "Sky and field anomalies",
  belongs:
    "Places where a field departs from its normal state and no landform, water body or cover makes the place: light gathered in ice and hollows, a compass swinging over fallen metal, a standing pattern of crossing Pressure rays, and the fabric of space torn or joined. Each is measured in the magic channels, and each acts mostly on what moves across it.",
  excludes:
    "Magic that leaves a landform, which is in Relief (crater, ejecta fan, basalt flat, glass flat, frost prism, sinkhole field); magic that is a water feature, which is in Water (vent, oasis, melt line); Pressure's marks on the sea, which are in Sea (locus, crush zone, front, wake, rogue impact); Fire and Salt deposits in the ground, which are in Ground (thermal vein, placer, salt pan). A wild zone is in Living cover: it is ground and cover moving between surveys, read from Veil's wildness rather than a tear's standing strain.",
};
