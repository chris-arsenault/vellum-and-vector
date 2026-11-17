import { openServerSaveFixture } from "./serverSaveFixture";
import type { FixtureMaps } from "./fixturePublication.worker";
declare global {
  interface Window {
    prepareFixtureMap(): Promise<FixtureMaps>;
    openServerSaveFixture: typeof openServerSaveFixture;
    savedFixtureView(): Promise<import("@atlas/map").SavedMapDocument>;
  }
}
window.openServerSaveFixture = openServerSaveFixture;
window.prepareFixtureMap = async () => {
  const worker = new Worker(new URL("./fixtureMap.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<FixtureMaps>((resolve, reject) => {
      worker.onmessage = ({ data }) =>
        data.error ? reject(new Error(data.error)) : resolve(data.maps);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage("prepare");
    });
  } finally {
    worker.terminate();
  }
};
