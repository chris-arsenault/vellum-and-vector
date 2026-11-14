import { expect, it } from "vitest";
import { createTestField as createField } from "../rock/groundTestFixture";
import { constructRock, removeRock } from "../rock/groundLedger";
import { readLayer, setLayer } from "../rock/rockColumn";
import { rockCatalogue as rocks } from "../rock/rockCatalogue";
import { watchGroundTransfers, type GroundTransferObservation } from "../rock/groundTransport";
import { groundOf } from "../rock/ground";
import { compileMix } from "../rock/modes";
import { units } from "./math";
import { createWorldMesh } from "./worldMesh";
import { buildTransportPlan, releaseTransportPlan, weightScale } from "./transportPlan";
import { beginReliefCarry, finishReliefCarry } from "./reliefCarry";

function suppliedGround() {
  const map = createField(createWorldMesh([0, 0, 8000, 8000], 256, 0));
  for (let cell = 0; cell < map.mesh.count; cell++) {
    setLayer(map, cell, 0, rocks.granite.code, units(30_000));
    constructRock(map, cell, units(100), rocks.basalt, "supplied bed", "crust");
    map.CrustThickness.set(cell, units(4000));
    map.CrustContinentalColumn.set(cell, units(4000));
    map.CrustContinentalFraction.set(cell, 1000);
  }
  map.CrustColumnsInitialized = true;
  return map;
}
function middle(map: ReturnType<typeof suppliedGround>) {
  let best = 0;
  for (let cell = 1; cell < map.mesh.count; cell++)
    if (
      Math.hypot(map.mesh.x(cell), map.mesh.y(cell)) <
      Math.hypot(map.mesh.x(best), map.mesh.y(best))
    )
      best = cell;
  return best;
}

it("moves uniform relief by a fractional rigid translation without fabricating collision packages", () => {
  const map = suppliedGround(),
    cell = middle(map);
  map.CrustMotionX.fill(400);
  map.CrustMotionY.fill(300);
  const carry = beginReliefCarry(map),
    plan = buildTransportPlan(map, map.mesh.spacing),
    events: GroundTransferObservation[] = [],
    stop = watchGroundTransfers(new Set([cell]), (event) => events.push(event));
  finishReliefCarry(map, carry, plan);
  stop();
  expect(
    events.some(
      (event) => event.operation === "plate-placement" || event.operation === "plate-remap"
    )
  ).toBe(true);
  expect(events.some((event) => event.operation === "rock-accretion")).toBe(false);
  // A transported uniform bed stays a uniform bed; no compressed contact exists in this input.
  for (let i = 0; i < map.mesh.count; i++)
    if (Math.abs(map.mesh.x(i)) < 2000 && Math.abs(map.mesh.y(i)) < 2000) {
      expect(map.SurfaceRockLoad.get(i) / 1024).toBeCloseTo(100);
      expect(readLayer(map, i, 0).kind).toBe(rocks.basalt.code);
      expect(readLayer(map, i, 0).depth / 1024).toBeCloseTo(100);
      expect(readLayer(map, i, 1).kind).toBe(rocks.granite.code);
    }
  releaseTransportPlan(map, plan);
});

function overlappingArrival(oceanic: boolean, convergent = true) {
  const map = suppliedGround(),
    target = middle(map),
    source = map.mesh.neighbor(target, 0),
    plan = buildTransportPlan(map, 0);
  setLayer(map, source, 0, rocks.limestone.code, units(100), {
    formedMin: 2,
    formedMax: 2,
    altered: 3,
    grainX: 600,
    bedSlopeX: 0.2,
  });
  if (oceanic) {
    map.CrustContinentalColumn.set(source, 0);
    map.CrustContinentalFraction.set(source, 0);
  }
  map.TectonicBoundaryCodes.set(target, convergent ? 1 : 0);
  // Explicit incoming parcels: the recipient stays, and this equal-area donor arrives on it.
  plan.targets.set(plan.offsets.get(source), target);
  plan.arrivals.add(source, -weightScale);
  plan.arrivals.add(target, weightScale);
  return { map, target, source, plan };
}

it.each([false, true])(
  "lands actual overlap locally using oceanic=%s crust retention",
  (oceanic) => {
    const { map, target, source, plan } = overlappingArrival(oceanic),
      bystander = map.mesh.neighbor(target, 1),
      before = readLayer(map, bystander, 0),
      carry = beginReliefCarry(map),
      events: GroundTransferObservation[] = [],
      stop = watchGroundTransfers(new Set([source]), (event) => events.push(event));
    finishReliefCarry(map, carry, plan);
    stop();
    expect(
      events
        .filter((event) => event.operation === "rock-accretion")
        .every((event) => event.target === target)
    ).toBe(true);
    expect(map.SurfaceRockLoad.get(target) / 1024).toBeCloseTo(oceanic ? 150 : 200);
    // Donor insertion order may leave the recipient's excess above the arriving soluble bed.
    if (readLayer(map, target, 0).kind !== rocks.limestone.code)
      removeRock(map, target, readLayer(map, target, 0).depth, "expose arrived bed");
    expect(readLayer(map, target, 0)).toMatchObject({
      kind: rocks.limestone.code,
      formedMin: 2,
      altered: 3,
      grainX: 600,
      bedSlopeX: 0.2,
    });
    expect(readLayer(map, bystander, 0)).toEqual(before);
    expect(readLayer(map, source, 0).kind).not.toBe(rocks.limestone.code);
    const solution = compileMix({ solution: 1 });
    expect(groundOf(map).actOn(target, solution, 1, Infinity)).toBeGreaterThan(0);
    removeRock(map, target, readLayer(map, target, 0).depth, "strip arrived cap");
    if (!oceanic) {
      expect(groundOf(map).actOn(target, solution, 1, Infinity)).toBeGreaterThan(0);
      removeRock(map, target, readLayer(map, target, 0).depth, "strip mixed retained bed");
    }
    expect(groundOf(map).actOn(target, solution, 1, Infinity)).toBe(0);
    releaseTransportPlan(map, plan);
  }
);

it("does not reinterpret an unclassified overlap as a convergent contact", () => {
  const { map, target, plan } = overlappingArrival(false, false),
    carry = beginReliefCarry(map),
    events: GroundTransferObservation[] = [],
    stop = watchGroundTransfers(new Set([target]), (event) => events.push(event));
  finishReliefCarry(map, carry, plan);
  stop();
  expect(events.some((event) => event.operation === "rock-accretion")).toBe(false);
  expect(map.SurfaceRockLoad.get(target) / 1024).toBeCloseTo(100);
  releaseTransportPlan(map, plan);
});

it("retains a real partial arrival rather than inventing fresh crust at a sampling threshold", () => {
  const map = suppliedGround(),
    cell = middle(map),
    plan = buildTransportPlan(map, 0);
  plan.weights.set(plan.offsets.get(cell), weightScale / 4);
  plan.arrivals.set(cell, weightScale / 4);
  const carry = beginReliefCarry(map);
  finishReliefCarry(map, carry, plan);
  expect(readLayer(map, cell, 0).kind).toBe(rocks.basalt.code);
  expect(readLayer(map, cell, 0).depth).toBe(units(100));
  expect(readLayer(map, cell, 1).kind).toBe(rocks.granite.code);
  releaseTransportPlan(map, plan);
});
