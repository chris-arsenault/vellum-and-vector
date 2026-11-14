import { installFixtureMap } from "./fixturePublication.worker";

self.onmessage = async () => {
  try {
    const reference = await installFixtureMap();
    self.postMessage({ reference });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
