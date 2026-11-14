import { closeSync, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Arrays can contain a whole history; serialize one observation at a time, never one huge string. */
export function write(directory: string, name: string, value: unknown) {
  const path = join(directory, `${name}.json`);
  if (!Array.isArray(value)) return writeFileSync(path, JSON.stringify(value, null, 2));
  const file = openSync(path, "w");
  try {
    writeFragment(file, "[");
    for (let index = 0; index < value.length; index++) {
      writeFragment(file, index === 0 ? "\n" : ",\n");
      writeFragment(file, JSON.stringify(value[index], null, 2) ?? "null");
    }
    writeFragment(file, "\n]\n");
  } finally {
    closeSync(file);
  }
}
function writeFragment(file: number, text: string) {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length;)
    offset += writeSync(file, bytes, offset, bytes.length - offset);
}
