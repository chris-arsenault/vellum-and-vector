import { installFixtureMap } from "./fixturePublication.worker";

self.onmessage = async () => {
  try {
    self.postMessage({ maps: await installFixtureMap() });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
