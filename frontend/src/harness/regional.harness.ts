import { it } from "vitest";
import { harnessOptions, runHarness } from "./harness";

/**
 * The headless generation harness, run by `pnpm --dir frontend harness`; never part of the
 * unit suites. It reports what was made and checks nothing: read the report it writes.
 */
it(
  "records a checkpointed world and region",
  async () => {
    const out = await runHarness(harnessOptions(process.env));
    process.stdout.write(`\nHarness report: ${out}\n`);
  },
  6 * 3_600_000
);
