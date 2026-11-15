import type { MapRef } from "@atlas/map";
import { openServerSaveFixture } from "./serverSaveFixture";
declare global {
  interface Window {
    prepareFixtureMap(): Promise<MapRef>;
    openServerSaveFixture: typeof openServerSaveFixture;
    savedFixtureView(): Promise<import("@atlas/map").SavedMapDocument>;
  }
}
window.openServerSaveFixture = openServerSaveFixture;
window.prepareFixtureMap = async () => {
  const worker = new Worker(new URL("./fixtureMap.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<MapRef>((resolve, reject) => {
      worker.onmessage = ({ data }) =>
        data.error ? reject(new Error(data.error)) : resolve(data.reference);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage("prepare");
    });
  } finally {
    worker.terminate();
  }
};
