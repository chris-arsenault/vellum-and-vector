import { expect, it } from "vitest";
import { transferableBuffers } from "./transferableBuffers";

it("collects each preview buffer once across shared views and nested quantities", () => {
  const values = new Float64Array(8);
  const preview = {
    elevation: values,
    nested: [new Uint8Array(values.buffer), { future: new Int32Array(3) }],
  };
  const buffers = transferableBuffers(preview);
  expect(buffers).toHaveLength(2);
  const received = structuredClone(preview, { transfer: buffers });
  expect(values.byteLength).toBe(0);
  expect(received.elevation.buffer).toBe((received.nested[0] as Uint8Array).buffer);
  expect(received.elevation.length).toBe(8);
});
