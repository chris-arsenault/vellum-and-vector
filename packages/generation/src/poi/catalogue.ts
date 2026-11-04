import type { PoiEntry, PoiGroupPage } from "./poiContract";
import type { PoiGroupId, PoiKindId } from "./poiKinds";
import { reliefPage } from "./relief/page";
import { summit } from "./relief/summit";
import { pass } from "./relief/pass";
import { ridge } from "./relief/ridge";
import { escarpment } from "./relief/escarpment";
import { valley } from "./relief/valley";
import { gorge } from "./relief/gorge";
import { plateau } from "./relief/plateau";
import { volcano } from "./relief/volcano";
import { caldera } from "./relief/caldera";
import { crater } from "./relief/crater";
import { dome } from "./relief/dome";
import { cirque } from "./relief/cirque";
import { moraine } from "./relief/moraine";
import { ejectaFan } from "./relief/ejectaFan";
import { basaltFlat } from "./relief/basaltFlat";
import { sinkholeField } from "./relief/sinkholeField";
import { glassFlat } from "./relief/glassFlat";
import { frostPrism } from "./relief/frostPrism";
import { waterPage } from "./water/page";
import { spring } from "./water/spring";
import { waterfall } from "./water/waterfall";
import { lake } from "./water/lake";
import { riverMouth } from "./water/riverMouth";
import { wetland } from "./water/wetland";
import { fjord } from "./water/fjord";
import { vent } from "./water/vent";
import { oasis } from "./water/oasis";
import { meltLine } from "./water/meltLine";
import { seaPage } from "./sea/page";
import { headland } from "./sea/headland";
import { bay } from "./sea/bay";
import { strait } from "./sea/strait";
import { upwellingFront } from "./sea/upwellingFront";
import { crushZone } from "./sea/crushZone";
import { ancientWake } from "./sea/ancientWake";
import { rogueWaveImpact } from "./sea/rogueWaveImpact";
import { pressureLocus } from "./sea/pressureLocus";
import { groundPage } from "./ground/page";
import { thermalVein } from "./ground/thermalVein";
import { placer } from "./ground/placer";
import { saltPan } from "./ground/saltPan";
import { saltDust } from "./ground/saltDust";
import { killingGround } from "./ground/killingGround";
import { mine } from "./ground/mine";
import { coverPage } from "./cover/page";
import { forest } from "./cover/forest";
import { grassland } from "./cover/grassland";
import { barren } from "./cover/barren";
import { thawedHalo } from "./cover/thawedHalo";
import { wildZone } from "./cover/wildZone";
import { clearance } from "./cover/clearance";
import { anomaliesPage } from "./anomalies/page";
import { auroraField } from "./anomalies/auroraField";
import { lightWell } from "./anomalies/lightWell";
import { compassDeviation } from "./anomalies/compassDeviation";
import { interferenceLattice } from "./anomalies/interferenceLattice";
import { tear } from "./anomalies/tear";
import { door } from "./anomalies/door";
import { settlementsPage } from "./settlements/page";
import { settlement } from "./settlements/settlement";
import { ruin } from "./settlements/ruin";
import { dam } from "./settlements/dam";
import { mill } from "./settlements/mill";
import { irrigation } from "./settlements/irrigation";
import { harbour } from "./settlements/harbour";
import { ford } from "./settlements/ford";
import { bridge } from "./settlements/bridge";
import { forge } from "./settlements/forge";
import { archive } from "./settlements/archive";
import { shrine } from "./settlements/shrine";
import { battlefield } from "./settlements/battlefield";
import { disasterSite } from "./settlements/disasterSite";

/** One page per group; a missing or unknown group does not compile. */
export const poiPages: Readonly<Record<PoiGroupId, PoiGroupPage>> = {
  relief: reliefPage,
  water: waterPage,
  sea: seaPage,
  ground: groundPage,
  cover: coverPage,
  anomalies: anomaliesPage,
  settlements: settlementsPage,
};

/** One entry per kind; a missing or unknown kind does not compile. */
export const poiCatalogue: Readonly<Record<PoiKindId, PoiEntry>> = {
  summit,
  pass,
  ridge,
  escarpment,
  valley,
  gorge,
  plateau,
  volcano,
  caldera,
  crater,
  dome,
  cirque,
  moraine,
  ejectaFan,
  basaltFlat,
  sinkholeField,
  glassFlat,
  frostPrism,
  spring,
  waterfall,
  lake,
  riverMouth,
  wetland,
  fjord,
  vent,
  oasis,
  meltLine,
  headland,
  bay,
  strait,
  upwellingFront,
  crushZone,
  ancientWake,
  rogueWaveImpact,
  pressureLocus,
  thermalVein,
  placer,
  saltPan,
  saltDust,
  killingGround,
  mine,
  forest,
  grassland,
  barren,
  thawedHalo,
  wildZone,
  clearance,
  auroraField,
  lightWell,
  compassDeviation,
  interferenceLattice,
  tear,
  door,
  settlement,
  ruin,
  dam,
  mill,
  irrigation,
  harbour,
  ford,
  bridge,
  forge,
  archive,
  shrine,
  battlefield,
  disasterSite,
};

/** Every field of an entry still unwritten, as `role.field`: the catalogue's open work. */
export function unwrittenFields(entry: PoiEntry): string[] {
  const roles = Object.entries(entry).filter(
    (pair): pair is [string, Record<string, unknown>] =>
      typeof pair[1] === "object" && pair[1] !== null
  );
  return roles.flatMap(([role, fields]) =>
    Object.entries(fields)
      .filter(([, value]) => (value as { slot?: string }).slot === "unwritten")
      .map(([field]) => `${role}.${field}`)
  );
}
