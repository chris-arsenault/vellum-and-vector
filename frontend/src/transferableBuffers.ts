/** Small native preview buffers retain their shared views across worker delivery. */
export function transferableBuffers(
  value: unknown,
  buffers = new Set<ArrayBuffer>(),
  seen = new Set<object>()
) {
  if (!value || typeof value !== "object" || seen.has(value)) return [...buffers];
  seen.add(value);
  if (value instanceof ArrayBuffer) buffers.add(value);
  else if (ArrayBuffer.isView(value)) buffers.add(value.buffer as ArrayBuffer);
  else Object.values(value).forEach((child) => transferableBuffers(child, buffers, seen));
  return [...buffers];
}
