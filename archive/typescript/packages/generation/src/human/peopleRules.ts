import { humanLayers } from "@atlas/domain";
import { respond } from "../coupling/answers";

/**
 * The rules people's passes obey, stated as answers so that whoever can set one aside does it
 * here and not inside a pass. Left alone: what strikes takes its whole share; everyone is free
 * to move; those who stay build; what is left fades at its usual rate; an allegiance gives way
 * as readily as any; and the people on a cell are the people who live there.
 */
const whole = () => 1;
respond({ key: "harm", by: "what strikes", reads: [], base: whole });
respond({ key: "moving", by: "people free to go", reads: [], base: whole });
respond({ key: "building", by: "people who stay", reads: [], base: whole });
respond({ key: "forgetting", by: "time", reads: [], base: whole });
respond({ key: "yielding", by: "people who can change their minds", reads: [], base: whole });
respond({
  key: "presence",
  by: "the living",
  reads: [humanLayers.population],
  base: (map, i) => map[humanLayers.population].get(i),
});
