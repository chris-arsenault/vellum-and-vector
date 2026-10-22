import { preparedSampleInterpolator, type SampleJets, type SampleSupport } from "./smoothSamples";

export interface SampleTerm {
  values: ArrayLike<number>;
  coefficients: SampleJets;
  scale: number;
}

/** A numeric view over existing prepared jets; no new sample map or derivative fit. */
function linearView(length: number, read: (i: number) => number): ArrayLike<number> {
  return new Proxy(
    { length },
    {
      get(target, property) {
        if (property === "length") return target.length;
        if (typeof property !== "string") return undefined;
        const index = Number(property);
        return Number.isInteger(index) && index >= 0 && index < length ? read(index) : undefined;
      },
    }
  );
}

/** The compact cardinal weights are shared by every channel on this support.
 * Combine their prepared jets before taking intervals, retaining cancellation.
 * Adaptive clamped patches deliberately do not use this linear identity.
 */
export function sampleCombination(support: SampleSupport, terms: SampleTerm[]) {
  const count = support.x.length;
  const values = linearView(count, (i) =>
    terms.reduce((sum, term) => sum + term.scale * term.values[i], 0)
  );
  const slope = (axis: "dx" | "dy") =>
    linearView(count, (i) =>
      terms.reduce((sum, term) => sum + term.scale * term.coefficients[axis][i], 0)
    );
  return preparedSampleInterpolator(support, values, {
    dx: slope("dx"),
    dy: slope("dy"),
    affine: terms.every((term) => term.coefficients.affine),
  });
}
