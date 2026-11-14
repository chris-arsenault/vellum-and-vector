import type { PoiGroupPage } from "../poiContract";

export const settlementsPage: PoiGroupPage = {
  id: "settlements",
  name: "Settlements and works",
  belongs:
    "Places people made or marked, each matched through a published feature record rather than read from a field: where they live and have lived, what they built on water and ways, where they practise magic and keep the sacred, and where history fell on them. They are sited, not emergent; their requirements and suitability read the real ground, and they end when the people who keep them go.",
  excludes:
    "Anything the fields make with no record behind it: a killing ground is Salt's brine, an oasis Greenwood's spring, a lake or a waterfall the water itself, whoever caused them. Roads, lanes and control areas are networks and regions, not places. A mine and a clearance are people's marks too, but belong with the ground and the cover they change.",
};
