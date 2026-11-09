import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";

/** Ten-millisecond CPU samples keep a multi-hour diagnostic profile practical. */
const samplingIntervalMicroseconds = 10_000;

/** V8 samples independently of JavaScript timers, including long synchronous stages. */
export async function startCpuProfile(path: string, enabled: boolean) {
  if (!enabled) return async () => {};
  const session = new Session();
  session.connect();
  try {
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: samplingIntervalMicroseconds });
    await session.post("Profiler.start");
  } catch (error) {
    session.disconnect();
    throw error;
  }
  return async () => {
    try {
      const { profile } = await session.post("Profiler.stop");
      writeFileSync(path, JSON.stringify(profile));
    } finally {
      session.disconnect();
    }
  };
}
