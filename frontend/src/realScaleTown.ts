import Draw from "ol/interaction/Draw.js";
import { unByKey } from "ol/Observable.js";
import type { Bounds } from "@atlas/map";
import type { PublishedMapEngine } from "./publishedMapEngine";
import { installSnaps, toGeometry, type EditingEvents } from "./realScaleEditing";

/** The street class and building use the town tools lay; Rust owns widths, plots and names. */
export interface TownChoice {
  roadClass: string;
  use: string;
  /** Blank: the settlement's naming culture names it. */
  name: string;
}
export const defaultTown = (): TownChoice => ({ roadClass: "lane", use: "house", name: "" });
/** A map region to centre the view on, with a count so the same region can be asked again. */
export interface ViewFocus {
  bounds: Bounds;
  serial: number;
}

/** Street classes in the `roadClass` spelling of the Rust settlement vocabulary. */
export const streetClasses: [string, string][] = [
  ["mainStreet", "Main street"],
  ["street", "Street"],
  ["lane", "Lane"],
  ["alley", "Alley"],
];
/** Building uses in the published `use` spelling of the Rust settlement vocabulary. */
export const buildingUses: [string, string][] = [
  ["house", "House"],
  ["inn", "Inn"],
  ["tavern", "Tavern"],
  ["smithy", "Smithy"],
  ["temple", "Temple"],
  ["hall", "Hall"],
  ["marketHall", "Market hall"],
  ["mill", "Mill"],
  ["warehouse", "Warehouse"],
  ["barn", "Barn"],
  ["keep", "Keep"],
  ["barracks", "Barracks"],
  ["bakery", "Bakery"],
  ["weaver", "Weaver's workshop"],
  ["cooper", "Cooper's workshop"],
  ["tannery", "Tannery"],
  ["pottery", "Pottery"],
  ["carpenter", "Carpenter's workshop"],
  ["butcher", "Butcher's shop"],
  ["chandler", "Chandler's shop"],
  ["mason", "Mason's yard"],
  ["brewery", "Brewery"],
];
export const labelOfUse = (use: string) =>
  buildingUses.find(([id]) => id === use)?.[1] ?? use.replace(/([A-Z])/g, " $1").toLowerCase();

const nameOf = (name: string) => name.trim() || null;

/** Draw a street of the chosen class; its ends join the ways they are snapped to. */
export function installStreet(engine: PublishedMapEngine, events: EditingEvents) {
  const { town, target, snapHexes } = events.state();
  const draw = new Draw({ type: "LineString" });
  draw.on("drawend", (event) => {
    void events
      .command({
        command: "drawStreet",
        roadClass: town.roadClass,
        geometry: toGeometry(event.feature.getGeometry()!),
        name: nameOf(town.name),
        creatorLayer: target || null,
      })
      .then((outcome) => {
        if (outcome?.created.length) events.select(outcome.created.slice(0, 1));
      });
    events.drawn();
  });
  engine.map.addInteraction(draw);
  const snaps = installSnaps(engine, snapHexes);
  return () => {
    snaps();
    engine.map.removeInteraction(draw);
  };
}
/** Click beside a street, or in an empty plot, to place a building of the chosen use. */
export function installBuilding(engine: PublishedMapEngine, events: EditingEvents) {
  const { town, target } = events.state();
  const click = engine.map.on("singleclick", (event) => {
    const [x, y] = event.coordinate;
    void events
      .command({
        command: "placeBuilding",
        buildingUse: town.use,
        at: [x, y],
        name: nameOf(town.name),
        creatorLayer: target || null,
      })
      .then((outcome) => {
        if (outcome?.created.length) events.select(outcome.created.slice(0, 1));
      });
    events.drawn();
  });
  return () => unByKey(click);
}
