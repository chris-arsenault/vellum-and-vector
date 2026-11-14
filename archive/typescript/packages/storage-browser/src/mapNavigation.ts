import type { Database } from "./catalogDatabase";
import { type MapRef, type MapNavigationState, type NavigationStore } from "@atlas/map";
import { rustMapStore } from "./rustMapStore";
import { mapCall } from "./mapCall";
export class BrowserNavigationStore implements NavigationStore {
  private rust;
  constructor(db: Database) {
    this.rust = rustMapStore(db);
  }
  async read(reference: MapRef): Promise<MapNavigationState> {
    return mapCall(this.rust, "readNavigation", { reference });
  }
  async write(reference: MapRef, expected: number, state: MapNavigationState): Promise<void> {
    mapCall(this.rust, "writeNavigation", { reference, expected, state });
  }
}
