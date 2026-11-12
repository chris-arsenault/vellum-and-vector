import { expect, it } from "vitest";
import { groundwaterBalance, groundwaterReturnRate, returnedCharge } from "./groundwater";
import { buriedCharge, litterPacket } from "../world/magicGroundwater";

it("routing reads a return rate over the actual transfer interval, not its refresh interval", () => {
  expect(groundwaterReturnRate(0.25, 0.25)).toBe(1);
  expect(groundwaterReturnRate(0.25, 1)).toBe(0.25);
  expect(groundwaterReturnRate(0.25, 0)).toBe(0);
});

it("dissolved material follows only the withdrawn share of available groundwater", () => {
  expect(returnedCharge(80, 4, 1)).toBe(20);
  expect(returnedCharge(80, 4, 0)).toBe(0);
  expect(returnedCharge(80, 0, 1)).toBe(0);
  expect(returnedCharge(80, 4, 20)).toBe(80);
});

it("marine groundwater exposes its departure to carriers instead of silently clearing storage", () => {
  const sea = groundwaterBalance(4, 0, 10, 0, true, 1);
  expect(sea).toEqual({ storage: 0, outflow: 4, returned: 0 });
  expect(returnedCharge(80, 4, sea.outflow)).toBe(80);
  expect(groundwaterBalance(4, 0, 10, 0, false, 1)).toEqual({
    storage: 4,
    outflow: 0,
    returned: 0,
  });
  expect(groundwaterBalance(0, 0, 10, 0, true, 1)).toEqual({
    storage: 0,
    outflow: 0,
    returned: 0,
  });
});

it("groundwater work exposes recharge and drainage for the supplied interval only", () => {
  expect(groundwaterBalance(4, 8, 20, 0, false, 0.25)).toEqual({
    storage: 6,
    outflow: 0,
    returned: 0,
  });
  expect(groundwaterBalance(8, 0, 20, 0.75, false, 0.5)).toEqual({
    storage: 4,
    outflow: 4,
    returned: 0,
  });
});

it("zero exposure cannot recharge, drain or return even an overfull or marine store", () => {
  for (const marine of [false, true])
    expect(groundwaterBalance(8, 12, 1, 1, marine, 0)).toEqual({
      storage: 8,
      outflow: 0,
      returned: 0,
    });
});

it("burial follows the buried share of its charged carbon carrier", () => {
  expect(buriedCharge(80, 1, 3, 0.5)).toBe(10);
  expect(buriedCharge(80, 10, 30, 0.5)).toBe(10);
  expect(buriedCharge(0, 10, 30, 1)).toBe(0);
  expect(buriedCharge(80, 0, 3, 1)).toBe(0);
  expect(buriedCharge(80, 3, 0, 1)).toBe(80);
});

it("litter binds charge according to the actual carbon mass withdrawn", () => {
  expect(litterPacket(1000, 2, 10, 0.5, 4)).toEqual({
    carbon: 1,
    volume: 10 / 150,
    density: 600,
    amount: 40,
  });
  expect(litterPacket(10, 2, 10, 0.5, 4)?.amount).toBe(5);
  expect(litterPacket(1000, 0, 10, 0.5, 4)).toBeUndefined();
  expect(litterPacket(0, 2, 10, 0.5, 4)).toBeUndefined();
});

it("trace carbon carries finite bound charge without concentrating the remaining sap", () => {
  for (const carbon of [1.4367116336e-314, 1.000289e-317]) {
    const packet = litterPacket(1000, carbon, 1e9, 0.01, 4)!;
    expect(packet.density).toBe(600);
    expect(packet.carbon).toBeGreaterThan(0);
    expect(packet.amount).toBeGreaterThan(0);
    expect(packet.amount).toBeLessThan(1e-300);
  }
  expect(litterPacket(1000, Number.MIN_VALUE, 1, 0.01, 4)).toBeUndefined();
});
