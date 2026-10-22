import { describe, expect, it } from "vitest";
import {
  prepareSampleCoefficients,
  preparedSampleInterpolator,
  type SampleSupport,
} from "./smoothSamples";

describe("prepared continuous fields", () => {
  const support: SampleSupport = {
    x: Float64Array.from([0, 1, 2, 0, 1, 2, 0, 1, 2]),
    y: Float64Array.from([0, 0, 0, 1, 1, 1, 2, 2, 2]),
    origin: [10, 20],
    spacing: 1,
  };

  it("delivers complete derivatives to a cold cloned consumer", () => {
    const values = Float64Array.from(support.x, (x, i) => 2 * x - 3 * support.y[i] + 7);
    const coefficients = prepareSampleCoefficients(support, values);
    for (const value of coefficients.dx) expect(value).toBeCloseTo(2, 12);
    for (const value of coefficients.dy) expect(value).toBeCloseTo(-3, 12);
    const delivered = structuredClone({ support, values, coefficients });
    const before = structuredClone(delivered.coefficients);
    const read = preparedSampleInterpolator(
      delivered.support,
      delivered.values,
      delivered.coefficients
    );
    expect(read(10.31, 21.22)).toBeCloseTo(7 + 2 * 0.31 - 3 * 1.22, 12);
    read.bounds([10.2, 20.3, 10.6, 20.8]);
    expect(delivered.coefficients).toEqual(before);
  });

  it("requires the producer to prepare a changed field before handing it to consumers", () => {
    const values = Float64Array.from(support.x, (x) => x);
    const before = prepareSampleCoefficients(support, values);
    for (let i = 0; i < values.length; i++) values[i] += 4 * support.y[i];
    const after = prepareSampleCoefficients(support, values);
    expect(before.dy[4]).toBe(0);
    expect(after.dy[4]).toBeCloseTo(4, 12);
    expect(preparedSampleInterpolator(support, values, after)(10.3, 20.7)).toBeCloseTo(3.1, 12);
    expect(() =>
      preparedSampleInterpolator(support, values, {
        dx: new Float64Array(0),
        dy: new Float64Array(0),
        affine: false,
      })
    ).toThrow(/Prepared derivatives/);
  });

  it("preserves exact nodal heights through a translated world frame", () => {
    const shifted: SampleSupport = {
      x: Float64Array.from([-1085.7056689524495, -1008.1552640272745, -1163.2560738776245]),
      y: Float64Array.from([268.64248295588544, 134.32124147794272, 134.32124147794272]),
      origin: [2000, 500],
      spacing: 155.10080985035,
    };
    const values = Float64Array.from([25767.45895571515, 15000, 27000]),
      read = preparedSampleInterpolator(shifted, values, prepareSampleCoefficients(shifted, values));
    for (const i of values.keys())
      expect(read(shifted.x[i] + shifted.origin[0], shifted.y[i] + shifted.origin[1])).toBe(values[i]);
  });
});
