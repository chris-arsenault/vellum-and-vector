import { expect, it } from "vitest";
import { MapScale, magicSystemSchema, resolveMagicSystem } from "@atlas/domain";
import { unscopedDefinition, withOrigin } from "./magicState";
import { originBurialDepth } from "../rock/rockMagicStock";

function suppliedDefinition() {
  return resolveMagicSystem(
    magicSystemSchema.parse({
      id: "salt",
      name: "Salt",
      phase: "post-glacial",
      origins: [
        { id: "default", source: "placed", propagation: "local" },
        { id: "deep", source: "placed", propagation: "local", parameters: { buryDepth: 0.0001 } },
        {
          id: "shallow",
          source: "placed",
          propagation: "local",
          parameters: { buryDepth: 0.000001 },
        },
      ],
    }),
    new MapScale(1000, 1000, 100)
  );
}

it("keeps system defaults available to all-origin readers inside nested origin scopes", () => {
  const definition = suppliedDefinition(),
    field = { definition },
    [plain, deep, shallow] = definition.origins;
  withOrigin(field, deep, () => {
    const outer = field.definition;
    expect(field.definition.parameters.buryDepth).toBe(deep.parameters.buryDepth);
    expect(originBurialDepth(field, plain)).toBe(definition.parameters.buryDepth);
    withOrigin(field, plain, () => {
      expect(field.definition.parameters.buryDepth).toBe(definition.parameters.buryDepth);
      withOrigin(field, shallow, () => {
        expect(field.definition.parameters.buryDepth).toBe(shallow.parameters.buryDepth);
        expect(unscopedDefinition(field)).toBe(definition);
      });
      expect(field.definition.parameters.buryDepth).toBe(definition.parameters.buryDepth);
    });
    expect(field.definition).toBe(outer);
  });
  expect(field.definition).toBe(definition);
});

it("restores both active and default definitions when a nested strategy throws", () => {
  const definition = suppliedDefinition(),
    field = { definition };
  expect(() =>
    withOrigin(field, definition.origins[1], () => {
      withOrigin(field, definition.origins[2], () => {
        throw new Error("strategy failed");
      });
    })
  ).toThrow("strategy failed");
  expect(field.definition).toBe(definition);
  expect(unscopedDefinition(field)).toBe(definition);
});
