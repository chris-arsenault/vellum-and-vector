import { carriedBy } from "../coupling/carriers";
import { runOperation } from "../processOperation";
import { carryHumanLayers } from "./layerOperations";

/** People ride the crust: when the plates move, the layers' owner carries them as a package. */
carriedBy("people", (map, plan) => runOperation(map, carryHumanLayers, { map, plan }));
