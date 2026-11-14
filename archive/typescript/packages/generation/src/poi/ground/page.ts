import type { PoiGroupPage } from "../poiContract";

export const groundPage: PoiGroupPage = {
  id: "ground",
  name: "Ground and deposits",
  belongs:
    "Material lying in or on the ground that people can find, take or fear, and that lasts because the ground holds it: ore in fractured rock, heavy grains in a slackening river, salt crusted on a closed basin floor, salt dust settled downwind, brine where the dead lie, and the workings people cut to reach such material. The test is always a quantity of material, or a published work on one.",
  excludes:
    "Shapes of the ground, which are relief even when material made them (a glass flat, a basalt flat, an ejecta fan). Water that stands or runs, which is water even when hot or salt (a hot spring, a terminal lake). Living cover, including the heath that grows on salted ground. The recorded events that made a killing ground, and the forges where ore is used, which are settlement works.",
};
