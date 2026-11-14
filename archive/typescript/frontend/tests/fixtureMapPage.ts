import type { MapCustomization } from "./fixtureMap.worker";

declare global {
  interface Window {
    customizeFixtureMap(input: MapCustomization): Promise<void>;
  }
}
window.customizeFixtureMap = async (input) => {
  const worker = new Worker(new URL("./fixtureMap.worker.ts", import.meta.url), { type: "module" });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve());
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage(input);
    });
  } finally {
    worker.terminate();
  }
};
