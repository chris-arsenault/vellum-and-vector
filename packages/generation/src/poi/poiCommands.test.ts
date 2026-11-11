import { MapScale, type SocietyEvent } from "@atlas/domain";
import { expect, it, vi } from "vitest";
import { eventChanges } from "./poiEffects";
import { disasterChanges, disasterSite } from "./settlements/disasterSite";

const flood: SocietyEvent = {
  id: "flood-1",
  kind: "flood",
  era: "Settlement",
  position: { x: 0, y: 0, z: 0 },
  radius: 100,
  magnitude: 0.5,
  casualties: 0,
  displaced: 0,
  communities: [],
  causes: [],
};

it("event command dispatch selects strategies using the accepted event and supplied context", () => {
  const changes = vi.fn((context: { cell: number }, event: SocietyEvent) => [
      {
        change: "atLeast" as const,
        band: "EcologicalDamage" as const,
        cell: context.cell,
        value: event.magnitude,
      },
    ]),
    rejected = vi.fn(() => []);
  expect(
    eventChanges(
      [
        { accepts: (event) => event.kind === "flood", changes },
        { accepts: (event) => event.kind === "siege", changes: rejected },
      ],
      { cell: 4 },
      flood
    )
  ).toEqual([{ change: "atLeast", band: "EcologicalDamage", cell: 4, value: 0.5 }]);
  expect(changes).toHaveBeenCalledWith({ cell: 4 }, flood);
  expect(rejected).not.toHaveBeenCalled();
});

it("a breach declares one-time ice work while its historical place maintains no material constraint", () => {
  const commands = disasterChanges(
    { kind: "pressure-ice-breach", magnitude: 0.5 },
    4,
    MapScale.reference()
  );
  expect(commands).toContainEqual({ change: "atMost", band: "IceThickness", cell: 4, value: 0 });
  expect(disasterSite.fields.water).toMatchObject({ slot: "notApplicable" });
  expect(disasterSite.fields.terrain).toMatchObject({ slot: "notApplicable" });
  expect(disasterSite.fields.cover).toMatchObject({ slot: "notApplicable" });
  expect(disasterSite.acrossMaps.realize).toMatchObject({ slot: "notApplicable" });
});

it("event deposits resolve map-relative material requests and do not target an absent cell", () => {
  const scale = MapScale.reference();
  expect(disasterChanges(flood, 4, scale)).toContainEqual({
    change: "atLeast",
    band: "SedimentThickness",
    cell: 4,
    value: MapScale.native(scale.length(1.25e-7) * flood.magnitude),
  });
  expect(disasterChanges(flood, -1, scale)).toEqual([]);
});
