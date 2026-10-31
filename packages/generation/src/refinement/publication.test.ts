import { expect, it } from "vitest";
import { regionalEnvironment } from "./refinementFixture";
import { channel } from "./state";
import { refinementPublications } from "./publication";

it("publishes derived occupation using the existing population layer definition", () => {
  const { state } = regionalEnvironment();
  channel(state, "populationDensity", "people/square-kilometre", 100);
  delete state.domain.world.layers.population;
  const definition = refinementPublications(state).find(
    (d) => d.kind === "field" && d.channel === "populationDensity"
  );
  expect(definition?.layer).toMatchObject({ id: "population", name: "Population and livelihoods" });
});
