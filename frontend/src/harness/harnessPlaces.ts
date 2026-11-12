/** A point of the world as `x,y` in metres. */
export function position(text: string): [number, number] | undefined {
  const at = text.split(",").map(Number);
  return at.length === 2 && at.every(Number.isFinite) ? [at[0], at[1]] : undefined;
}
/** Named places, `name:x,y;name:x,y`: the quick region check looks at each in turn. */
export function namedPlaces(text: string) {
  return text
    .split(";")
    .filter((part) => part.includes(":"))
    .map((part) => {
      const [name, at] = part.split(":"),
        point = position(at);
      if (!name || !point) throw new Error(`HARNESS_REGION_AT place "${part}" is not name:x,y.`);
      return { name, at: point };
    });
}
